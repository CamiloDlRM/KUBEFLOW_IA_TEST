"""Gemini, holding Superset's tools, asked to build a dashboard over gold.

This is a different shape from the rest of the AI in the platform, and the
difference is worth stating because it is a step down in how much can be
checked.

The gold advisor (``core.ai_gold``) takes a schema and returns SQL. The model
never touches the data, the platform runs what it wrote, and a bad answer is
visible — a row count of zero, a join that multiplied. Here the model *acts*:
it creates datasets, charts and a dashboard in Superset, and what it did is
whatever ended up in Superset's metadata database.

Three things narrow that down.

The tools are Superset's own, so the model cannot do anything a person with
that Superset account could not. It is the account that is the boundary, not
the prompt — which is why the MCP server must eventually stop authenticating
every call as one admin.

The data is the built gold object. The model is not handed rows and asked to
summarise them; it is told which relation exists and what columns it has, and
Superset queries it. A chart is therefore reproducible in the way a SQL
definition is: run it again and it reads the same object.

And the loop is bounded. A model that keeps calling tools forever is stopped,
and every call it made is returned to the caller, so what it did can be read
afterwards rather than inferred from the result.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable

import structlog

from core.config import AppSettings, get_settings
from core.mcp import MCPClient, MCPError, MCPTool

logger = structlog.get_logger(__name__)

__all__ = [
    "DashboardRequestError",
    "DashboardRun",
    "ToolCall",
    "to_gemini_schema",
    "build_dashboard",
]

#: How many times the model may go round the loop. Each turn is one call to
#: Gemini plus however many tools it asked for. Enough for "look at what is
#: there, make a dataset, make four charts, make a dashboard", not enough to
#: spin.
MAX_TURNS = 12

SYSTEM_PROMPT = """You build dashboards in Apache Superset by calling the \
tools you have been given.

What you are working with:
- The data is a table in the GOLD layer of a medallion architecture. It is \
already cleaned, typed and joined — one built, versioned object. Do not try to \
clean it, and do not invent columns: use only the ones named in the schema below.
- Build the dashboard out of the tools. Never answer with instructions for a \
human to follow by hand.

How to work:
- Look before you build. List what already exists rather than assuming.
- If you have built a dashboard for this project already, FIND IT AND CHANGE \
IT. The user is refining the dashboard they have, not asking for another one. \
Creating a second dashboard every time a chart needs moving is the single \
worst thing you can do here.
- Prefer a few charts that answer the question over many that decorate it.
- If the request needs a column that is not in the schema, build the closest \
dashboard the schema does support and say plainly, at the end, what you could \
not answer and why.
- When a tool reports an error, read it and correct the call. Do not repeat the \
same call unchanged.

When you are finished, reply with plain text: what the dashboard shows, which \
charts it has, and anything you could not do."""


class DashboardRequestError(RuntimeError):
    """The dashboard could not be built."""


@dataclass
class ToolCall:
    """One tool the model asked for, and what came back."""

    name: str
    arguments: dict[str, Any]
    result: str


@dataclass
class DashboardRun:
    """What the model did, and what it said about it."""

    summary: str
    calls: list[ToolCall] = field(default_factory=list)
    turns: int = 0
    #: True when the loop was cut off rather than the model finishing. The
    #: summary is then the last thing it said, which may be mid-thought.
    exhausted: bool = False


# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------

#: What Gemini accepts in a function declaration. It is an OpenAPI subset, not
#: JSON Schema, and it rejects the request outright when it meets a key it does
#: not know — including the ``$schema`` and ``additionalProperties`` that most
#: MCP servers emit.
_GEMINI_SCHEMA_KEYS = frozenset(
    {
        "type",
        "format",
        "description",
        "nullable",
        "enum",
        "items",
        "properties",
        "required",
        "anyOf",
    }
)

_GEMINI_TYPES = frozenset(
    {"string", "number", "integer", "boolean", "array", "object"}
)


def to_gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Translate one MCP tool's JSON Schema into what Gemini will accept.

    Unknown keys are dropped rather than passed through, because Gemini rejects
    the whole request over one it does not recognise — and the offending key is
    usually ``$schema``, which carries no meaning for the model anyway.

    A type it cannot express becomes a string. That is a lie about the type but
    a small one: the model still sees the description and the name, and the
    server validates the argument either way.
    """
    if not isinstance(schema, dict):
        return {"type": "string"}

    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key not in _GEMINI_SCHEMA_KEYS:
            continue
        if key == "properties" and isinstance(value, dict):
            out["properties"] = {
                name: to_gemini_schema(sub) for name, sub in value.items()
            }
        elif key == "items":
            out["items"] = to_gemini_schema(value)
        elif key == "anyOf" and isinstance(value, list):
            out["anyOf"] = [to_gemini_schema(sub) for sub in value]
        elif key == "type":
            # A list of types (JSON Schema's way of saying nullable) is not
            # something Gemini takes; keep the first real one.
            if isinstance(value, list):
                real = [t for t in value if t != "null"]
                if "null" in value:
                    out["nullable"] = True
                value = real[0] if real else "string"
            out["type"] = value if value in _GEMINI_TYPES else "string"
        else:
            out[key] = value

    if "type" not in out:
        out["type"] = "object" if "properties" in out else "string"
    # Gemini rejects an object with no properties, which is how a no-argument
    # tool arrives.
    if out["type"] == "object" and not out.get("properties"):
        out["properties"] = {}
    return out


