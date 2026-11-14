"""The confirmation email names the thing being changed."""
import pytest

from core.config import get_settings
from core.email import _build_change_message


@pytest.mark.parametrize(
    ("change_type", "new_value", "expected"),
    [
        ("email", "new@example.com", "your email will be changed to"),
        ("username", "ana@t", "your username will be changed to"),
        ("password", None, "your password will be updated"),
    ],
)
def test_change_message_names_what_is_changing(change_type, new_value, expected):
    msg = _build_change_message(
        to_address="old@example.com",
        confirm_url="http://localhost:3000/confirm-change?token=t",
        change_type=change_type,
        new_username=new_value,
        settings=get_settings(),
    )
    html = msg.get_payload()[1].get_payload(decode=True).decode()

    assert msg["Subject"].startswith(f"Confirm your {change_type} change")
    assert expected in html
