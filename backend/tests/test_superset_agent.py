"""The agent loop, with both ends faked.

What cannot be tested here is the only thing that matters in production: that
Superset's real MCP server accepts these calls. What can be tested is
everything between — that a tool the model asks for is actually run, that its
answer goes back in the shape Gemini expects, that a runaway model is stopped,
and that the schemas handed to Gemini are ones it will accept.
"""
from __future__ import annotations

import copy

import pytest

from core.config import AppSettings
from core.mcp import MCPTool
from core.superset_agent import (
    MAX_TURNS,
    DashboardRequestError,
    build_dashboard,
    to_gemini_schema,
)


class FakeMCP:
    """An MCP server that records what it was asked and answers as told."""

    def __init__(self, tools=None, answers=None):
        # `tools or [...]` would turn "this server offers nothing" back into
        # the default, which is the case one of these tests is about.
        self._tools = (
            [MCPTool("create_chart", "Make a chart", {"type": "object", "properties": {}})]
            if tools is None
            else tools
        )
        self._answers = answers or {}
        self.calls: list[tuple[str, dict]] = []
        self.closed = False

    def tools(self):
        return self._tools

    def call(self, name, arguments):
        self.calls.append((name, arguments))
        return self._answers.get(name, "done")

    def close(self):
        self.closed = True


def replies(*turns):
    """A Gemini that returns each scripted turn in order."""
    script = iter(turns)

    def generate(settings, model, contents, tools):
        generate.contents = contents
        generate.tools = tools
        return next(script)

    generate.contents = []
    generate.tools = []
    return generate


def answers_in(contents: list[dict]) -> list[dict]:
    """The messages carrying tool results, found rather than indexed.

    The conversation is one list mutated in place, so a fixed index means
    "whatever happened to be last", which is the model's closing text.
    """
    return [
        message
        for message in contents
        if any("functionResponse" in part for part in message["parts"])
    ]


def text(message: str) -> dict:
    return {"parts": [{"text": message}]}


def wants(name: str, **args) -> dict:
    return {"parts": [{"functionCall": {"name": name, "args": args}}]}


@pytest.fixture()
def settings():
    return AppSettings(gemini_api_key="key-for-tests")


def run(generate, mcp, **kwargs):
    return build_dashboard(
        "a dashboard of encounters by class",
        schema="encounters(encounter_class TEXT, started_at TIMESTAMP)",
        mcp_url="http://superset-mcp:5008/mcp",
        generate=generate,
        client=mcp,
        **kwargs,
    )


