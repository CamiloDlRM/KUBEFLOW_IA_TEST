"""Tests that the migrations actually run.

This file exists because of a bug that stopped a deployment booting. Migration
0014 built its INSERT with ``sa.text`` and then asked the result for
``inserted_primary_key``, which only an ``insert()`` construct can answer. It
was wrong on every database and would have failed the first time anyone ran it
— and nothing ran it, because the rest of the suite builds its schema from the
models with ``create_all``.

So five hundred tests passed against a schema no migration had produced, which
is the gap this closes. These run the real migration files, in order, against a
real (if small) database, and check the one thing ``create_all`` can never
check: that the data already there survives the upgrade.

SQLite, not Postgres. That does not exercise the dialect branches, and the
migrations that have them say so — but it does catch the mistakes that are
wrong everywhere, which is the class of bug that got through.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture()
def migrated(tmp_path):
    """An empty SQLite database and a configured alembic, ready to upgrade."""
    database = tmp_path / "migrations.db"
    url = f"sqlite:///{database}"

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    # env.py prefers the environment over the ini, so the ini alone would send
    # the migrations at whatever DATABASE_URL happens to be set.
    config.attributes["connection"] = None

    engine = sa.create_engine(url)
    return config, engine, url


def _upgrade(config, url: str, revision: str, monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", url)
    command.upgrade(config, revision)


def _columns(engine, table: str) -> set[str]:
    with engine.connect() as connection:
        return {c["name"] for c in sa.inspect(connection).get_columns(table)}


def test_every_migration_runs_from_an_empty_database(migrated, monkeypatch):
    config, engine, url = migrated
    _upgrade(config, url, "head", monkeypatch)

    with engine.connect() as connection:
        tables = set(sa.inspect(connection).get_table_names())
    assert {"projects", "repositories", "data_sources", "ingestion_runs", "gold_tables"} <= tables


def test_the_schema_ends_up_with_the_columns_the_models_expect(migrated, monkeypatch):
    config, engine, url = migrated
    _upgrade(config, url, "head", monkeypatch)

    assert {"bronze_key", "silver_key", "quality_report"} <= _columns(engine, "ingestion_runs")
    assert "project_id" in _columns(engine, "repositories")


def test_a_repository_that_already_existed_is_adopted_into_a_project(
    migrated, monkeypatch
):
    """The case create_all can never exercise: data that was already there.

    0014 gives every existing repository a project of its own, carrying its
    owner. A repository that came out the other side unowned or unattached
    would be invisible to its owner and its data unreachable.
    """
    config, engine, url = migrated
    _upgrade(config, url, "0013", monkeypatch)

    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO users (id, username, hashed_password, role, is_active, created_at) "
                "VALUES (7, 'camilo', 'x', 'admin', 1, :now)"
            ),
            {"now": datetime.now(timezone.utc)},
        )
        connection.execute(
            sa.text(
                "INSERT INTO repositories (id, owner_id, github_url, branch, "
                "notebook_path, created_at, is_active) VALUES "
                "(1, 7, 'https://github.com/CamiloDlRM/Mlops-notebooks.git', 'main', "
                "'nb.ipynb', :now, 1)"
            ),
            {"now": datetime.now(timezone.utc)},
        )

    _upgrade(config, url, "head", monkeypatch)

    with engine.connect() as connection:
        row = connection.execute(
            sa.text(
                "SELECT p.id, p.name, p.owner_id FROM projects p "
                "JOIN repositories r ON r.project_id = p.id WHERE r.id = 1"
            )
        ).fetchone()

    assert row is not None, "the repository was left without a project"
    assert row[1] == "Mlops-notebooks", "the project should be recognisable in a list"
    assert row[2] == 7, "it must keep its owner, or it disappears for them"


def test_two_repositories_get_a_project_each(migrated, monkeypatch):
    """Merging them would be a guess about which belonged together."""
    config, engine, url = migrated
    _upgrade(config, url, "0013", monkeypatch)

    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO users (id, username, hashed_password, role, is_active, created_at) "
                "VALUES (7, 'camilo', 'x', 'admin', 1, :now)"
            ),
            {"now": now},
        )
        for repo_id, url_text in ((1, "https://github.com/a/first.git"), (2, "https://github.com/a/second.git")):
            connection.execute(
                sa.text(
                    "INSERT INTO repositories (id, owner_id, github_url, branch, "
                    "notebook_path, created_at, is_active) VALUES "
                    "(:id, 7, :url, 'main', 'nb.ipynb', :now, 1)"
                ),
                {"id": repo_id, "url": url_text, "now": now},
            )

    _upgrade(config, url, "head", monkeypatch)

    with engine.connect() as connection:
        projects = connection.execute(
            sa.text("SELECT count(*) FROM projects")
        ).scalar()
        distinct = connection.execute(
            sa.text("SELECT count(DISTINCT project_id) FROM repositories")
        ).scalar()

    assert projects == 2
    assert distinct == 2


def test_running_the_upgrade_twice_changes_nothing(migrated, monkeypatch):
    """Both containers run `alembic upgrade head` on boot, and one restarts."""
    config, engine, url = migrated
    _upgrade(config, url, "head", monkeypatch)
    _upgrade(config, url, "head", monkeypatch)

    with engine.connect() as connection:
        assert connection.execute(sa.text("SELECT count(*) FROM projects")).scalar() == 0


def test_a_null_json_column_is_backfilled_rather_than_left(migrated, monkeypatch):
    """0013's reason for existing: rows older than a column hold NULL, and the
    code that reads them called .get on it."""
    config, engine, url = migrated
    _upgrade(config, url, "0012", monkeypatch)

    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO repositories (id, github_url, branch, notebook_path, "
                "created_at, is_active) VALUES (1, 'https://github.com/a/b.git', "
                "'main', 'nb.ipynb', :now, 1)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO data_sources (id, repo_id, name, kind, host, port, "
                "database, username, password_env, extraction_sql, watermark_column, "
                "watermark_value, created_at, is_active) VALUES "
                "(1, 1, 'S', 'postgres', 'h', 5432, 'd', 'u', 'E', 'sql', 'w', '', :now, 1)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                # Only quality_report: 0008 declared profile NOT NULL, which is
                # the pattern 0011 broke and 0013 restores.
                "INSERT INTO ingestion_runs (id, source_id, status, watermark_before, "
                "watermark_after, rows_extracted, error, profile, quality_report) VALUES "
                "('r1', 1, 'success', '', '', 10, '', '{}', NULL)"
            )
        )

    _upgrade(config, url, "head", monkeypatch)

    with engine.connect() as connection:
        row = connection.execute(
            sa.text("SELECT quality_report FROM ingestion_runs WHERE id = 'r1'")
        ).fetchone()

    assert row[0] == "{}", "a run older than the column must not be left holding NULL"
