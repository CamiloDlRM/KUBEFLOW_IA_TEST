"""The smoke e2e seed: what it creates, and that running it twice changes nothing."""
from __future__ import annotations

from sqlmodel import Session, select

from core.security import verify_password
from models.schemas import ModelDeployment, Pipeline, Project, Repository, User
from scripts.seed_e2e import (
    ADMIN_PROJECT,
    ADMIN_USERNAME,
    MEMBER_PROJECT,
    MEMBER_USERNAME,
    SEEDED_MODEL,
    SEEDED_RUN_ID,
    seed,
)


def _counts(session: Session) -> dict[str, int]:
    return {
        table.__name__: len(session.exec(select(table)).all())
        for table in (User, Project, Repository, Pipeline, ModelDeployment)
    }


def test_seed_creates_users_projects_and_a_deployed_run(db_engine):
    seed(db_engine, admin_password="admin-pass", member_password="member-pass")

    with Session(db_engine) as session:
        admin = session.exec(select(User).where(User.username == ADMIN_USERNAME)).one()
        member = session.exec(select(User).where(User.username == MEMBER_USERNAME)).one()
        assert admin.role == "admin"
        assert member.role == "member"
        assert verify_password("admin-pass", admin.hashed_password)
        assert verify_password("member-pass", member.hashed_password)

        admin_project = session.exec(select(Project).where(Project.name == ADMIN_PROJECT)).one()
        member_project = session.exec(select(Project).where(Project.name == MEMBER_PROJECT)).one()
        assert admin_project.owner_id == admin.id
        assert member_project.owner_id == member.id
        # A project may only link a repository of its own owner.
        assert session.get(Repository, admin_project.repo_id).owner_id == admin.id
        assert session.get(Repository, member_project.repo_id).owner_id == member.id

        run = session.get(Pipeline, SEEDED_RUN_ID)
        assert run.status == "success"
        assert run.project_id == admin_project.id
        deployment = session.exec(select(ModelDeployment).where(ModelDeployment.model_name == SEEDED_MODEL)).one()
        assert deployment.pipeline_id == SEEDED_RUN_ID


def test_seed_is_idempotent(db_engine):
    seed(db_engine, admin_password="admin-pass", member_password="member-pass")
    with Session(db_engine) as session:
        before = _counts(session)

    seed(db_engine, admin_password="other", member_password="other")

    with Session(db_engine) as session:
        assert _counts(session) == before
        admin = session.exec(select(User).where(User.username == ADMIN_USERNAME)).one()
        # An existing user keeps the password it was created with.
        assert verify_password("admin-pass", admin.hashed_password)


def test_seed_keeps_an_existing_admin(db_engine, ):
    from core.security import hash_password

    with Session(db_engine) as session:
        session.add(User(username=ADMIN_USERNAME, hashed_password=hash_password("first"), role="admin"))
        session.commit()

    seed(db_engine, admin_password="second", member_password="member-pass")

    with Session(db_engine) as session:
        admins = session.exec(select(User).where(User.username == ADMIN_USERNAME)).all()
        assert len(admins) == 1
        assert verify_password("first", admins[0].hashed_password)
