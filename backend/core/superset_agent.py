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

#: The tools a dashboard is built from. Superset offers ~45, and every one
#: travels with every model call: on Groq's free tier that alone came to 10,303
#: tokens against a limit of 8,000 a minute, before the model had read a word
#: of the request. These are what the job uses — find the gold database, make
#: or reuse a dataset on it, chart it, put the charts in one dashboard — and a
#: narrower set is also a model with fewer wrong turns available to it.
#:
#: Overridable with DASHBOARD_AGENT_TOOLS: a comma list, or `*` for all of them.
DEFAULT_TOOLS = (
    "list_databases",
    "list_datasets",
    "get_dataset_info",
    "create_virtual_dataset",
    "list_charts",
    "generate_chart",
    "update_chart",
    "get_chart_type_schema",
    "list_dashboards",
    "get_dashboard_info",
    "generate_dashboard",
    "add_chart_to_existing_dashboard",
)

#: How much of one tool's answer the model is shown. A listing comes back as
#: JSON that can run to thousands of tokens, the conversation carries every
#: answer into every later call, and the budget is per minute. The full answer
#: is still kept in the run, so nothing is lost from the record — only from
#: what the model rereads.
MAX_RESULT_CHARS = 2500

SYSTEM_PROMPT = """You build dashboards in Apache Superset by calling the \
tools you have been given.

What you are working with:
- The data is a table in the GOLD layer of a medallion architecture. It is \
already cleaned, typed and joined — one built, versioned object. Do not try to \
clean it, and do not invent columns: use only the ones named in the schema below.
- Build the dashboard out of the tools. Never answer with instructions for a \
human to follow by hand.

How to reach the gold table:
- It lives in Superset's database named "Gold (DuckDB)". Find its id with \
list_databases.
- It is a Parquet object, read with DuckDB's read_parquet. The object's path is \
given with the schema below. Build a virtual dataset on that database whose SQL \
is: SELECT * FROM read_parquet('<that path>')
- Before creating that dataset, check list_datasets: if one already reads the \
same path, reuse it.
- Then build charts on the dataset, and put them in one dashboard.

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


def _select(tools: list[MCPTool], spec: str) -> list[MCPTool]:
    """The tools the model is offered: the default set, a configured one, or all.

    A configured name that Superset does not offer is skipped. If none of them
    match — Superset renamed its tools, say — every tool is offered instead of
    none: a model with too many tools is slow, one with none can only apologise.
    """
    spec = spec.strip()
    if spec == "*":
        return tools
    wanted = (
        {name.strip() for name in spec.split(",") if name.strip()}
        if spec
        else set(DEFAULT_TOOLS)
    )
    chosen = [tool for tool in tools if tool.name in wanted]
    if not chosen:
        logger.warning(
            "superset_agent.no_tools_matched",
            wanted=sorted(wanted),
            offered=[tool.name for tool in tools][:60],
        )
        return tools
    return chosen


def _for_the_model(result: str) -> str:
    """One tool answer, cut to what the model can afford to reread."""
    if len(result) <= MAX_RESULT_CHARS:
        return result
    return (
        result[:MAX_RESULT_CHARS]
        + f"\n...[{len(result) - MAX_RESULT_CHARS} more characters cut. "
        "Ask for something narrower if you need them.]"
    )


def _declarations(tools: list[MCPTool]) -> list[dict[str, Any]]:
    """The tools as the MCP server describes them: plain JSON Schema.

    Narrowing happens in the backend that needs it. Gemini takes an OpenAPI
    subset and must have the schema trimmed; everything speaking the OpenAI
    shape takes JSON Schema as it stands. Trimming here would quietly impose
    Gemini's limits on providers that do not have them.
    """
    return [
        {
            "name": tool.name,
            "description": tool.description[:1024],
            "parameters": tool.schema or {"type": "object", "properties": {}},
        }
        for tool in tools
    ]


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------


#: Statuses that mean "ask again", not "you asked wrong". 503 is the one that
#: matters in practice: a free tier meets "this model is currently
#: experiencing high demand" often, and a run makes up to MAX_TURNS model
#: calls — so without retries the chance of finishing a dashboard is the
#: chance of winning that coin toss a dozen times in a row.
_RETRYABLE = frozenset({429, 500, 502, 503, 504})
_ATTEMPTS = 4


def _wait_for(response: Any, attempt: int) -> float:
    """How long to hold off. The server's own answer wins if it gave one."""
    header = response.headers.get("retry-after", "")
    if header.isdigit():
        # Up to a minute: tokens-per-minute limits reset on a minute's window.
        return min(float(header), 60.0)
    # 2, 4, 8 seconds. Long enough for a demand spike to pass, short enough
    # that four attempts do not outlast the caller's patience.
    return float(2**attempt)


