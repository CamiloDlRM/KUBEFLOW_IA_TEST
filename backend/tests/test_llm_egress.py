"""Tests for what leaves for an external language model (core.llm_egress).

Two promises. In a general project nothing changes: every agent sends what
it sent before, and nothing is recorded. In a project that holds health data
structure leaves and data does not — cell outputs are withheld, tool answers
lose their rows, anything shaped like an identifier is scrubbed — and every
call is recorded.
"""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from sqlmodel import select

from core.config import AppSettings
from core.llm_egress import (
    WITHHELD_OUTPUTS,
    Egress,
    advisor_recipient,
    dashboard_recipient,
    egress_for,
    recipient,
    record,
    scrub,
)
from core.mcp import MCPTool
from core.superset_agent import build_dashboard
from models.schemas import GoldTable, LlmEgress, Pipeline
from tests.test_medallion_api import own_project  # noqa: F401
from tests.test_privacy import mark_health
from tests.test_superset_agent import FakeMCP, answers_in, replies

#: A value that, if it ever appears in what is sent, means a row got out.
SENTINEL = "Ana Diaz 999-12-3456"

PHASES = [
    {"name": "dataset", "status": "success", "logs": "Mounted gold v3 (1,200 rows)"},
    {"name": "execute", "status": "success", "logs": json.dumps([{"cell": 3, "output": f"   name  ssn\n0  {SENTINEL}"}])},
    {"name": "register", "status": "failed", "logs": "KeyError: 'target' — contact ana@hospital.org"},
]


class TestScrub:
    def test_identifiers_are_removed(self):
        text, counts = scrub(
            "write to ana@hospital.org or +57 300 123 4567; ssn 999-12-3456, cedula 1045678901, "
            "patient ps_0123456789abcdef0123"
        )

        for leaked in ("ana@hospital.org", "300 123 4567", "999-12-3456", "1045678901", "ps_0123"):
            assert leaked not in text
        assert set(counts) == {"email", "phone", "ssn", "document", "pseudonym"}

    @pytest.mark.parametrize(
        "kept",
        ["accuracy 0.912345678", "run 3f2a9c0d8e7b6a5f4c3d2e1f0a9b8c7d", "2026-11-19 10:30", "15,884 rows", "n=1200"],
    )
    def test_what_a_diagnosis_needs_survives(self, kept):
        assert scrub(kept)[0] == kept


class TestAGeneralProjectIsUntouched:
    def test_everything_passes_through_and_nothing_is_recorded(self, db_session, own_project):
        egress = egress_for(db_session, own_project.id, "advisor.analysis")

        assert egress.health is False
        assert egress.text(SENTINEL) == SENTINEL
        assert egress.phases(PHASES) == PHASES
        assert egress.tool_result('{"data": [1]}') == '{"data": [1]}'
        record(db_session, egress, "gemini", "gemini-pro")
        assert db_session.exec(select(LlmEgress)).all() == []

    def test_the_advisor_sends_exactly_what_it_sent_before(self, db_session, own_project):
        from core.ai_advisor import generate_insight

        prompts = []
        backend = lambda settings, model, prompt, *rest: prompts.append(prompt) or "report"  # noqa: E731
        kwargs = dict(notebook={"cells": []}, status="failed", metrics={"accuracy": 0.9}, phases=PHASES,
                      history=[], commit_sha="abc")
        with patch.dict("core.ai_advisor._BACKENDS", {"anthropic": backend, "gemini": backend, "ollama": backend}), \
             patch("core.ai_advisor.advisor_configured", return_value=True):
            generate_insight(**kwargs)
            generate_insight(**kwargs, egress=egress_for(db_session, own_project.id, "advisor.analysis"))

        assert prompts[0] == prompts[1]
        assert SENTINEL in prompts[0]


