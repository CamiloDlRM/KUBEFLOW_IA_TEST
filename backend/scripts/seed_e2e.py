"""Seed the database the smoke e2e suite runs against.

Run by ``entrypoint.sh`` after the migrations when ``E2E_SEED=1`` (only
``docker-compose.e2e.yml`` sets it). Idempotent: every row is looked up by a
natural key first, so a restart of the container does not duplicate anything.

What it creates, and why the smoke specs need it:

- ``e2e-admin`` (admin) and ``e2e-member`` (member), with the passwords in
  ``E2E_ADMIN_PASSWORD`` / ``E2E_MEMBER_PASSWORD``.
- For each of them, a project linked to a repository with a fake GitHub URL
  and no webhook, so the projects page has something to list without GitHub.
- For the admin's project, one finished run and the model it deployed, so the
  pipelines and models pages have rows to read. No worker runs in the smoke
  stack, so nothing here is ever executed.

The member's rows exist for the tenancy spec: the member must get 404, not
403, for the admin's project.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Runnable as `python scripts/seed_e2e.py` from the backend directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.engine import Engine  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from core.security import hash_password  # noqa: E402
from models.schemas import ModelDeployment, Pipeline, Project, Repository, User  # noqa: E402

ADMIN_USERNAME = "e2e-admin"
MEMBER_USERNAME = "e2e-member"
ADMIN_PROJECT = "E2E Seeded"
MEMBER_PROJECT = "E2E Member Project"
SEEDED_RUN_ID = "e2e-seeded-run"
SEEDED_MODEL = "e2e-model"


def _user(session: Session, username: str, password: str, role: str) -> User:
    user = session.exec(select(User).where(User.username == username)).first()
    if user is None:
        user = User(
            username=username,
            hashed_password=hash_password(password),
            role=role,
            email=f"{username.split('@')[0]}@e2e.local",
        )
        session.add(user)
        session.flush()
    return user


def _project(session: Session, owner: User, name: str, repo_slug: str) -> Project:
    project = session.exec(select(Project).where(Project.name == name, Project.owner_id == owner.id)).first()
    if project is not None:
        return project
    repo = Repository(owner_id=owner.id, github_url=f"https://github.com/e2e/{repo_slug}", uses_owner_token=True)
    session.add(repo)
    session.flush()
    project = Project(
        name=name,
        description="Seeded for the smoke e2e suite.",
        owner_id=owner.id,
        repo_id=repo.id,
        branch="main",
        notebook_path="notebooks/train.ipynb",
    )
    session.add(project)
    session.flush()
    return project


def _finished_run(session: Session, project: Project) -> None:
    if session.get(Pipeline, SEEDED_RUN_ID) is not None:
        return
    finished = datetime.now(timezone.utc)
    phases = [
        {"name": name, "status": "success", "timestamp": finished.isoformat(), "logs": ""}
        for name in ("download", "validate", "execute", "log_mlflow", "deploy")
    ]
    session.add(
        Pipeline(
            id=SEEDED_RUN_ID,
            repo_id=project.repo_id,
            project_id=project.id,
            notebook_path=project.notebook_path,
            status="success",
            commit_sha="e2e0000000000000000000000000000000000000",
            branch="main",
            started_at=finished - timedelta(minutes=3),
            finished_at=finished,
            phases=phases,
            metrics={"accuracy": 0.93, "deployed": True},
            model_name=SEEDED_MODEL,
            model_version="1",
        )
    )
    session.flush()
    session.add(
        ModelDeployment(
            model_name=SEEDED_MODEL,
            version="1",
            accuracy=0.93,
            endpoint_url=f"http://model-server:8001/predict/{SEEDED_MODEL}",
            pipeline_id=SEEDED_RUN_ID,
        )
    )


def seed(engine: Engine, admin_password: str, member_password: str) -> None:
    with Session(engine) as session:
        admin = _user(session, ADMIN_USERNAME, admin_password, "admin")
        member = _user(session, MEMBER_USERNAME, member_password, "member")
        admin_project = _project(session, admin, ADMIN_PROJECT, "seeded-repo")
        _project(session, member, MEMBER_PROJECT, "member-repo")
        _finished_run(session, admin_project)
        session.commit()


def main() -> None:
    from db import engine

    seed(
        engine,
        admin_password=os.environ.get("E2E_ADMIN_PASSWORD", "e2e-admin-pass"),
        member_password=os.environ.get("E2E_MEMBER_PASSWORD", "e2e-member-pass"),
    )
    print("e2e seed: done")


if __name__ == "__main__":
    main()
