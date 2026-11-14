"""The in-app notebook editor: reading a notebook's cells and committing edits.

GET/PUT /repos/{id}/notebook, and the merge they rest on (core.notebook_edit).
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from core.notebook_edit import apply_edits, editor_cells, serialize
from tests.conftest import OTHER_USER_ID, seed_repo, seed_repo_in_project


def _notebook() -> dict:
    return {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Title\n", "Some text"]},
            {
                "cell_type": "code",
                "metadata": {"tags": ["mlops:training"]},
                "execution_count": 3,
                "outputs": [{"output_type": "stream", "name": "stdout", "text": ["old\n"]}],
                "source": ["x = 1\n", "print(x)"],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "execution_count": 4,
                "outputs": [{"output_type": "stream", "name": "stdout", "text": ["kept\n"]}],
                "source": "y = 2",
            },
        ],
        "metadata": {"kernelspec": {"name": "python3"}},
        "nbformat": 4,
        "nbformat_minor": 5,
    }


RAW = serialize(_notebook())


class TestMerge:
    def test_editor_cells_carry_text_and_tags_but_no_outputs(self):
        cells = editor_cells(_notebook())

        assert cells[1] == {"index": 1, "cell_type": "code", "source": "x = 1\nprint(x)", "tags": ["mlops:training"]}
        assert all("outputs" not in cell for cell in cells)

    def test_an_edited_code_cell_loses_its_outputs_and_the_others_keep_theirs(self):
        notebook = _notebook()

        changed = apply_edits(notebook, {1: "x = 2\nprint(x)\n", 2: "y = 2"})

        assert changed == 1
        assert notebook["cells"][1]["source"] == ["x = 2\n", "print(x)\n"]
        assert notebook["cells"][1]["outputs"] == []
        assert notebook["cells"][1]["execution_count"] is None
        assert notebook["cells"][1]["metadata"] == {"tags": ["mlops:training"]}
        # Sent but identical: untouched, outputs and all.
        assert notebook["cells"][2] == _notebook()["cells"][2]

    def test_a_string_source_stays_a_string(self):
        notebook = _notebook()

        apply_edits(notebook, {2: "y = 3\nz = 4"})

        assert notebook["cells"][2]["source"] == "y = 3\nz = 4"

    def test_an_edit_to_a_missing_cell_is_refused(self):
        with pytest.raises(ValueError):
            apply_edits(_notebook(), {9: "nope"})

    def test_untouched_notebook_serializes_back_to_the_same_bytes(self):
        assert serialize(json.loads(RAW)) == RAW


@pytest.fixture()
def github_file():
    """core.github.get_file / put_file, with the notebook above on GitHub."""
    with patch("core.github.get_file", new_callable=AsyncMock) as get, patch(
        "core.github.put_file", new_callable=AsyncMock
    ) as put:
        get.return_value = (RAW, "sha-1")
        put.return_value = ("commit-1", "sha-2")
        yield get, put


def _save(test_app, repo_id: int, **overrides):
    body = {
        "branch": "main",
        "notebook_path": "notebooks/train.ipynb",
        "sha": "sha-1",
        "message": "",
        "cells": [{"index": 1, "source": "x = 99"}],
    }
    body.update(overrides)
    return test_app.put(f"/repos/{repo_id}/notebook", json=body)


class TestReadNotebook:
    def test_returns_the_cells_and_the_file_sha(self, test_app, db_session, github_file):
        repo = seed_repo(db_session)

        resp = test_app.get(f"/repos/{repo.id}/notebook", params={"branch": "dev", "path": "nb/a.ipynb"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["sha"] == "sha-1"
        assert [cell["cell_type"] for cell in data["cells"]] == ["markdown", "code", "code"]
        assert data["linked_projects"] == []

    def test_names_the_projects_a_push_would_run(self, test_app, db_session, github_file):
        repo = seed_repo_in_project(db_session)

        resp = test_app.get(
            f"/repos/{repo.id}/notebook", params={"branch": "main", "path": "notebooks/train.ipynb"}
        )

        assert len(resp.json()["linked_projects"]) == 1

    def test_refuses_a_file_that_is_not_a_notebook(self, test_app, db_session, github_file):
        repo = seed_repo(db_session)

        resp = test_app.get(f"/repos/{repo.id}/notebook", params={"branch": "main", "path": "README.md"})

        assert resp.status_code == 400

    def test_another_users_repository_is_not_found(self, test_app, db_session, github_file):
        repo = seed_repo(db_session, owner_id=OTHER_USER_ID, github_url="https://github.com/other/repo")

        resp = test_app.get(f"/repos/{repo.id}/notebook", params={"branch": "main", "path": "a.ipynb"})

        assert resp.status_code == 404


class TestSaveNotebook:
    def test_commits_the_edit_to_the_same_branch_over_the_opened_version(self, test_app, db_session, github_file):
        _, put = github_file
        repo = seed_repo(db_session)

        resp = _save(test_app, repo.id, branch="dev", message="Tune x")

        assert resp.status_code == 200
        assert resp.json() == {"commit_sha": "commit-1", "sha": "sha-2", "changed_cells": 1}
        _, _, branch, path, content, message, sha = put.await_args.args
        assert (branch, path, message, sha) == ("dev", "notebooks/train.ipynb", "Tune x", "sha-1")
        saved = json.loads(content)
        assert saved["cells"][1]["source"] == ["x = 99"]
        assert saved["cells"][1]["outputs"] == []
        assert saved["cells"][2]["outputs"] == _notebook()["cells"][2]["outputs"]

    def test_an_empty_message_gets_a_default_one(self, test_app, db_session, github_file):
        _, put = github_file
        repo = seed_repo(db_session)

        _save(test_app, repo.id)

        assert put.await_args.args[5] == "Update notebooks/train.ipynb from Maia"

    def test_a_notebook_that_changed_on_github_is_not_overwritten(self, test_app, db_session, github_file):
        _, put = github_file
        repo = seed_repo(db_session)

        resp = _save(test_app, repo.id, sha="stale-sha")

        assert resp.status_code == 409
        put.assert_not_awaited()

    def test_nothing_is_committed_when_nothing_changed(self, test_app, db_session, github_file):
        _, put = github_file
        repo = seed_repo(db_session)

        resp = _save(test_app, repo.id, cells=[{"index": 2, "source": "y = 2"}])

        assert resp.status_code == 400
        put.assert_not_awaited()

    def test_another_users_repository_cannot_be_written(self, test_app, db_session, github_file):
        _, put = github_file
        repo = seed_repo(db_session, owner_id=OTHER_USER_ID, github_url="https://github.com/other/repo")

        resp = _save(test_app, repo.id)

        assert resp.status_code == 404
        put.assert_not_awaited()


CELLS = [
    {"index": 0, "cell_type": "markdown", "source": "# Title", "tags": []},
    {"index": 1, "cell_type": "code", "source": "model.fit(X)", "tags": ["mlops:training"]},
]


@pytest.fixture()
def maia(monkeypatch):
    """The AI provider, answering what the test sets as ``maia.return_value``."""
    from unittest.mock import MagicMock

    from core.config import get_settings

    monkeypatch.setenv("AI_ADVISOR_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    get_settings.cache_clear()
    provider = MagicMock(return_value='{"comment": "X is not defined.", "cells": []}')
    with patch.dict("core.ai_advisor._BACKENDS", {"anthropic": provider}):
        yield provider
    get_settings.cache_clear()


def _review(test_app, repo_id: int, **overrides):
    body = {"cells": CELLS, "focus_index": 1, "error": "NameError: X"}
    body.update(overrides)
    return test_app.post(f"/repos/{repo_id}/notebook/review", json=body)


class TestReviewNotebook:
    def test_returns_maias_comment_and_her_proposal_for_the_cell(self, test_app, db_session, maia):
        repo = seed_repo(db_session)
        maia.return_value = json.dumps(
            {"comment": "X is not defined.", "cells": [{"index": 1, "source": "model.fit(X_train)"}]}
        )

        resp = _review(test_app, repo.id)

        assert resp.status_code == 200
        assert resp.json() == {
            "comment": "X is not defined.",
            "cells": [{"index": 1, "source": "model.fit(X_train)"}],
        }
        prompt = maia.call_args.args[2]
        assert "Revisa la celda 1" in prompt and "NameError: X" in prompt and "model.fit(X)" in prompt

    def test_reviews_the_whole_notebook_when_no_cell_is_selected(self, test_app, db_session, maia):
        repo = seed_repo(db_session)

        resp = _review(test_app, repo.id, focus_index=None, error="")

        assert resp.status_code == 200
        assert "Revisa todo el notebook" in maia.call_args.args[2]

    def test_drops_proposals_for_cells_the_editor_cannot_rewrite(self, test_app, db_session, maia):
        repo = seed_repo(db_session)
        maia.return_value = json.dumps(
            {"comment": "ok", "cells": [{"index": 0, "source": "# New"}, {"index": 7, "source": "x"}]}
        )

        assert _review(test_app, repo.id).json()["cells"] == []

    def test_an_answer_in_prose_is_shown_as_the_comment(self, test_app, db_session, maia):
        repo = seed_repo(db_session)
        maia.return_value = "Define X before fitting."

        assert _review(test_app, repo.id).json() == {"comment": "Define X before fitting.", "cells": []}

    def test_a_selected_cell_that_was_not_sent_is_refused(self, test_app, db_session, maia):
        repo = seed_repo(db_session)

        assert _review(test_app, repo.id, focus_index=9).status_code == 400
        maia.assert_not_called()

    def test_a_notebook_too_long_to_send_is_refused_unless_a_cell_is_selected(self, test_app, db_session, maia):
        repo = seed_repo(db_session)
        cells = [CELLS[1], {"index": 2, "cell_type": "code", "source": "x" * 200_001, "tags": []}]

        assert _review(test_app, repo.id, cells=cells, focus_index=None).status_code == 413
        assert _review(test_app, repo.id, cells=cells, focus_index=1).status_code == 200
        assert "xxxx" not in maia.call_args.args[2]

    def test_another_users_repository_is_not_found(self, test_app, db_session, maia):
        repo = seed_repo(db_session, owner_id=OTHER_USER_ID, github_url="https://github.com/other/repo")

        assert _review(test_app, repo.id).status_code == 404
        maia.assert_not_called()

    def test_says_so_when_no_ai_provider_is_configured(self, test_app, db_session, monkeypatch):
        from core.config import get_settings

        monkeypatch.setenv("AI_ADVISOR_PROVIDER", "anthropic")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        get_settings.cache_clear()
        repo = seed_repo(db_session)

        assert _review(test_app, repo.id).status_code == 503
        get_settings.cache_clear()