class TestTheLoop:
    def test_a_model_that_answers_without_tools_is_done(self, settings):
        mcp = FakeMCP()
        result = run(replies(text("Nothing to build.")), mcp, settings=settings)

        assert result.summary == "Nothing to build."
        assert result.calls == []
        assert result.turns == 1

    def test_a_tool_the_model_asks_for_is_actually_run(self, settings):
        mcp = FakeMCP()
        result = run(
            replies(wants("create_chart", title="By class"), text("Built it.")),
            mcp,
            settings=settings,
        )

        assert mcp.calls == [("create_chart", {"title": "By class"})]
        assert result.summary == "Built it."
        assert result.turns == 2

    def test_the_result_goes_back_in_the_shape_gemini_expects(self, settings):
        """A functionResponse that is not shaped this way is not an error: the
        model simply never sees what the tool said, and carries on guessing."""
        mcp = FakeMCP(answers={"create_chart": "chart 12 created"})
        generate = replies(wants("create_chart", title="x"), text("done"))
        run(generate, mcp, settings=settings)

        answer = answers_in(generate.contents)[0]
        assert answer["role"] == "user"
        assert answer["parts"] == [
            {
                "functionResponse": {
                    "name": "create_chart",
                    "response": {"result": "chart 12 created"},
                }
            }
        ]

    def test_several_tools_in_one_turn_are_answered_in_one_message(self, settings):
        mcp = FakeMCP()
        turn = {
            "parts": [
                {"functionCall": {"name": "create_chart", "args": {"n": 1}}},
                {"functionCall": {"name": "create_chart", "args": {"n": 2}}},
            ]
        }
        generate = replies(turn, text("done"))
        result = run(generate, mcp, settings=settings)

        assert len(mcp.calls) == 2
        answers = answers_in(generate.contents)
        assert len(answers) == 1, "one message, not one per call"
        assert len(answers[0]["parts"]) == 2
        assert len(result.calls) == 2

    def test_what_the_model_did_is_returned_not_only_what_it_said(self, settings):
        """So a dashboard that came out wrong can be read back, rather than
        inferred from the model's own account of itself."""
        mcp = FakeMCP(answers={"create_chart": "chart 3"})
        result = run(
            replies(wants("create_chart", title="By class"), text("Built it.")),
            mcp,
            settings=settings,
        )

        assert result.calls[0].name == "create_chart"
        assert result.calls[0].arguments == {"title": "By class"}
        assert result.calls[0].result == "chart 3"

    def test_a_model_that_never_finishes_is_stopped(self, settings):
        """Each turn costs a call to Gemini and however many tools it asked
        for. A loop with no bound is a bill with no bound."""
        mcp = FakeMCP()
        forever = replies(*[wants("create_chart") for _ in range(MAX_TURNS + 5)])
        result = run(forever, mcp, settings=settings)

        assert result.exhausted is True
        assert result.turns == MAX_TURNS
        assert str(MAX_TURNS) in result.summary

    def test_the_model_is_told_the_schema_and_the_request(self, settings):
        """Told, rather than left to discover: discovery costs a tool call per
        guess and the platform already knows the answer."""
        generate = replies(text("ok"))
        run(generate, FakeMCP(), settings=settings)

        asked = generate.contents[0]["parts"][0]["text"]
        assert "encounter_class" in asked
        assert "encounters by class" in asked

    def test_a_server_with_no_tools_is_refused_before_the_model_is_called(
        self, settings
    ):
        def never(*args, **kwargs):  # pragma: no cover - must not be reached
            raise AssertionError("the model should not have been called")

        with pytest.raises(DashboardRequestError, match="no tools"):
            run(never, FakeMCP(tools=[]), settings=settings)

    def test_a_client_passed_in_is_not_closed_by_the_agent(self, settings):
        """It belongs to the caller, who may have more to do with it."""
        mcp = FakeMCP()
        run(replies(text("ok")), mcp, settings=settings)
        assert mcp.closed is False

    def test_without_an_api_key_it_says_so(self):
        with pytest.raises(DashboardRequestError, match="GEMINI_API_KEY"):
            run(replies(text("ok")), FakeMCP(), settings=AppSettings(gemini_api_key=""))


class TestSchemaTranslation:
    """Gemini takes an OpenAPI subset, not JSON Schema, and rejects the whole
    request over one key it does not know."""

    def test_drops_the_keys_gemini_rejects(self):
        translated = to_gemini_schema(
            {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "additionalProperties": False,
                "title": "CreateChart",
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": ["name"],
            }
        )

        assert translated == {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }

    def test_keeps_the_descriptions_because_they_are_what_the_model_reads(self):
        translated = to_gemini_schema(
            {
                "type": "object",
                "properties": {
                    "uid": {"type": "string", "description": "The dashboard id"}
                },
            }
        )
        assert translated["properties"]["uid"]["description"] == "The dashboard id"

    def test_a_nullable_union_becomes_a_type_gemini_can_express(self):
        assert to_gemini_schema({"type": ["string", "null"]}) == {
            "type": "string",
            "nullable": True,
        }

    def test_recurses_into_arrays_and_nested_objects(self):
        translated = to_gemini_schema(
            {
                "type": "object",
                "properties": {
                    "charts": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": True,
                            "properties": {"id": {"type": "integer"}},
                        },
                    }
                },
            }
        )

        item = translated["properties"]["charts"]["items"]
        assert "additionalProperties" not in item
        assert item["properties"] == {"id": {"type": "integer"}}

    def test_a_no_argument_tool_still_has_properties(self):
        """Gemini rejects an object with none, which is how a tool that takes
        nothing arrives."""
        assert to_gemini_schema({"type": "object"}) == {
            "type": "object",
            "properties": {},
        }

    def test_an_unknown_type_becomes_a_string_rather_than_breaking_the_request(self):
        assert to_gemini_schema({"type": "date-time"})["type"] == "string"

    def test_something_that_is_not_a_schema_at_all_is_survivable(self):
        assert to_gemini_schema(None) == {"type": "string"}  # type: ignore[arg-type]