def _gemini(
    settings: AppSettings,
    model: str,
    contents: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    sleep: Any = None,
) -> dict[str, Any]:
    """One turn: the conversation so far plus the tools, in; a candidate, out."""
    import time

    import httpx

    sleep = sleep or time.sleep
    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{model}:generateContent"
    )
    narrowed = [dict(tool, parameters=to_gemini_schema(tool["parameters"])) for tool in tools]
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "tools": [{"functionDeclarations": narrowed}],
        "generationConfig": {"maxOutputTokens": 8000},
    }

    for attempt in range(1, _ATTEMPTS + 1):
        response = httpx.post(
            url,
            headers={"x-goog-api-key": settings.gemini_api_key},
            json=payload,
            timeout=300,
        )
        if response.status_code not in _RETRYABLE or attempt == _ATTEMPTS:
            break
        delay = _wait_for(response, attempt)
        logger.info(
            "superset_agent.retrying",
            status=response.status_code,
            attempt=attempt,
            waiting=delay,
            model=model,
        )
        sleep(delay)

    if response.status_code >= 400:
        # Google's body says which model names it would have accepted, and a
        # 404 here is almost always a model name this key cannot use rather
        # than anything wrong with the request. Raised as our own error so it
        # reaches the user as a message instead of as a 500 with a trace.
        tried = f" after {_ATTEMPTS} attempts" if response.status_code in _RETRYABLE else ""
        raise DashboardRequestError(
            f"The model API refused the request{tried}: HTTP "
            f"{response.status_code} for model {model!r}. {response.text[:400]}"
        )
    data = response.json()

    candidates = data.get("candidates") or []
    if not candidates:
        raise DashboardRequestError(
            f"Gemini returned no candidates (blocked?): {json.dumps(data)[:400]}"
        )
    return candidates[0].get("content") or {}


# ---------------------------------------------------------------------------
# The OpenAI-compatible backend: Groq, OpenRouter, and most of the rest
# ---------------------------------------------------------------------------
#
# One backend covers the family because they all speak the same dialect:
# /chat/completions, a bearer token, `messages`, and `tools` carrying plain
# JSON Schema. Switching between them is a base URL and a model name, not code.
#
# The loop above speaks Gemini's shape, and keeps doing so. This translates at
# the edges instead — in on the way to the provider, out on the way back — so
# the loop, and every test of it, stays as it is. The alternative was a third
# neutral shape that nothing speaks natively, converted twice.


def _tool_call_id(message: int, index: int) -> str:
    """A name for one call, derived rather than remembered.

    The OpenAI shape pairs a result with the call it answers by id; Gemini's
    has no id at all. Deriving it from position works because the loop answers
    every call of a turn, in order, in the one message that follows it — so
    the Nth result belongs to the Nth call, and both sides can compute the
    same name without anything being carried between them.
    """
    return f"call_{message}_{index}"