def _declarations(tools: list[MCPTool]) -> list[dict[str, Any]]:
    return [
        {
            "name": tool.name,
            "description": tool.description[:1024],
            "parameters": to_gemini_schema(tool.schema),
        }
        for tool in tools
    ]


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------


def _gemini(
    settings: AppSettings, model: str, contents: list[dict[str, Any]], tools: list[dict[str, Any]]
) -> dict[str, Any]:
    """One turn: the conversation so far plus the tools, in; a candidate, out."""
    import httpx

    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{model}:generateContent"
    )
    response = httpx.post(
        url,
        headers={"x-goog-api-key": settings.gemini_api_key},
        json={
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": contents,
            "tools": [{"functionDeclarations": tools}],
            "generationConfig": {"maxOutputTokens": 8000},
        },
        timeout=300,
    )
    response.raise_for_status()
    data = response.json()

    candidates = data.get("candidates") or []
    if not candidates:
        raise DashboardRequestError(
            f"Gemini returned no candidates (blocked?): {json.dumps(data)[:400]}"
        )
    return candidates[0].get("content") or {}


def build_dashboard(
    request: str,
    *,
    schema: str,
    mcp_url: str,
    history: list[tuple[str, str]] | None = None,
    settings: AppSettings | None = None,
    model: str = "gemini-2.5-pro",
    generate: Callable[..., dict[str, Any]] | None = None,
    client: MCPClient | None = None,
) -> DashboardRun:
    """Ask the model to build a dashboard, and let it use Superset to do it.

    Args:
        request: What the user asked for, in their words.
        schema: The gold relation and its columns, as text. The model is told
            what exists rather than left to discover it, because discovery
            costs a tool call per guess and the platform already knows.
        mcp_url: Where Superset's MCP server is listening.
        history: Earlier exchanges, oldest first, as ``(request, summary)``.
            This is what makes "move that chart" mean anything: without it the
            model meets each prompt as its first, and builds a second dashboard
            rather than editing the one it built a minute ago.

            The exchange is replayed, not the tool transcript. The transcript
            grows without bound and mostly repeats what Superset can be asked
            directly — and it can be, because the model has the tools.
        generate: Seam for tests. Defaults to calling Gemini.
        client: Seam for tests. Defaults to opening one against ``mcp_url``.
    """
    settings = settings or get_settings()
    if not settings.gemini_api_key:
        raise DashboardRequestError("GEMINI_API_KEY is not set.")

    call_model = generate or _gemini
    opened = client is None
    connection = client or MCPClient(mcp_url)

    try:
        try:
            if opened:
                connection.__enter__()
            tools = connection.tools()
        except MCPError as exc:
            # Superset being unreachable is an operational fact, not a crash.
            # Raised as the error this module already has, it reaches the user
            # as "could not reach Superset" instead of as a 500 with a stack
            # trace in it.
            raise DashboardRequestError(str(exc)) from exc

        if not tools:
            raise DashboardRequestError(
                "Superset's MCP server offered no tools, so there is nothing "
                "the model can do with it."
            )
        declarations = _declarations(tools)

        contents: list[dict[str, Any]] = []
        for earlier, answer in history or []:
            contents.append({"role": "user", "parts": [{"text": earlier}]})
            contents.append({"role": "model", "parts": [{"text": answer}]})
        # The schema goes on the current message rather than the first, so a
        # gold table rebuilt between two prompts is described as it is now.
        contents.append(
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            f"The gold table available to you:\n{schema}\n\n"
                            f"What to build:\n{request}"
                        )
                    }
                ],
            }
        )

        run = DashboardRun(summary="")
        for turn in range(1, MAX_TURNS + 1):
            run.turns = turn
            content = call_model(settings, model, contents, declarations)
            parts = content.get("parts") or []
            contents.append({"role": "model", "parts": parts})

            requested = [p["functionCall"] for p in parts if "functionCall" in p]
            if not requested:
                run.summary = "".join(p.get("text", "") for p in parts).strip()
                return run

            # Every call the model asked for in this turn is answered in one
            # message, which is what the protocol expects and what keeps the
            # transcript readable afterwards.
            answers = []
            for wanted in requested:
                name = wanted.get("name", "")
                arguments = wanted.get("args") or {}
                try:
                    result = connection.call(name, arguments)
                except MCPError as exc:
                    # Losing the server mid-loop ends the run, but everything
                    # it did up to here is already in Superset and already in
                    # `run.calls`, so it is reported rather than discarded.
                    run.summary = (
                        f"Superset stopped answering after {len(run.calls)} "
                        f"calls: {exc}"
                    )
                    return run
                run.calls.append(ToolCall(name=name, arguments=arguments, result=result))
                answers.append(
                    {
                        "functionResponse": {
                            "name": name,
                            "response": {"result": result},
                        }
                    }
                )
            contents.append({"role": "user", "parts": answers})

        run.exhausted = True
        run.summary = (
            run.summary
            or f"Stopped after {MAX_TURNS} turns without the model finishing."
        )
        logger.warning("superset_agent.exhausted", calls=len(run.calls))
        return run
    finally:
        if opened:
            connection.close()