class TestWhenSupersetIsNotThere:
    def test_an_unreachable_server_is_refused_as_a_dashboard_error(self, settings):
        """Not as whatever the transport raised: the endpoint maps this error
        to a 422 with the message in it, and anything else becomes a 500."""
        from core.mcp import MCPError

        class Unreachable(FakeMCP):
            def tools(self):
                raise MCPError("Could not reach the MCP server at http://x. ")

        def never(*args, **kwargs):  # pragma: no cover - must not be reached
            raise AssertionError("the model should not have been called")

        with pytest.raises(DashboardRequestError, match="Could not reach"):
            run(never, Unreachable(), settings=settings)

    def test_losing_the_server_mid_loop_keeps_what_was_already_done(self, settings):
        """Those calls already happened in Superset. Discarding the record of
        them would leave a dashboard nobody can account for."""
        from core.mcp import MCPError

        class Flaky(FakeMCP):
            def call(self, name, arguments):
                self.calls.append((name, arguments))
                if len(self.calls) > 1:
                    raise MCPError("connection lost")
                return "ok"

        turn = {
            "parts": [
                {"functionCall": {"name": "create_chart", "args": {"n": 1}}},
                {"functionCall": {"name": "create_chart", "args": {"n": 2}}},
            ]
        }
        result = run(replies(turn, text("unreachable")), Flaky(), settings=settings)

        assert len(result.calls) == 1
        assert "stopped answering" in result.summary
        assert "connection lost" in result.summary


class TestWhenTheModelApiRefuses:
    """A 404 from Google is a configuration fact, not a crash.

    Which model names a key may use depends on the account, so the name is
    settable in the environment — and when it is wrong the message has to
    carry Google's own explanation, because that is the part that says which
    names would have worked.
    """

    def _refusing(self, status: int, body: str):
        def generate(settings, model, contents, tools):
            from core.superset_agent import DashboardRequestError

            raise DashboardRequestError(
                f"The model API refused the request: HTTP {status} "
                f"for model {model!r}. {body}"
            )

        return generate

    def test_the_model_name_comes_from_the_settings(self, settings):
        seen = {}

        def generate(settings, model, contents, tools):
            seen["model"] = model
            return text("done")

        settings.dashboard_agent_model = "gemini-3-whatever"
        run(generate, FakeMCP(), settings=settings)

        assert seen["model"] == "gemini-3-whatever"

    def test_an_explicit_model_still_wins(self, settings):
        seen = {}

        def generate(settings, model, contents, tools):
            seen["model"] = model
            return text("done")

        run(generate, FakeMCP(), settings=settings, model="gemini-chosen")
        assert seen["model"] == "gemini-chosen"

    def test_a_refusal_names_the_model_and_carries_the_reason(self, settings):
        body = "models/gemini-2.5-pro is not found for API version v1beta"
        with pytest.raises(DashboardRequestError) as caught:
            run(self._refusing(404, body), FakeMCP(), settings=settings)

        message = str(caught.value)
        assert "404" in message
        assert "not found for API version" in message