def _as_messages(contents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Gemini's `contents` as OpenAI's `messages`."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    #: Which message the calls being answered came from, so a result can name
    #: the call it belongs to.
    answering = 0

    for position, entry in enumerate(contents):
        parts = entry.get("parts") or []
        calls = [part["functionCall"] for part in parts if "functionCall" in part]
        results = [part["functionResponse"] for part in parts if "functionResponse" in part]
        text = "".join(part.get("text", "") for part in parts)

        if calls:
            answering = position
            messages.append(
                {
                    "role": "assistant",
                    "content": text or None,
                    "tool_calls": [
                        {
                            "id": _tool_call_id(position, index),
                            "type": "function",
                            "function": {
                                "name": call.get("name", ""),
                                "arguments": json.dumps(call.get("args") or {}),
                            },
                        }
                        for index, call in enumerate(calls)
                    ],
                }
            )
        elif results:
            for index, result in enumerate(results):
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": _tool_call_id(answering, index),
                        "content": str((result.get("response") or {}).get("result", "")),
                    }
                )
        else:
            messages.append(
                {
                    "role": "assistant" if entry.get("role") == "model" else "user",
                    "content": text,
                }
            )
    return messages


def _as_parts(message: dict[str, Any]) -> dict[str, Any]:
    """One OpenAI message as the Gemini-shaped content the loop reads."""
    parts: list[dict[str, Any]] = []

    for call in message.get("tool_calls") or []:
        function = call.get("function") or {}
        raw = function.get("arguments") or "{}"
        try:
            arguments = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            # A model that emits unparseable arguments has made a mistake it
            # can recover from, so it is passed along as an empty call rather
            # than crashing the run: the tool will refuse it and say why.
            logger.info("superset_agent.bad_arguments", tool=function.get("name"), raw=raw[:200])
            arguments = {}
        parts.append({"functionCall": {"name": function.get("name", ""), "args": arguments}})

    text = message.get("content")
    if text:
        parts.append({"text": text})

    return {"parts": parts}


def _openai_compatible(
    settings: AppSettings,
    model: str,
    contents: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    sleep: Any = None,
) -> dict[str, Any]:
    """One turn against any provider speaking the OpenAI chat API."""
    import time

    import httpx

    sleep = sleep or time.sleep
    url = f"{settings.dashboard_agent_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": _as_messages(contents),
        # Plain JSON Schema, which is the point of coming this way.
        "tools": [{"type": "function", "function": tool} for tool in tools],
        "tool_choice": "auto",
    }

    for attempt in range(1, _ATTEMPTS + 1):
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {settings.dashboard_agent_api_key}"},
            json=payload,
            timeout=300,
        )
        if response.status_code not in _RETRYABLE or attempt == _ATTEMPTS:
            break
        delay = _wait_for(response, attempt)
        logger.info(
            "superset_agent.retrying",
            status=response.status_code,
            attempt=attempt,
            waiting=delay,
            model=model,
        )
        sleep(delay)

    if response.status_code >= 400:
        tried = f" after {_ATTEMPTS} attempts" if response.status_code in _RETRYABLE else ""
        raise DashboardRequestError(
            f"The model API refused the request{tried}: HTTP "
            f"{response.status_code} for model {model!r}. {response.text[:400]}"
        )

    choices = response.json().get("choices") or []
    if not choices:
        raise DashboardRequestError("The model returned no choices.")
    return _as_parts(choices[0].get("message") or {})


_BACKENDS: dict[str, Any] = {"gemini": _gemini, "openai": _openai_compatible}


def build_dashboard(
    request: str,
    *,
    schema: str,
    mcp_url: str,
    history: list[tuple[str, str]] | None = None,
    settings: AppSettings | None = None,
    model: str = "",
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
        model: Which Gemini model to drive. Empty takes
            ``settings.dashboard_agent_model``, which is settable in the
            environment — a model name that a particular API key cannot use is
            a configuration problem, and fixing it should not need a rebuild.
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
    provider = settings.dashboard_agent_provider
    # Checked whatever the caller injects: a missing credential is a fact
    # about the configuration, not about who is making the call.
    if provider == "gemini" and not settings.gemini_api_key:
        raise DashboardRequestError("GEMINI_API_KEY is not set.")
    if provider == "openai" and not settings.dashboard_agent_api_key:
        raise DashboardRequestError("DASHBOARD_AGENT_API_KEY is not set.")
    model = model or settings.dashboard_agent_model

    call_model = generate or _BACKENDS[provider]
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
        declarations = _declarations(_select(tools, settings.dashboard_agent_tools))

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
                            "response": {"result": _for_the_model(result)},
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
