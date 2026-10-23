"""A small MCP client: enough for a model to drive another system's tools.

The Model Context Protocol is JSON-RPC 2.0 with a handshake. A server says
which tools it has and what arguments each takes; a client calls them. That is
the whole of what is needed here, so that is the whole of what this implements
— no resources, no prompts, no sampling, no server-initiated requests.

Two details of the HTTP transport are easy to miss and both break everything:

The server may answer a plain POST with an event stream instead of JSON. Both
carry the same JSON-RPC message, so the content type has to be checked rather
than assumed, and a client that only parses JSON will work against one server
and silently fail against the next.

``initialize`` may hand back an ``Mcp-Session-Id``, and every later request has
to echo it. Without it the second call arrives as a stranger and is refused.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

__all__ = ["MCPError", "MCPTool", "MCPClient"]

#: The revision of the protocol this client speaks. Servers negotiate: they
#: answer with the version they will use, which may not be this one.
PROTOCOL_VERSION = "2025-06-18"


class MCPError(RuntimeError):
    """The server refused, or answered with something that is not a result."""


@dataclass(frozen=True)
class MCPTool:
    """One tool a server offers."""

    name: str
    description: str
    #: JSON Schema for the arguments. Passed to the model, which is what makes
    #: the model able to call the tool without being told about it by hand.
    schema: dict[str, Any]


class MCPClient:
    """One connection to one MCP server.

    Used as a context manager, because the handshake has to happen before any
    tool call and the session should not outlive the work it was opened for.
    """

    def __init__(
        self,
        url: str,
        *,
        timeout: float = 120.0,
        client_name: str = "mlops-platform",
    ) -> None:
        self.url = url
        self.timeout = timeout
        self.client_name = client_name
        self._http: Any = None
        self._session_id: str | None = None
        self._next_id = 0
        self.server_name: str = ""

    # ------------------------------------------------------------------ life
    def __enter__(self) -> "MCPClient":
        import httpx

        self._http = httpx.Client(timeout=self.timeout)
        self.connect()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        if self._http is not None:
            self._http.close()
            self._http = None

    def connect(self) -> None:
        """Handshake: say who we are, then say we are ready."""
        result = self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": self.client_name, "version": "1"},
            },
        )
        self.server_name = (result.get("serverInfo") or {}).get("name", "")
        # A notification, not a request: the server acknowledges by accepting
        # it, and answering it would be a protocol error.
        self._rpc("notifications/initialized", {}, notify=True)
        logger.info(
            "mcp.connected",
            url=self.url,
            server=self.server_name,
            protocol=result.get("protocolVersion"),
        )

    # ----------------------------------------------------------------- tools
    def tools(self) -> list[MCPTool]:
        """Every tool the server offers, following pagination to the end."""
        found: list[MCPTool] = []
        cursor: str | None = None
        while True:
            params = {"cursor": cursor} if cursor else {}
            result = self._rpc("tools/list", params)
            for tool in result.get("tools") or []:
                found.append(
                    MCPTool(
                        name=tool["name"],
                        description=tool.get("description", ""),
                        schema=tool.get("inputSchema") or {"type": "object"},
                    )
                )
            cursor = result.get("nextCursor")
            if not cursor:
                return found

    def call(self, name: str, arguments: dict[str, Any]) -> str:
        """Run one tool and return what it said, as text.

        A tool that fails answers with ``isError`` rather than a JSON-RPC
        error, because the failure is the model's to handle: it asked for a
        chart on a column that does not exist, and the useful next step is for
        it to read the message and try again, not for the request to blow up.
        """
        result = self._rpc("tools/call", {"name": name, "arguments": arguments})
        text = _as_text(result.get("content") or [])

        # A tool with an output schema answers in `structuredContent`, and the
        # text block that is supposed to mirror it is a SHOULD, not a MUST.
        # Reading only `content` turned every listing into an empty string: the
        # model asked for the gold database ten different ways, heard nothing
        # each time, and spent its whole run asking.
        structured = result.get("structuredContent")
        if not text and structured is not None:
            text = json.dumps(structured, default=str, ensure_ascii=False)

        if result.get("isError"):
            logger.info("mcp.tool_failed", tool=name, detail=text[:200])
            return f"The tool reported an error: {text}"

        # Said, rather than passed on as nothing. An empty answer reads to a
        # model as "ask again"; this one reads as an answer.
        return text or "(The tool returned no content.)"

    # ------------------------------------------------------------------- rpc
    def _rpc(
        self, method: str, params: dict[str, Any], *, notify: bool = False
    ) -> dict[str, Any]:
        if self._http is None:
            raise MCPError("The MCP client is not open.")

        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            self._next_id += 1
            body["id"] = self._next_id

        headers = {
            "Content-Type": "application/json",
            # Both are allowed answers to the same POST, and which one arrives
            # is the server's choice.
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id

        import httpx

        try:
            response = self._http.post(self.url, json=body, headers=headers)
        except httpx.HTTPError as exc:
            # A server that is not there raises from the transport, below the
            # level anything else in this file knows about. Left unwrapped it
            # reaches the caller as a raw httpx error and becomes a 500 with a
            # stack trace, when the true answer — "that address is not
            # answering" — is one a user can act on.
            raise MCPError(
                f"Could not reach the MCP server at {self.url}: {exc}. "
                "It may not be running."
            ) from exc

        if response.status_code >= 400:
            raise MCPError(
                f"{method} failed: HTTP {response.status_code} {response.text[:300]}"
            )

        session = response.headers.get("mcp-session-id")
        if session:
            self._session_id = session

        if notify:
            return {}

        message = _parse(response, body.get("id"))
        if "error" in message:
            error = message["error"]
            raise MCPError(
                f"{method} was refused: {error.get('message', error)} "
                f"(code {error.get('code')})"
            )
        return message.get("result") or {}


def _parse(response: Any, expected_id: int | None = None) -> dict[str, Any]:
    """The JSON-RPC response to our request, from JSON or from an event stream.

    An event stream can carry several messages before the one we asked for:
    the server is allowed to send log lines and progress notifications on the
    same stream, and then the response. This used to return the *first*
    message, which was fine for tools that say nothing while they work and
    returned `{}` for the ones that log first — every listing Superset has.
    The model asked for the gold database a dozen times and was answered
    each time with a log line it never saw.

    So every message on the stream is read, and the one carrying our id is
    the answer. Notifications have no id and are not answers.
    """
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" not in content_type:
        try:
            return response.json()
        except ValueError as exc:  # pragma: no cover - server contract break
            raise MCPError(f"Expected JSON, got {response.text[:200]!r}") from exc

    messages: list[dict[str, Any]] = []
    # Events are separated by a blank line. One event's data may span several
    # `data:` lines, which join with newlines; everything else is framing.
    for event in response.text.replace("\r\n", "\n").split("\n\n"):
        data = "\n".join(
            line[len("data:") :].removeprefix(" ")
            for line in event.split("\n")
            if line.startswith("data:")
        ).strip()
        if not data:
            continue
        try:
            messages.append(json.loads(data))
        except json.JSONDecodeError:
            logger.info("mcp.unreadable_event", data=data[:200])

    if expected_id is not None:
        for message in messages:
            if message.get("id") == expected_id:
                return message
    # No id to match against, or a server that answered under another: the
    # last thing that is a response rather than a notification.
    for message in reversed(messages):
        if "result" in message or "error" in message:
            return message
    raise MCPError(
        f"The event stream carried no response, only {len(messages)} "
        "notification(s)."
    )


def _as_text(content: list[dict[str, Any]]) -> str:
    """Flatten a tool result to text the model can read.

    Non-text blocks are named rather than dropped: a model told an image came
    back can say so, where a model handed nothing will assume it failed.
    """
    parts: list[str] = []
    for block in content:
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
        else:
            parts.append(f"[{block.get('type', 'unknown')} content]")
    return "\n".join(part for part in parts if part).strip()
