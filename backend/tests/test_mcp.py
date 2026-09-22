"""The MCP client, against a server that only exists in this file.

`httpx.MockTransport` is doing real work here: the request is built, headers
and all, and the assertions are about what actually went over the wire. A test
that stubbed the client's own methods would pass whatever the transport did.
"""
from __future__ import annotations

import json

import httpx
import pytest

from core.mcp import MCPClient, MCPError, MCPTool


def server(handler):
    """An MCPClient wired to a fake server, already handshaken."""
    client = MCPClient("http://superset-mcp:5008/mcp")
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    return client


def ok(request: httpx.Request, result: dict, headers: dict | None = None):
    body = json.loads(request.content)
    return httpx.Response(
        200,
        json={"jsonrpc": "2.0", "id": body.get("id"), "result": result},
        headers=headers or {},
    )


# ---------------------------------------------------------------------------
# The handshake
# ---------------------------------------------------------------------------


class TestConnecting:
    def test_says_who_it_is_and_then_says_it_is_ready(self):
        seen: list[dict] = []

        def handler(request):
            body = json.loads(request.content)
            seen.append(body)
            if body["method"] == "initialize":
                return ok(request, {"serverInfo": {"name": "superset"}})
            return httpx.Response(202)

        client = server(handler)
        client.connect()

        assert [call["method"] for call in seen] == [
            "initialize",
            "notifications/initialized",
        ]
        assert client.server_name == "superset"

    def test_the_ready_notification_carries_no_id(self):
        """A notification with an id is a request, and a server may answer it."""
        seen: list[dict] = []

        def handler(request):
            body = json.loads(request.content)
            seen.append(body)
            if body["method"] == "initialize":
                return ok(request, {})
            return httpx.Response(202)

        client = server(handler)
        client.connect()

        assert "id" not in seen[1]

    def test_the_session_id_is_echoed_on_every_later_request(self):
        """Without it the second call arrives as a stranger."""
        headers: list[str | None] = []

        def handler(request):
            headers.append(request.headers.get("mcp-session-id"))
            body = json.loads(request.content)
            if body["method"] == "initialize":
                return ok(request, {}, headers={"Mcp-Session-Id": "sess-42"})
            if body["method"] == "tools/list":
                return ok(request, {"tools": []})
            return httpx.Response(202)

        client = server(handler)
        client.connect()
        client.tools()

        assert headers[0] is None, "there is no session until the server issues one"
        assert headers[1:] == ["sess-42", "sess-42"]


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------


class TestTransport:
    def test_reads_a_reply_that_arrives_as_an_event_stream(self):
        """Both are allowed answers to the same POST, and it is the server's
        choice. A client that only parses JSON works against one server and
        silently fails against the next."""

        def handler(request):
            message = {"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}
            return httpx.Response(
                200,
                text=f"event: message\ndata: {json.dumps(message)}\n\n",
                headers={"content-type": "text/event-stream"},
            )

        client = server(handler)
        assert client.tools() == []

    def test_accepts_both_content_types(self):
        seen: list[str] = []

        def handler(request):
            seen.append(request.headers.get("accept", ""))
            return ok(request, {"tools": []})

        client = server(handler)
        client.tools()

        assert "application/json" in seen[0]
        assert "text/event-stream" in seen[0]

    def test_an_http_failure_names_the_status(self):
        client = server(lambda request: httpx.Response(503, text="no upstream"))

        with pytest.raises(MCPError, match="503"):
            client.tools()

    def test_a_jsonrpc_error_is_raised_rather_than_returned_as_a_result(self):
        def handler(request):
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "error": {"code": -32601, "message": "method not found"},
                },
            )

        client = server(handler)
        with pytest.raises(MCPError, match="method not found"):
            client.tools()


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


class TestTools:
    def test_lists_what_the_server_offers(self):
        def handler(request):
            return ok(
                request,
                {
                    "tools": [
                        {
                            "name": "list_charts",
                            "description": "Charts you can see",
                            "inputSchema": {"type": "object", "properties": {}},
                        }
                    ]
                },
            )

        client = server(handler)
        tools = client.tools()

        assert tools == [
            MCPTool(
                name="list_charts",
                description="Charts you can see",
                schema={"type": "object", "properties": {}},
            )
        ]

    def test_follows_pagination_to_the_end(self):
        """A server that pages its tools would otherwise hand the model half
        of them, and the missing half is invisible: the model just never calls
        what it was never told about."""
        pages = iter(
            [
                {"tools": [{"name": "one"}], "nextCursor": "more"},
                {"tools": [{"name": "two"}]},
            ]
        )
        client = server(lambda request: ok(request, next(pages)))

        assert [tool.name for tool in client.tools()] == ["one", "two"]

    def test_a_tool_result_comes_back_as_text(self):
        def handler(request):
            return ok(request, {"content": [{"type": "text", "text": "dashboard 7"}]})

        client = server(handler)
        assert client.call("create_dashboard", {"title": "Encounters"}) == "dashboard 7"

    def test_a_failing_tool_is_reported_to_the_model_not_raised(self):
        """The failure is the model's to handle: it asked for a chart on a
        column that does not exist, and the useful next step is for it to read
        the message and try again."""

        def handler(request):
            return ok(
                request,
                {"content": [{"type": "text", "text": "no such column"}], "isError": True},
            )

        client = server(handler)
        answer = client.call("create_chart", {"column": "nope"})

        assert "no such column" in answer
        assert "error" in answer.lower()

    def test_non_text_content_is_named_rather_than_dropped(self):
        """A model handed nothing assumes the call failed."""

        def handler(request):
            return ok(request, {"content": [{"type": "image", "data": "..."}]})

        client = server(handler)
        assert client.call("screenshot", {}) == "[image content]"

    def test_the_arguments_go_where_the_protocol_says(self):
        seen: dict = {}

        def handler(request):
            seen.update(json.loads(request.content))
            return ok(request, {"content": []})

        client = server(handler)
        client.call("create_chart", {"title": "Encounters by class"})

        assert seen["method"] == "tools/call"
        assert seen["params"] == {
            "name": "create_chart",
            "arguments": {"title": "Encounters by class"},
        }


def test_a_closed_client_says_so_rather_than_failing_obscurely():
    client = MCPClient("http://superset-mcp:5008/mcp")
    with pytest.raises(MCPError, match="not open"):
        client.tools()


class TestTheServerNotBeingThere:
    """A refused connection is an operational fact, not a crash.

    Unwrapped it reaches the caller as a raw httpx error and becomes a 500 with
    a stack trace, when the true answer — "that address is not answering" — is
    one a user can act on. This is what production did.
    """

    def _refused(self, request):
        raise httpx.ConnectError("[Errno 111] Connection refused")

    def test_a_refused_connection_names_the_address_and_says_it_may_be_down(self):
        client = server(self._refused)

        with pytest.raises(MCPError) as caught:
            client.connect()

        message = str(caught.value)
        assert "http://superset-mcp:5008/mcp" in message
        assert "may not be running" in message

    def test_a_timeout_is_reported_the_same_way(self):
        def slow(request):
            raise httpx.ReadTimeout("took too long")

        client = server(slow)
        with pytest.raises(MCPError, match="Could not reach"):
            client.tools()
