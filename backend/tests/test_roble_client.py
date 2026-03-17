"""Tests for core/roble_client.py -- RobleClient and RobleClientSync.

Covers authentication lifecycle, CRUD operations, error handling,
pagination, and response format normalization.

All HTTP calls are mocked via unittest.mock -- no external services needed.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from core.roble_client import RobleClient, RobleClientSync, get_roble_client, get_roble_client_sync

# Helper to build httpx.Response with a request set (required by raise_for_status)
_FAKE_GET_REQ = httpx.Request("GET", "https://roble-api.example.com/database/test")
_FAKE_POST_REQ = httpx.Request("POST", "https://roble-api.example.com/database/test")
_FAKE_PUT_REQ = httpx.Request("PUT", "https://roble-api.example.com/database/test")
_FAKE_DEL_REQ = httpx.Request("DELETE", "https://roble-api.example.com/database/test")


def _resp(status, json_data=None, text=None, method="GET"):
    """Build an httpx.Response with the appropriate request attached."""
    req_map = {"GET": _FAKE_GET_REQ, "POST": _FAKE_POST_REQ, "PUT": _FAKE_PUT_REQ, "DELETE": _FAKE_DEL_REQ}
    kwargs = {"status_code": status, "request": req_map.get(method, _FAKE_GET_REQ)}
    if json_data is not None:
        kwargs["json"] = json_data
    if text is not None:
        kwargs["text"] = text
    return httpx.Response(**kwargs)


def _make_client():
    """Create a RobleClient with test credentials."""
    return RobleClient(
        auth_base_url="https://roble-api.example.com/auth/test",
        db_base_url="https://roble-api.example.com/database/test",
        email="test@example.com",
        password="testpass",
    )


def _make_sync_client():
    """Create a RobleClientSync with test credentials."""
    return RobleClientSync(
        auth_base_url="https://roble-api.example.com/auth/test",
        db_base_url="https://roble-api.example.com/database/test",
        email="test@example.com",
        password="testpass",
    )


# =========================================================================
# Async RobleClient Tests
# =========================================================================


class TestRobleClientAuthentication:
    """RobleClient authentication lifecycle."""

    @pytest.mark.asyncio
    async def test_login_when_valid_credentials_should_store_tokens(self):
        client = _make_client()
        login_resp = _resp(200, {"accessToken": "tok123", "refreshToken": "ref456"}, method="POST")

        mock_http = AsyncMock()
        mock_http.post = AsyncMock(return_value=login_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
            await client._login()

        assert client._access_token == "tok123"
        assert client._refresh_token == "ref456"

    @pytest.mark.asyncio
    async def test_ensure_authenticated_when_no_token_should_login(self):
        client = _make_client()
        assert client._access_token is None

        login_resp = _resp(200, {"accessToken": "tok_new", "refreshToken": "ref_new"}, method="POST")

        mock_http = AsyncMock()
        mock_http.post = AsyncMock(return_value=login_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
            await client._ensure_authenticated()

        assert client._access_token == "tok_new"

    @pytest.mark.asyncio
    async def test_ensure_authenticated_when_valid_token_should_not_re_login(self):
        client = _make_client()
        client._access_token = "valid_tok"
        client._refresh_token = "ref_tok"

        verify_resp = _resp(200, {"valid": True})

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=verify_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
            await client._ensure_authenticated()

        # Token should remain unchanged
        assert client._access_token == "valid_tok"

    @pytest.mark.asyncio
    async def test_do_refresh_when_refresh_succeeds_should_update_access_token(self):
        client = _make_client()
        client._access_token = "old_tok"
        client._refresh_token = "ref_tok"

        refresh_resp = _resp(200, {"accessToken": "refreshed_tok"}, method="POST")

        mock_http = AsyncMock()
        mock_http.post = AsyncMock(return_value=refresh_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
            result = await client._do_refresh()

        assert result is True
        assert client._access_token == "refreshed_tok"

    @pytest.mark.asyncio
    async def test_do_refresh_when_no_refresh_token_should_return_false(self):
        client = _make_client()
        client._refresh_token = None

        result = await client._do_refresh()

        assert result is False


class TestRobleClientInsert:
    """RobleClient.insert()"""

    @pytest.mark.asyncio
    async def test_insert_when_list_response_should_return_records(self):
        client = _make_client()
        client._access_token = "tok"

        records = [{"_id": "abc1", "name": "test"}]
        insert_resp = _resp(200, records, method="POST")

        mock_http = AsyncMock()
        mock_http.request = AsyncMock(return_value=insert_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        # Mock _ensure_authenticated to skip auth
        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.insert("test_table", [{"name": "test"}])

        assert result == records

    @pytest.mark.asyncio
    async def test_insert_when_dict_with_inserted_key_should_return_inserted(self):
        client = _make_client()
        client._access_token = "tok"

        inserted = [{"_id": "r1", "foo": "bar"}]
        resp_data = {"inserted": inserted, "skipped": []}
        insert_resp = _resp(200, resp_data, method="POST")

        mock_http = AsyncMock()
        mock_http.request = AsyncMock(return_value=insert_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.insert("test_table", [{"foo": "bar"}])

        assert result == inserted

    @pytest.mark.asyncio
    async def test_insert_when_skipped_records_should_return_empty_if_nothing_inserted(self):
        client = _make_client()
        client._access_token = "tok"

        resp_data = {
            "inserted": [],
            "skipped": [{"reason": "invalid column 'bad'"}],
        }
        insert_resp = _resp(200, resp_data, method="POST")

        mock_http = AsyncMock()
        mock_http.request = AsyncMock(return_value=insert_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.insert("test_table", [{"bad": "data"}])

        # When all records are skipped and none inserted, returns empty inserted list
        assert result == []

    @pytest.mark.asyncio
    async def test_insert_when_dict_with_data_key_should_return_data(self):
        client = _make_client()
        client._access_token = "tok"

        data_list = [{"_id": "x1", "name": "test"}]
        insert_resp = _resp(200, {"data": data_list}, method="POST")

        mock_http = AsyncMock()
        mock_http.request = AsyncMock(return_value=insert_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.insert("test_table", [{"name": "test"}])

        assert result == data_list


class TestRobleClientRead:
    """RobleClient.read()"""

    @pytest.mark.asyncio
    async def test_read_when_list_response_should_return_records(self):
        client = _make_client()
        client._access_token = "tok"

        records = [{"_id": "r1", "name": "a"}, {"_id": "r2", "name": "b"}]
        read_resp = _resp(200, records)

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=read_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.read("test_table")

        assert len(result) == 2
        assert result[0]["_id"] == "r1"

    @pytest.mark.asyncio
    async def test_read_when_table_does_not_exist_should_return_empty_list(self):
        client = _make_client()
        client._access_token = "tok"

        read_resp = _resp(500, text="relation \"missing\" does not exist")

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=read_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.read("missing")

        assert result == []

    @pytest.mark.asyncio
    async def test_read_when_dict_with_data_key_should_extract(self):
        client = _make_client()
        client._access_token = "tok"

        records = [{"_id": "d1"}]
        read_resp = _resp(200, {"data": records})

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=read_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.read("test_table")

        assert result == records

    @pytest.mark.asyncio
    async def test_read_when_filters_provided_should_pass_as_params(self):
        client = _make_client()
        client._access_token = "tok"

        read_resp = _resp(200, [{"_id": "f1", "status": "active"}])

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=read_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.read("repos", {"status": "active"})

        assert len(result) == 1
        # Verify the params include the filter
        call_kwargs = mock_http.get.call_args
        assert "status" in call_kwargs.kwargs.get("params", {}) or "status" in (call_kwargs[1].get("params", {}))


class TestRobleClientReadOne:
    """RobleClient.read_one()"""

    @pytest.mark.asyncio
    async def test_read_one_when_record_exists_should_return_first_match(self):
        client = _make_client()
        record = {"_id": "r1", "name": "found"}

        with patch.object(client, "read", new_callable=AsyncMock, return_value=[record]):
            result = await client.read_one("test_table", "_id", "r1")

        assert result == record

    @pytest.mark.asyncio
    async def test_read_one_when_no_records_should_return_none(self):
        client = _make_client()

        with patch.object(client, "read", new_callable=AsyncMock, return_value=[]):
            result = await client.read_one("test_table", "_id", "nonexistent")

        assert result is None


class TestRobleClientUpdate:
    """RobleClient.update()"""

    @pytest.mark.asyncio
    async def test_update_when_success_should_return_response_json(self):
        client = _make_client()
        client._access_token = "tok"

        update_resp = _resp(200, {"message": "updated"}, method="PUT")

        mock_http = AsyncMock()
        mock_http.request = AsyncMock(return_value=update_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.update("repos", "_id", "r1", {"branch": "dev"})

        assert result == {"message": "updated"}


class TestRobleClientDelete:
    """RobleClient.delete()"""

    @pytest.mark.asyncio
    async def test_delete_when_success_should_return_response_json(self):
        client = _make_client()
        client._access_token = "tok"

        del_resp = _resp(200, {"message": "deleted"}, method="DELETE")

        mock_http = AsyncMock()
        mock_http.request = AsyncMock(return_value=del_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.delete("repos", "_id", "r1")

        assert result == {"message": "deleted"}


class TestRobleClientTableExists:
    """RobleClient.table_exists()"""

    @pytest.mark.asyncio
    async def test_table_exists_when_200_should_return_true(self):
        client = _make_client()
        client._access_token = "tok"

        read_resp = _resp(200, [])

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=read_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.table_exists("repositories")

        assert result is True

    @pytest.mark.asyncio
    async def test_table_exists_when_500_does_not_exist_should_return_false(self):
        client = _make_client()
        client._access_token = "tok"

        read_resp = _resp(500, text='relation "missing_table" does not exist')

        mock_http = AsyncMock()
        mock_http.get = AsyncMock(return_value=read_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.table_exists("missing_table")

        assert result is False

    @pytest.mark.asyncio
    async def test_table_exists_when_exception_should_return_false(self):
        client = _make_client()
        client._access_token = "tok"

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock, side_effect=Exception("network")):
            result = await client.table_exists("anything")

        assert result is False


class TestRobleClientPagination:
    """RobleClient.read_paginated()"""

    @pytest.mark.asyncio
    async def test_read_paginated_when_first_page_should_return_correct_slice(self):
        client = _make_client()
        all_records = [{"_id": f"r{i}", "created_at": f"2026-01-{i+1:02d}"} for i in range(10)]

        with patch.object(client, "read", new_callable=AsyncMock, return_value=all_records):
            items, total = await client.read_paginated("test", page=1, size=3)

        assert total == 10
        assert len(items) == 3

    @pytest.mark.asyncio
    async def test_read_paginated_when_second_page_should_offset_correctly(self):
        client = _make_client()
        all_records = [{"_id": f"r{i}", "created_at": f"2026-01-{i+1:02d}"} for i in range(5)]

        with patch.object(client, "read", new_callable=AsyncMock, return_value=all_records):
            items, total = await client.read_paginated("test", page=2, size=3)

        assert total == 5
        assert len(items) == 2  # 5 total, page 2 size 3 = offset 3, remaining 2

    @pytest.mark.asyncio
    async def test_read_paginated_when_sort_key_should_sort_records(self):
        client = _make_client()
        records = [
            {"_id": "a", "created_at": "2026-01-01"},
            {"_id": "c", "created_at": "2026-01-03"},
            {"_id": "b", "created_at": "2026-01-02"},
        ]

        with patch.object(client, "read", new_callable=AsyncMock, return_value=records):
            items, total = await client.read_paginated(
                "test", page=1, size=10,
                sort_key="created_at", sort_reverse=True,
            )

        assert total == 3
        # Sorted descending by created_at
        assert items[0]["_id"] == "c"
        assert items[1]["_id"] == "b"
        assert items[2]["_id"] == "a"

    @pytest.mark.asyncio
    async def test_read_paginated_when_page_beyond_total_should_return_empty(self):
        client = _make_client()
        records = [{"_id": "r1"}]

        with patch.object(client, "read", new_callable=AsyncMock, return_value=records):
            items, total = await client.read_paginated("test", page=5, size=10)

        assert total == 1
        assert items == []


class TestRobleClientRetryOn401:
    """RobleClient._request() retry logic on 401."""

    @pytest.mark.asyncio
    async def test_request_when_401_and_refresh_succeeds_should_retry(self):
        client = _make_client()
        client._access_token = "old_tok"
        client._refresh_token = "ref_tok"

        first_resp = _resp(401, text="Unauthorized", method="GET")
        second_resp = _resp(200, {"data": "ok"})

        call_count = 0

        async def mock_request(method, url, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return first_resp
            return second_resp

        mock_http = AsyncMock()
        mock_http.request = mock_request
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch.object(client, "_do_refresh", new_callable=AsyncMock, return_value=True):
                with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                    result = await client._request("GET", "https://example.com/test")

        assert result.status_code == 200


class TestRobleClientCreateTable:
    """RobleClient.create_table()"""

    @pytest.mark.asyncio
    async def test_create_table_when_success_should_return_response(self):
        client = _make_client()
        client._access_token = "tok"

        create_resp = _resp(200, {"message": "table created"}, method="POST")

        mock_http = AsyncMock()
        mock_http.request = AsyncMock(return_value=create_resp)
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=False)

        with patch.object(client, "_ensure_authenticated", new_callable=AsyncMock):
            with patch("core.roble_client.httpx.AsyncClient", return_value=mock_http):
                result = await client.create_table(
                    "new_table",
                    "A test table",
                    [{"name": "col1", "type": "TEXT"}],
                )

        assert result == {"message": "table created"}


# =========================================================================
# Sync RobleClientSync Tests
# =========================================================================


class TestRobleClientSyncAuthentication:
    """RobleClientSync authentication."""

    def test_login_when_valid_credentials_should_store_tokens(self):
        client = _make_sync_client()
        login_resp = _resp(200, {"accessToken": "stok1", "refreshToken": "sref1"}, method="POST")

        mock_http = MagicMock()
        mock_http.post = MagicMock(return_value=login_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch("core.roble_client.httpx.Client", return_value=mock_http):
            client._login()

        assert client._access_token == "stok1"
        assert client._refresh_token == "sref1"

    def test_do_refresh_when_no_refresh_token_should_return_false(self):
        client = _make_sync_client()
        client._refresh_token = None

        result = client._do_refresh()

        assert result is False


class TestRobleClientSyncCRUD:
    """RobleClientSync CRUD operations."""

    def test_insert_when_list_response_should_return_records(self):
        client = _make_sync_client()
        client._access_token = "tok"

        records = [{"_id": "s1", "name": "sync"}]
        insert_resp = _resp(200, records, method="POST")

        mock_http = MagicMock()
        mock_http.request = MagicMock(return_value=insert_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch.object(client, "_ensure_authenticated"):
            with patch("core.roble_client.httpx.Client", return_value=mock_http):
                result = client.insert("table", [{"name": "sync"}])

        assert result == records

    def test_read_when_list_response_should_return_records(self):
        client = _make_sync_client()
        client._access_token = "tok"

        records = [{"_id": "s1"}, {"_id": "s2"}]
        read_resp = _resp(200, records)

        mock_http = MagicMock()
        mock_http.get = MagicMock(return_value=read_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch.object(client, "_ensure_authenticated"):
            with patch("core.roble_client.httpx.Client", return_value=mock_http):
                result = client.read("table")

        assert len(result) == 2

    def test_read_when_table_not_found_500_should_return_empty(self):
        client = _make_sync_client()
        client._access_token = "tok"

        read_resp = _resp(500, text='relation "missing" does not exist')

        mock_http = MagicMock()
        mock_http.get = MagicMock(return_value=read_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch.object(client, "_ensure_authenticated"):
            with patch("core.roble_client.httpx.Client", return_value=mock_http):
                result = client.read("missing")

        assert result == []

    def test_read_one_when_exists_should_return_first(self):
        client = _make_sync_client()
        record = {"_id": "r1", "name": "found"}

        with patch.object(client, "read", return_value=[record]):
            result = client.read_one("table", "_id", "r1")

        assert result == record

    def test_read_one_when_not_found_should_return_none(self):
        client = _make_sync_client()

        with patch.object(client, "read", return_value=[]):
            result = client.read_one("table", "_id", "missing")

        assert result is None

    def test_update_when_success_should_return_response(self):
        client = _make_sync_client()
        client._access_token = "tok"

        update_resp = _resp(200, {"message": "updated"}, method="PUT")

        mock_http = MagicMock()
        mock_http.request = MagicMock(return_value=update_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch.object(client, "_ensure_authenticated"):
            with patch("core.roble_client.httpx.Client", return_value=mock_http):
                result = client.update("table", "_id", "r1", {"x": "y"})

        assert result == {"message": "updated"}

    def test_delete_when_success_should_return_response(self):
        client = _make_sync_client()
        client._access_token = "tok"

        del_resp = _resp(200, {"message": "deleted"}, method="DELETE")

        mock_http = MagicMock()
        mock_http.request = MagicMock(return_value=del_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch.object(client, "_ensure_authenticated"):
            with patch("core.roble_client.httpx.Client", return_value=mock_http):
                result = client.delete("table", "_id", "r1")

        assert result == {"message": "deleted"}


class TestRobleClientSyncInsertFormats:
    """RobleClientSync.insert() response format normalization."""

    def test_insert_when_dict_records_key_should_extract(self):
        client = _make_sync_client()
        client._access_token = "tok"

        data = [{"_id": "x1", "name": "val"}]
        insert_resp = _resp(200, {"records": data}, method="POST")

        mock_http = MagicMock()
        mock_http.request = MagicMock(return_value=insert_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch.object(client, "_ensure_authenticated"):
            with patch("core.roble_client.httpx.Client", return_value=mock_http):
                result = client.insert("table", [{"name": "val"}])

        assert result == data

    def test_insert_when_dict_data_key_should_extract(self):
        client = _make_sync_client()
        client._access_token = "tok"

        data = [{"_id": "x2"}]
        insert_resp = _resp(200, {"data": data}, method="POST")

        mock_http = MagicMock()
        mock_http.request = MagicMock(return_value=insert_resp)
        mock_http.__enter__ = MagicMock(return_value=mock_http)
        mock_http.__exit__ = MagicMock(return_value=False)

        with patch.object(client, "_ensure_authenticated"):
            with patch("core.roble_client.httpx.Client", return_value=mock_http):
                result = client.insert("table", [{"name": "val"}])

        assert result == data


class TestGetRobleClientFactories:
    """get_roble_client() and get_roble_client_sync() factory functions."""

    def test_get_roble_client_should_return_async_client_with_settings(self):
        client = get_roble_client()

        assert isinstance(client, RobleClient)
        assert "roble" in client._auth_base_url.lower() or "openlab" in client._auth_base_url.lower() or "example" in client._auth_base_url.lower()

    def test_get_roble_client_sync_should_return_sync_client_with_settings(self):
        client = get_roble_client_sync()

        assert isinstance(client, RobleClientSync)