class TestTheOpenAiCompatibleBackend:
    """Groq, OpenRouter and the rest: one dialect, translated at the edges.

    The loop speaks Gemini's shape and keeps doing so, so what is worth
    pinning is the translation — it is the part that fails silently. A result
    attached to the wrong call, or arguments arriving as a JSON string the
    loop never parses, produce a model that is merely confused rather than an
    error anyone can see.
    """

    def _settings(self):
        return AppSettings(
            dashboard_agent_provider="openai",
            dashboard_agent_api_key="gsk-for-tests",
            dashboard_agent_base_url="https://api.groq.com/openai/v1",
            dashboard_agent_model="openai/gpt-oss-120b",
        )

    def _reply(self, monkeypatch, message):
        import httpx

        from core import superset_agent

        sent = {}

        def post(url, **kwargs):
            sent["url"] = url
            sent["headers"] = kwargs.get("headers", {})
            sent["json"] = kwargs.get("json", {})
            return httpx.Response(200, json={"choices": [{"message": message}]})

        monkeypatch.setattr(httpx, "post", post)
        return superset_agent, sent

    def test_it_posts_where_the_openai_dialect_lives(self, monkeypatch):
        agent, sent = self._reply(monkeypatch, {"content": "hola"})
        agent._openai_compatible(self._settings(), "m", [], [], sleep=lambda _: None)

        assert sent["url"] == "https://api.groq.com/openai/v1/chat/completions"
        assert sent["headers"]["Authorization"] == "Bearer gsk-for-tests"

    def test_the_schemas_travel_whole(self, monkeypatch):
        """The point of coming this way: no OpenAPI subset to trim down to."""
        agent, sent = self._reply(monkeypatch, {"content": "ok"})
        tools = [
            {
                "name": "create_chart",
                "description": "Make one",
                "parameters": {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"title": {"type": "string"}},
                },
            }
        ]
        agent._openai_compatible(self._settings(), "m", [], tools, sleep=lambda _: None)

        sent_tool = sent["json"]["tools"][0]
        assert sent_tool["type"] == "function"
        assert sent_tool["function"]["parameters"]["$schema"], "not trimmed"
        assert sent_tool["function"]["parameters"]["additionalProperties"] is False

    def test_a_tool_call_comes_back_as_the_loop_expects(self, monkeypatch):
        agent, _ = self._reply(
            monkeypatch,
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_abc",
                        "type": "function",
                        "function": {
                            "name": "create_chart",
                            "arguments": '{"title": "By class"}',
                        },
                    }
                ],
            },
        )

        content = agent._openai_compatible(
            self._settings(), "m", [], [], sleep=lambda _: None
        )

        # Parsed, not handed over as the JSON string the API sends.
        assert content["parts"] == [
            {"functionCall": {"name": "create_chart", "args": {"title": "By class"}}}
        ]

    def test_unparseable_arguments_do_not_end_the_run(self, monkeypatch):
        """A model that emits broken JSON has made a mistake it can recover
        from: the tool refuses the empty call and says why."""
        agent, _ = self._reply(
            monkeypatch,
            {
                "tool_calls": [
                    {"function": {"name": "create_chart", "arguments": "{oops"}}
                ]
            },
        )

        content = agent._openai_compatible(
            self._settings(), "m", [], [], sleep=lambda _: None
        )
        assert content["parts"][0]["functionCall"]["args"] == {}

    def test_a_result_names_the_call_it_answers(self, monkeypatch):
        """OpenAI pairs a result to its call by id and Gemini's shape has
        none. Mismatch them and the model is told the answer to a question it
        did not ask."""
        agent, sent = self._reply(monkeypatch, {"content": "done"})
        contents = [
            {"role": "user", "parts": [{"text": "build it"}]},
            {
                "role": "model",
                "parts": [
                    {"functionCall": {"name": "a", "args": {}}},
                    {"functionCall": {"name": "b", "args": {}}},
                ],
            },
            {
                "role": "user",
                "parts": [
                    {"functionResponse": {"name": "a", "response": {"result": "ra"}}},
                    {"functionResponse": {"name": "b", "response": {"result": "rb"}}},
                ],
            },
        ]

        agent._openai_compatible(self._settings(), "m", contents, [], sleep=lambda _: None)

        messages = sent["json"]["messages"]
        assistant = next(m for m in messages if m.get("tool_calls"))
        results = [m for m in messages if m.get("role") == "tool"]

        assert [c["id"] for c in assistant["tool_calls"]] == [
            r["tool_call_id"] for r in results
        ], "each result carries the id of the call it answers"
        assert [r["content"] for r in results] == ["ra", "rb"]

    def test_the_system_prompt_leads_the_conversation(self, monkeypatch):
        agent, sent = self._reply(monkeypatch, {"content": "ok"})
        agent._openai_compatible(
            self._settings(),
            "m",
            [{"role": "user", "parts": [{"text": "hola"}]}],
            [],
            sleep=lambda _: None,
        )

        messages = sent["json"]["messages"]
        assert messages[0]["role"] == "system"
        assert messages[1] == {"role": "user", "content": "hola"}

    def test_the_provider_decides_which_backend_runs(self, monkeypatch):
        """End to end through build_dashboard, with only the HTTP faked."""
        agent, sent = self._reply(monkeypatch, {"content": "Built it."})

        result = build_dashboard(
            "a dashboard",
            schema="gold(a TEXT)",
            mcp_url="http://superset-mcp:5008/mcp",
            client=FakeMCP(),
            settings=self._settings(),
        )

        assert result.summary == "Built it."
        assert sent["json"]["model"] == "openai/gpt-oss-120b"

    def test_without_a_token_it_says_which_one(self):
        settings = self._settings()
        settings.dashboard_agent_api_key = ""

        with pytest.raises(DashboardRequestError, match="DASHBOARD_AGENT_API_KEY"):
            build_dashboard(
                "x", schema="y", mcp_url="z", client=FakeMCP(), settings=settings
            )