class TestAHealthProject:
    def test_cell_outputs_are_withheld_and_errors_kept(self):
        egress = Egress(agent="advisor.analysis", health=True)

        guarded = egress.phases(PHASES)

        assert guarded[0]["logs"] == PHASES[0]["logs"]
        assert guarded[1]["logs"] == WITHHELD_OUTPUTS
        assert "KeyError: 'target'" in guarded[2]["logs"]
        assert "ana@hospital.org" not in guarded[2]["logs"]
        assert egress.withheld == {"cell_outputs": 1, "email": 1}

    def test_the_advisor_never_sends_a_row(self, db_session, own_project):
        from core.ai_advisor import generate_insight

        mark_health(db_session, own_project)
        prompts = []
        backend = lambda settings, model, prompt, *rest: prompts.append(prompt) or "report"  # noqa: E731
        egress = egress_for(db_session, own_project.id, "advisor.analysis")
        with patch.dict("core.ai_advisor._BACKENDS", {"anthropic": backend, "gemini": backend, "ollama": backend}), \
             patch("core.ai_advisor.advisor_configured", return_value=True):
            generate_insight(
                notebook={"cells": [{"cell_type": "code", "source": "df = load()\nprint(df.head())"}]},
                status="failed", metrics={"accuracy": 0.9}, phases=PHASES, history=[], commit_sha="abc",
                egress=egress, data_columns=["age", "encounter_class", "target"],
            )

        assert SENTINEL not in prompts[0] and "Ana" not in prompts[0]
        assert "print(df.head())" in prompts[0], "the code is what the diagnosis is made from"
        assert "KeyError: 'target'" in prompts[0]
        assert "age, encounter_class, target" in prompts[0]
        assert egress.sent_chars == len(prompts[0])

    def test_a_call_is_recorded(self, db_session, own_project):
        mark_health(db_session, own_project)
        egress = egress_for(db_session, own_project.id, "advisor.analysis")
        egress.phases(PHASES)
        egress.outgoing("prompt")

        record(db_session, egress, "anthropic", "claude", ok=True)

        stored = db_session.exec(select(LlmEgress)).one()
        assert (stored.agent, stored.provider, stored.sent_chars) == ("advisor.analysis", "anthropic", 6)
        assert stored.withheld["cell_outputs"] == 1

    def test_the_advisor_is_given_column_names_instead_of_rows(self, db_session, db_engine, own_project):
        from tasks.celery_tasks import _advisor_egress

        mark_health(db_session, own_project)
        db_session.add(GoldTable(project_id=own_project.id, columns=["age", "target"]))
        pipeline = Pipeline(repo_id=1, project_id=own_project.id, status="failed")
        db_session.add(pipeline)
        db_session.commit()

        egress, columns = _advisor_egress(db_engine, pipeline.id, "advisor.analysis")

        assert egress.health and columns == ["age", "target"]


class TestTheRecordSaysWhoReceivedTheCall:
    def test_a_named_provider_is_enough(self):
        assert advisor_recipient(AppSettings(ai_advisor_provider="anthropic")) == "anthropic"
        assert dashboard_recipient(AppSettings(dashboard_agent_provider="gemini")) == "gemini"

    def test_an_openai_compatible_endpoint_is_named_by_its_host(self):
        settings = AppSettings(dashboard_agent_provider="openai", dashboard_agent_base_url="https://api.groq.com/openai/v1")

        assert dashboard_recipient(settings) == "openai (api.groq.com)"

    def test_a_local_model_is_named_by_its_host(self):
        settings = AppSettings(ai_advisor_provider="ollama", ollama_base_url="http://host.docker.internal:11434")

        assert advisor_recipient(settings) == "ollama (host.docker.internal)"

    def test_without_a_url_the_provider_stands_alone(self):
        assert recipient("openai") == "openai"


class TestTheDashboardAgent:
    def tools(self, *names):
        return [MCPTool(name, f"does {name}", {"type": "object", "properties": {}}) for name in names]

    def run(self, egress, answer):
        mcp = FakeMCP(tools=self.tools("generate_chart", "execute_sql"), answers={"generate_chart": answer})
        model = replies(
            {"parts": [{"functionCall": {"name": "generate_chart", "args": {}}}]},
            {"parts": [{"text": "Built it."}]},
        )
        settings = AppSettings(gemini_api_key="k", dashboard_agent_tools="*")
        build_dashboard("chart admissions", schema="gold(age, target)", mcp_url="http://mcp", settings=settings,
                        generate=model, client=mcp, egress=egress)
        return model

    def test_rows_in_a_tool_answer_never_reach_the_model(self):
        answer = json.dumps({"chart_id": 7, "data": [{"name": "Ana", "age": 44}], "preview": "Ana | 44"})

        model = self.run(Egress(agent="dashboard", health=True), answer)

        sent = json.dumps(answers_in(model.contents))
        assert "Ana" not in sent and '\\"chart_id\\": 7' in sent

    def test_no_tool_beyond_the_default_set_can_be_switched_on(self):
        model = self.run(Egress(agent="dashboard", health=True), "{}")

        offered = json.dumps(model.tools)
        assert "execute_sql" not in offered

    def test_a_general_project_keeps_its_configuration_and_answers(self):
        answer = json.dumps({"chart_id": 7, "data": [{"name": "Ana"}]})

        model = self.run(Egress(agent="dashboard", health=False), answer)

        assert "execute_sql" in json.dumps(model.tools)
        assert "Ana" in json.dumps(answers_in(model.contents))


class TestTheGoldSuggestion:
    def test_a_health_project_records_the_call(self, test_app, db_session, own_project):
        from core.ai_gold import GoldSuggestion

        mark_health(db_session, own_project)

        def suggest(described, question, egress=None, **_):
            egress.outgoing("schema only")
            return GoldSuggestion(sql="SELECT 1", explanation="")

        with patch("routers.medallion._silver_paths", return_value={"his_1": ["x"]}), \
             patch("core.gold.describe_relations", return_value={}), \
             patch("core.ai_gold.suggest_definition", side_effect=suggest):
            response = test_app.post(f"/projects/{own_project.id}/medallion/gold/suggest", json={"question": "admissions by class"})

        assert response.status_code == 200, response.text
        stored = db_session.exec(select(LlmEgress)).one()
        assert stored.agent == "gold.suggest"
        body = test_app.get(f"/projects/{own_project.id}/privacy").json()
        assert body["egress_total"] == 1 and body["egress"][0]["agent"] == "gold.suggest"
