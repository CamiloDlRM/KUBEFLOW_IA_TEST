"""The agent loop, with both ends faked.

What cannot be tested here is the only thing that matters in production: that
Superset's real MCP server accepts these calls. What can be tested is
everything between — that a tool the model asks for is actually run, that its
answer goes back in the shape Gemini expects, that a runaway model is stopped,
and that the schemas handed to Gemini are ones it will accept.
"""
from __future__ import annotations

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