class TestRidingOutADemandSpike:
    """A 503 means "ask again", and a run makes up to MAX_TURNS model calls.

    Without retries the chance of finishing a dashboard on a busy free tier is
    the chance of not meeting one spike a dozen times in a row.
    """

    def _answers(self, monkeypatch, *responses):
        import httpx

        queue = iter(responses)
        calls = []

        def post(url, **kwargs):
            calls.append(url)
            return next(queue)

        monkeypatch.setattr(httpx, "post", post)
        return calls

    @staticmethod
    def _busy(headers=None):
        import httpx

        return httpx.Response(
            503, json={"error": {"code": 503, "message": "high demand"}}, headers=headers or {}
        )

    @staticmethod
    def _ok():
        import httpx

        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": "done"}]}}]}
        )

    def test_a_spike_is_ridden_out_rather_than_failing_the_run(self, monkeypatch, settings):
        from core import superset_agent

        calls = self._answers(monkeypatch, self._busy(), self._busy(), self._ok())
        slept = []

        content = superset_agent._gemini(settings, "m", [], [], sleep=slept.append)

        assert content["parts"][0]["text"] == "done"
        assert len(calls) == 3
        assert slept == [2.0, 4.0], "backs off rather than hammering"

    def test_it_gives_up_eventually_and_says_how_hard_it_tried(self, monkeypatch, settings):
        from core import superset_agent

        calls = self._answers(monkeypatch, *[self._busy() for _ in range(superset_agent._ATTEMPTS)])

        with pytest.raises(DashboardRequestError) as caught:
            superset_agent._gemini(settings, "m", [], [], sleep=lambda _: None)

        assert len(calls) == superset_agent._ATTEMPTS
        assert "attempts" in str(caught.value)
        assert "high demand" in str(caught.value)

    def test_a_refusal_that_will_not_change_is_not_retried(self, monkeypatch, settings):
        """A 404 is the wrong model name. Asking again more slowly does not
        make it the right one."""
        import httpx

        from core import superset_agent

        calls = self._answers(monkeypatch, httpx.Response(404, json={"error": {}}))

        with pytest.raises(DashboardRequestError) as caught:
            superset_agent._gemini(settings, "m", [], [], sleep=lambda _: None)

        assert len(calls) == 1
        assert "attempts" not in str(caught.value)

    def test_the_server_decides_the_wait_when_it_says_so(self, monkeypatch, settings):
        from core import superset_agent

        self._answers(monkeypatch, self._busy({"Retry-After": "7"}), self._ok())
        slept = []

        superset_agent._gemini(settings, "m", [], [], sleep=slept.append)

        assert slept == [7.0]


