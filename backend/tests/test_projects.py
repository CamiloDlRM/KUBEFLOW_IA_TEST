"""Tests for projects: the container the data factory will hang off.

The tenant boundary gets the most attention, because a project is where
ownership is now decided and the linking endpoint is the one place where two
resources meet — a caller who can see a project must not be able to attach
somebody else's repository to it, which would put that repository's pipelines
under this project's roof.
"""
from __future__ import annotations

import pytest

from models.schemas import Project, Repository
from tests.conftest import DEFAULT_USER_ID, seed_repo


def create(client, name: str = "Hospital readmissions", **body):
    return client.post("/projects", json={"name": name, **body})


@pytest.fixture()
def own_project(db_session):
    project = Project(name="Mine", owner_id=DEFAULT_USER_ID)
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


@pytest.fixture()
def other_project(db_session):
    project = Project(name="Theirs", owner_id=2)
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


class TestCreating:
    def test_a_project_needs_only_a_name(self, test_app):
        """The whole point: work can start before there is a repository."""
        response = create(test_app)

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Hospital readmissions"
        assert body["repository"] is None

    def test_a_project_belongs_to_whoever_created_it(self, test_app):
        body = create(test_app).json()
        assert body["owner_id"] == DEFAULT_USER_ID

    def test_an_empty_name_is_refused(self, test_app):
        assert test_app.post("/projects", json={"name": ""}).status_code == 422

    def test_a_project_with_no_repository_is_a_normal_state(self, test_app):
        body = create(test_app).json()
        assert body["sources"] == 0
        assert body["gold_rows"] == 0


class TestVisibility:
    def test_only_own_projects_are_listed(self, test_app, own_project, other_project):
        names = {project["name"] for project in test_app.get("/projects").json()}
        assert names == {"Mine"}

    def test_an_admin_sees_every_project(self, admin_app, own_project, other_project):
        names = {project["name"] for project in admin_app.get("/projects").json()}
        assert {"Mine", "Theirs"} <= names

    def test_another_tenants_project_is_not_found(self, test_app, other_project):
        assert test_app.get(f"/projects/{other_project.id}").status_code == 404

    def test_a_project_owned_by_nobody_is_invisible_to_members(
        self, test_app, db_session
    ):
        """Fails closed, the same as an orphan repository: an unowned project
        must not become visible to everyone."""
        orphan = Project(name="Orphan", owner_id=None)
        db_session.add(orphan)
        db_session.commit()
        db_session.refresh(orphan)

        assert test_app.get(f"/projects/{orphan.id}").status_code == 404
        assert all(p["name"] != "Orphan" for p in test_app.get("/projects").json())

    def test_an_archived_project_is_gone_from_the_list(self, test_app, own_project):
        test_app.delete(f"/projects/{own_project.id}")
        assert test_app.get("/projects").json() == []

    def test_archiving_keeps_the_row(self, test_app, db_session, own_project):
        """Its datasets are the lineage of models that may still be deployed."""
        test_app.delete(f"/projects/{own_project.id}")

        db_session.expire_all()
        assert db_session.get(Project, own_project.id) is not None

    def test_another_tenant_cannot_archive_a_project(self, test_app, other_project):
        assert test_app.delete(f"/projects/{other_project.id}").status_code == 404


class TestRenaming:
    def test_a_project_can_be_renamed(self, test_app, own_project):
        response = test_app.patch(
            f"/projects/{own_project.id}", json={"name": "Renamed"}
        )
        assert response.json()["name"] == "Renamed"

    def test_another_tenant_cannot_rename_it(self, test_app, other_project):
        response = test_app.patch(
            f"/projects/{other_project.id}", json={"name": "Hijacked"}
        )
        assert response.status_code == 404


class TestLinkingARepository:
    def test_a_repository_can_be_linked_and_is_reported(
        self, test_app, db_session, own_project
    ):
        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)

        response = test_app.put(
            f"/projects/{own_project.id}/repository", params={"repo_id": repo.id}
        )

        assert response.status_code == 200
        assert response.json()["repository"]["id"] == repo.id

    def test_linking_records_the_project_on_the_repository(
        self, test_app, db_session, own_project
    ):
        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)
        test_app.put(f"/projects/{own_project.id}/repository", params={"repo_id": repo.id})

        db_session.expire_all()
        assert db_session.get(Repository, repo.id).project_id == own_project.id

    def test_somebody_elses_repository_cannot_be_attached(
        self, test_app, db_session, own_project
    ):
        """Seeing the project is not authority over every repository there is."""
        theirs = seed_repo(
            db_session, owner_id=2, github_url="https://github.com/other/repo"
        )

        response = test_app.put(
            f"/projects/{own_project.id}/repository", params={"repo_id": theirs.id}
        )

        assert response.status_code == 404
        db_session.expire_all()
        assert db_session.get(Repository, theirs.id).project_id is None

    def test_a_repository_cannot_be_attached_to_somebody_elses_project(
        self, test_app, db_session, other_project
    ):
        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)
        response = test_app.put(
            f"/projects/{other_project.id}/repository", params={"repo_id": repo.id}
        )
        assert response.status_code == 404

    def test_unlinking_leaves_the_repository_alone(
        self, test_app, db_session, own_project
    ):
        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)
        test_app.put(f"/projects/{own_project.id}/repository", params={"repo_id": repo.id})

        response = test_app.delete(f"/projects/{own_project.id}/repository")

        assert response.status_code == 200
        assert response.json()["repository"] is None
        db_session.expire_all()
        stored = db_session.get(Repository, repo.id)
        assert stored is not None and stored.is_active

    def test_unlinking_when_there_is_nothing_linked_says_so(
        self, test_app, own_project
    ):
        response = test_app.delete(f"/projects/{own_project.id}/repository")
        assert response.status_code == 404
        assert "no repository linked" in response.json()["detail"]

    def test_a_repository_moves_rather_than_belonging_to_two_projects(
        self, test_app, db_session, own_project
    ):
        second = Project(name="Second", owner_id=DEFAULT_USER_ID)
        db_session.add(second)
        db_session.commit()
        db_session.refresh(second)
        repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)

        test_app.put(f"/projects/{own_project.id}/repository", params={"repo_id": repo.id})
        test_app.put(f"/projects/{second.id}/repository", params={"repo_id": repo.id})

        assert test_app.get(f"/projects/{own_project.id}").json()["repository"] is None
        assert test_app.get(f"/projects/{second.id}").json()["repository"]["id"] == repo.id
