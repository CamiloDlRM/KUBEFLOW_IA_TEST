"""ROBLE REST API client for database operations.

Provides both async (RobleClient) and sync (RobleClientSync) implementations.
RobleClient uses httpx.AsyncClient for FastAPI routers.
RobleClientSync uses httpx.Client for Celery workers.
"""
from __future__ import annotations

import structlog
import httpx

logger = structlog.get_logger(__name__)


class RobleClient:
    """Async ROBLE REST API client for use in FastAPI."""

    def __init__(
        self,
        auth_base_url: str,
        db_base_url: str,
        email: str,
        password: str,
    ) -> None:
        self._auth_base_url = auth_base_url.rstrip("/")
        self._db_base_url = db_base_url.rstrip("/")
        self._email = email
        self._password = password
        self._access_token: str | None = None
        self._refresh_token: str | None = None

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    async def _login(self) -> None:
        """Authenticate with ROBLE and store tokens."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._auth_base_url}/login",
                json={"email": self._email, "password": self._password},
            )
            resp.raise_for_status()
            data = resp.json()
            self._access_token = data["accessToken"]
            self._refresh_token = data["refreshToken"]
            logger.info("roble.login_success")

    async def _do_refresh(self) -> bool:
        """Attempt to refresh the access token. Returns True on success."""
        if not self._refresh_token:
            return False
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{self._auth_base_url}/refresh-token",
                    json={"refreshToken": self._refresh_token},
                )
                resp.raise_for_status()
                data = resp.json()
                self._access_token = data["accessToken"]
                self._refresh_token = data.get("refreshToken", self._refresh_token)
                logger.info("roble.token_refreshed")
                return True
        except Exception:
            logger.warning("roble.refresh_failed")
            return False

    async def _ensure_authenticated(self) -> None:
        """Ensure we have a valid access token, refreshing or logging in as needed."""
        if not self._access_token:
            await self._login()
            return

        # Verify current token
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{self._auth_base_url}/verify-token",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                if resp.status_code == 200:
                    return
        except Exception:
            pass

        # Token invalid, try refresh
        if await self._do_refresh():
            return

        # Refresh failed, full login
        await self._login()

    # ------------------------------------------------------------------
    # HTTP wrapper
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        url: str,
        **kwargs,
    ) -> httpx.Response:
        """Make an authenticated request, retrying once on 401."""
        await self._ensure_authenticated()
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self._access_token}"

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.request(method, url, headers=headers, **kwargs)

            if resp.status_code == 401:
                # Try refresh and retry once
                if await self._do_refresh():
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = await client.request(method, url, headers=headers, **kwargs)
                else:
                    await self._login()
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = await client.request(method, url, headers=headers, **kwargs)

            resp.raise_for_status()
            return resp

    # ------------------------------------------------------------------
    # Table operations
    # ------------------------------------------------------------------

    async def create_table(
        self,
        table_name: str,
        description: str,
        columns: list[dict],
    ) -> dict:
        """Create a table in ROBLE."""
        resp = await self._request(
            "POST",
            f"{self._db_base_url}/create-table",
            json={
                "tableName": table_name,
                "description": description,
                "columns": columns,
            },
        )
        return resp.json()

    async def table_exists(self, table_name: str) -> bool:
        """Check if a table exists by attempting to read from it."""
        try:
            await self._ensure_authenticated()
            headers = {"Authorization": f"Bearer {self._access_token}"}
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{self._db_base_url}/read",
                    params={"tableName": table_name},
                    headers=headers,
                )
                # If we get 200 or the response is a list, the table exists
                if resp.status_code == 200:
                    return True
                # 500 with "does not exist" means table is missing
                if resp.status_code == 500:
                    body = resp.text
                    if "does not exist" in body or "no existe" in body:
                        return False
                # 403 could mean no permission OR table doesn't exist
                return resp.status_code not in (500, 403, 404)
        except Exception:
            return False

    # ------------------------------------------------------------------
    # CRUD operations
    # ------------------------------------------------------------------

    async def insert(self, table_name: str, records: list[dict]) -> list[dict]:
        """Insert records into a table. Returns the inserted records."""
        resp = await self._request(
            "POST",
            f"{self._db_base_url}/insert",
            json={"tableName": table_name, "records": records},
        )
        data = resp.json()
        # Check for skipped records (invalid columns = table schema mismatch)
        if isinstance(data, dict) and "skipped" in data:
            skipped = data.get("skipped", [])
            inserted = data.get("inserted", [])
            if skipped and not inserted:
                reasons = [s.get("reason", "") for s in skipped]
                logger.warning("roble.insert_skipped", table=table_name, reasons=reasons)
            if isinstance(inserted, list) and inserted:
                return inserted
        # ROBLE may return the inserted records in various formats
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "records" in data:
            return data["records"]
        if isinstance(data, dict) and "data" in data:
            return data["data"]
        if isinstance(data, dict) and "inserted" in data:
            ins = data["inserted"]
            return ins if isinstance(ins, list) else []
        return records

    async def read(
        self,
        table_name: str,
        filters: dict | None = None,
    ) -> list[dict]:
        """Read records from a table with optional filters."""
        params: dict = {"tableName": table_name}
        if filters:
            params.update(filters)

        await self._ensure_authenticated()
        headers = {"Authorization": f"Bearer {self._access_token}"}

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(
                f"{self._db_base_url}/read", params=params, headers=headers,
            )

            if resp.status_code == 401:
                if await self._do_refresh():
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = await client.get(
                        f"{self._db_base_url}/read", params=params, headers=headers,
                    )
                else:
                    await self._login()
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = await client.get(
                        f"{self._db_base_url}/read", params=params, headers=headers,
                    )

            # Handle "table does not exist" gracefully
            if resp.status_code == 500:
                body = resp.text
                if "does not exist" in body or "no existe" in body:
                    logger.warning("roble.table_not_found", table=table_name)
                    return []

            resp.raise_for_status()

        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "data" in data:
            return data["data"]
        if isinstance(data, dict) and "records" in data:
            return data["records"]
        return []

    async def read_one(
        self,
        table_name: str,
        id_column: str,
        id_value: str,
    ) -> dict | None:
        """Read a single record by ID column."""
        records = await self.read(table_name, {id_column: id_value})
        return records[0] if records else None

    async def update(
        self,
        table_name: str,
        id_column: str,
        id_value: str,
        updates: dict,
    ) -> dict:
        """Update a record."""
        resp = await self._request(
            "PUT",
            f"{self._db_base_url}/update",
            json={
                "tableName": table_name,
                "idColumn": id_column,
                "idValue": id_value,
                "updates": updates,
            },
        )
        return resp.json()

    async def delete(
        self,
        table_name: str,
        id_column: str,
        id_value: str,
    ) -> dict:
        """Delete a record."""
        resp = await self._request(
            "DELETE",
            f"{self._db_base_url}/delete",
            json={
                "tableName": table_name,
                "idColumn": id_column,
                "idValue": id_value,
            },
        )
        return resp.json()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def read_paginated(
        self,
        table_name: str,
        page: int,
        size: int,
        sort_key: str | None = None,
        sort_reverse: bool = True,
    ) -> tuple[list[dict], int]:
        """Read with client-side pagination and sorting.

        ROBLE does not support native pagination or ORDER BY, so we
        fetch all records, sort in Python, and slice.

        Returns (items, total_count).
        """
        all_records = await self.read(table_name)
        total = len(all_records)

        if sort_key:
            all_records.sort(
                key=lambda r: r.get(sort_key) or "",
                reverse=sort_reverse,
            )

        offset = (page - 1) * size
        items = all_records[offset : offset + size]
        return items, total


class RobleClientSync:
    """Synchronous ROBLE REST API client for use in Celery workers."""

    def __init__(
        self,
        auth_base_url: str,
        db_base_url: str,
        email: str,
        password: str,
    ) -> None:
        self._auth_base_url = auth_base_url.rstrip("/")
        self._db_base_url = db_base_url.rstrip("/")
        self._email = email
        self._password = password
        self._access_token: str | None = None
        self._refresh_token: str | None = None

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def _login(self) -> None:
        """Authenticate with ROBLE and store tokens."""
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{self._auth_base_url}/login",
                json={"email": self._email, "password": self._password},
            )
            resp.raise_for_status()
            data = resp.json()
            self._access_token = data["accessToken"]
            self._refresh_token = data["refreshToken"]
            logger.info("roble_sync.login_success")

    def _do_refresh(self) -> bool:
        """Attempt to refresh the access token. Returns True on success."""
        if not self._refresh_token:
            return False
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.post(
                    f"{self._auth_base_url}/refresh-token",
                    json={"refreshToken": self._refresh_token},
                )
                resp.raise_for_status()
                data = resp.json()
                self._access_token = data["accessToken"]
                self._refresh_token = data.get("refreshToken", self._refresh_token)
                logger.info("roble_sync.token_refreshed")
                return True
        except Exception:
            logger.warning("roble_sync.refresh_failed")
            return False

    def _ensure_authenticated(self) -> None:
        """Ensure we have a valid access token."""
        if not self._access_token:
            self._login()
            return

        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(
                    f"{self._auth_base_url}/verify-token",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                if resp.status_code == 200:
                    return
        except Exception:
            pass

        if self._do_refresh():
            return

        self._login()

    # ------------------------------------------------------------------
    # HTTP wrapper
    # ------------------------------------------------------------------

    def _request(
        self,
        method: str,
        url: str,
        **kwargs,
    ) -> httpx.Response:
        """Make an authenticated request, retrying once on 401."""
        self._ensure_authenticated()
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self._access_token}"

        with httpx.Client(timeout=60) as client:
            resp = client.request(method, url, headers=headers, **kwargs)

            if resp.status_code == 401:
                if self._do_refresh():
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = client.request(method, url, headers=headers, **kwargs)
                else:
                    self._login()
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = client.request(method, url, headers=headers, **kwargs)

            resp.raise_for_status()
            return resp

    # ------------------------------------------------------------------
    # CRUD operations
    # ------------------------------------------------------------------

    def insert(self, table_name: str, records: list[dict]) -> list[dict]:
        """Insert records into a table."""
        resp = self._request(
            "POST",
            f"{self._db_base_url}/insert",
            json={"tableName": table_name, "records": records},
        )
        data = resp.json()
        if isinstance(data, dict) and "skipped" in data:
            skipped = data.get("skipped", [])
            inserted = data.get("inserted", [])
            if skipped and not inserted:
                reasons = [s.get("reason", "") for s in skipped]
                logger.warning("roble_sync.insert_skipped", table=table_name, reasons=reasons)
            if isinstance(inserted, list) and inserted:
                return inserted
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "records" in data:
            return data["records"]
        if isinstance(data, dict) and "data" in data:
            return data["data"]
        if isinstance(data, dict) and "inserted" in data:
            ins = data["inserted"]
            return ins if isinstance(ins, list) else []
        return records

    def read(
        self,
        table_name: str,
        filters: dict | None = None,
    ) -> list[dict]:
        """Read records from a table."""
        params: dict = {"tableName": table_name}
        if filters:
            params.update(filters)

        self._ensure_authenticated()
        headers = {"Authorization": f"Bearer {self._access_token}"}

        with httpx.Client(timeout=60) as client:
            resp = client.get(
                f"{self._db_base_url}/read", params=params, headers=headers,
            )

            if resp.status_code == 401:
                if self._do_refresh():
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = client.get(
                        f"{self._db_base_url}/read", params=params, headers=headers,
                    )
                else:
                    self._login()
                    headers["Authorization"] = f"Bearer {self._access_token}"
                    resp = client.get(
                        f"{self._db_base_url}/read", params=params, headers=headers,
                    )

            if resp.status_code == 500:
                body = resp.text
                if "does not exist" in body or "no existe" in body:
                    logger.warning("roble_sync.table_not_found", table=table_name)
                    return []

            resp.raise_for_status()

        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "data" in data:
            return data["data"]
        if isinstance(data, dict) and "records" in data:
            return data["records"]
        return []

    def read_one(
        self,
        table_name: str,
        id_column: str,
        id_value: str,
    ) -> dict | None:
        """Read a single record by ID column."""
        records = self.read(table_name, {id_column: id_value})
        return records[0] if records else None

    def update(
        self,
        table_name: str,
        id_column: str,
        id_value: str,
        updates: dict,
    ) -> dict:
        """Update a record."""
        resp = self._request(
            "PUT",
            f"{self._db_base_url}/update",
            json={
                "tableName": table_name,
                "idColumn": id_column,
                "idValue": id_value,
                "updates": updates,
            },
        )
        return resp.json()

    def delete(
        self,
        table_name: str,
        id_column: str,
        id_value: str,
    ) -> dict:
        """Delete a record."""
        resp = self._request(
            "DELETE",
            f"{self._db_base_url}/delete",
            json={
                "tableName": table_name,
                "idColumn": id_column,
                "idValue": id_value,
            },
        )
        return resp.json()


def get_roble_client() -> RobleClient:
    """Create a RobleClient from application settings."""
    from core.config import get_settings

    s = get_settings()
    return RobleClient(
        auth_base_url=s.roble_auth_url,
        db_base_url=s.roble_db_url,
        email=s.roble_email,
        password=s.roble_password,
    )


def get_roble_client_sync() -> RobleClientSync:
    """Create a RobleClientSync from application settings."""
    from core.config import get_settings

    s = get_settings()
    return RobleClientSync(
        auth_base_url=s.roble_auth_url,
        db_base_url=s.roble_db_url,
        email=s.roble_email,
        password=s.roble_password,
    )