class TestFittingAFreeTier:
    """Every offered tool travels with every model call.

    On Groq's free tier, offering all ~45 of Superset's tools came to 10,303
    tokens in one request against a limit of 8,000 a minute — a 413 before the
    model had read a word of what was asked.
    """

    def _superset(self):
        names = [
            "health_check", "find_users", "generate_bug_report", "list_reports",
            "list_databases", "list_datasets", "create_virtual_dataset",
            "generate_chart", "generate_dashboard",
        ]
        return [MCPTool(name, f"does {name}", {"type": "object", "properties": {}}) for name in names]

    def _offered(self, settings, spec):
        seen = {}

        def generate(settings, model, contents, tools):
            seen["names"] = [tool["name"] for tool in tools]
            return text("done")

        settings.dashboard_agent_tools = spec
        run(generate, FakeMCP(tools=self._superset()), settings=settings)
        return seen["names"]

    def test_the_model_is_offered_what_the_job_uses(self, settings):
        offered = self._offered(settings, "")

        assert "generate_chart" in offered
        assert "create_virtual_dataset" in offered
        assert "generate_bug_report" not in offered
        assert "find_users" not in offered

    def test_the_set_can_be_named_in_the_environment(self, settings):
        assert self._offered(settings, "list_databases, generate_chart") == [
            "list_databases",
            "generate_chart",
        ]

    def test_a_star_offers_everything(self, settings):
        assert len(self._offered(settings, "*")) == len(self._superset())

    def test_names_that_match_nothing_fall_back_to_everything(self, settings):
        """If Superset renames its tools, a model with too many is slow; one
        with none can only apologise."""
        assert len(self._offered(settings, "renamed_tool, another")) == len(self._superset())

    def test_the_model_rereads_a_cut_listing_but_the_record_keeps_it_whole(self, settings):
        """The conversation carries every answer into every later call, so a
        long listing is paid for again on each turn — and a listing is paged,
        so asking for a narrower page is a real thing to do."""
        from core.superset_agent import MAX_RESULT_CHARS

        long_answer = "x" * (MAX_RESULT_CHARS * 3)
        mcp = FakeMCP(answers={"list_datasets": long_answer})
        generate = replies(wants("list_datasets"), text("done"))

        result = run(generate, mcp, settings=settings)

        shown = answers_in(generate.contents)[0]["parts"][0]["functionResponse"]
        assert len(shown["response"]["result"]) < len(long_answer)
        assert "more characters cut" in shown["response"]["result"]
        assert result.calls[0].result == long_answer, "the record is not cut"


class TestARejectedToolCall:
    """Groq checks every tool call against its schema before returning it.

    When the model gets one wrong it refuses the whole request with a 400
    `tool_use_failed`, instead of passing the bad call through. The first time
    this happened it ended the run, over `list_databases({})` — the model had
    left out the `request` wrapper that every Superset tool nests its
    arguments in. That is a slip the model can fix if it is told about it.
    """

    def _settings(self):
        return AppSettings(
            dashboard_agent_provider="openai",
            dashboard_agent_api_key="gsk-for-tests",
            dashboard_agent_model="openai/gpt-oss-120b",
        )

    @staticmethod
    def _rejected():
        import httpx

        return httpx.Response(
            400,
            json={
                "error": {
                    "message": "parameters for tool list_databases did not match "
                    "schema: errors: [missing properties: 'request']",
                    "type": "invalid_request_error",
                    "code": "tool_use_failed",
                    "failed_generation": '{"name": "list_databases", "arguments": {}}',
                }
            },
        )

    @staticmethod
    def _call():
        import httpx

        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "function": {
                                        "name": "list_databases",
                                        "arguments": '{"request": {}}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
        )

    def _answers(self, monkeypatch, *responses):
        import httpx

        queue = iter(responses)
        sent = []

        def post(url, **kwargs):
            # A copy, as the wire would take one: the backend extends the same
            # payload when it corrects the model, and holding a reference here
            # would make the first request look like the last.
            sent.append(copy.deepcopy(kwargs["json"]))
            return next(queue)

        monkeypatch.setattr(httpx, "post", post)
        return sent

    def test_the_model_is_told_what_was_wrong_and_asked_again(self, monkeypatch):
        from core import superset_agent

        sent = self._answers(monkeypatch, self._rejected(), self._call())

        content = superset_agent._openai_compatible(
            self._settings(), "m", [], [], sleep=lambda _: None
        )

        assert content["parts"][0]["functionCall"]["args"] == {"request": {}}
        correction = sent[1]["messages"][-1]["content"]
        assert "missing properties: 'request'" in correction
        assert '"arguments": {}' in correction, "it is shown what it sent"

    def test_the_correction_is_not_carried_into_the_next_turn(self, monkeypatch):
        """Once the call is valid, the valid call is what the conversation
        records. The correction was for one generation, not for the record."""
        import httpx

        from core import superset_agent

        done = httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
        sent = self._answers(monkeypatch, self._rejected(), self._call(), done)

        first = superset_agent._openai_compatible(
            self._settings(), "m", [], [], sleep=lambda _: None
        )
        # The next turn, built the way the loop builds it.
        contents = [
            {"role": "model", "parts": first["parts"]},
            {
                "role": "user",
                "parts": [
                    {"functionResponse": {"name": "list_databases", "response": {"result": "[]"}}}
                ],
            },
        ]
        superset_agent._openai_compatible(
            self._settings(), "m", contents, [], sleep=lambda _: None
        )

        next_turn = sent[2]["messages"]
        assert not any("rejected" in str(m.get("content")) for m in next_turn)

    def test_a_model_that_cannot_get_it_right_ends_the_run_with_the_reason(
        self, monkeypatch
    ):
        from core import superset_agent

        sent = self._answers(
            monkeypatch, *[self._rejected() for _ in range(superset_agent._CORRECTIONS + 1)]
        )

        with pytest.raises(DashboardRequestError) as caught:
            superset_agent._openai_compatible(
                self._settings(), "m", [], [], sleep=lambda _: None
            )

        assert len(sent) == superset_agent._CORRECTIONS + 1
        assert "tool_use_failed" in str(caught.value)

    def test_any_other_400_is_not_mistaken_for_a_fixable_call(self, monkeypatch):
        import httpx

        from core import superset_agent

        sent = self._answers(
            monkeypatch, httpx.Response(400, json={"error": {"code": "invalid_api_key"}})
        )

        with pytest.raises(DashboardRequestError):
            superset_agent._openai_compatible(
                self._settings(), "m", [], [], sleep=lambda _: None
            )

        assert len(sent) == 1


    def test_a_schema_is_never_cut(self, settings):
        """A schema whose end the model never sees is one it asks for again.
        Seven of twelve calls in the first run that reached Superset were
        get_chart_type_schema, each answered with the same truncated half."""
        from core.superset_agent import MAX_RESULT_CHARS

        schema = "{" + "s" * (MAX_RESULT_CHARS * 4) + "}"
        mcp = FakeMCP(answers={"get_chart_type_schema": schema})
        generate = replies(wants("get_chart_type_schema"), text("done"))

        run(generate, mcp, settings=settings)

        shown = answers_in(generate.contents)[0]["parts"][0]["functionResponse"]
        assert shown["response"]["result"] == schema

    def test_the_turn_limit_can_be_raised_in_the_environment(self, settings):
        settings.dashboard_agent_max_turns = 3
        forever = replies(*[wants("create_chart") for _ in range(10)])

        result = run(forever, FakeMCP(), settings=settings)

        assert result.turns == 3
        assert result.exhausted is True
        assert "3 turns" in result.summary
