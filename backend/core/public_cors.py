"""CORS for the public links: any origin, never credentials.

The app's own CORS only admits the frontend, which is right for everything
behind sign-in. A shared link is meant to be called from anywhere, though, so
under /public/ this answers preflights itself and marks every response as
readable by any origin. Without ``Access-Control-Allow-Credentials`` a browser
sends no cookie or stored token along, so being open here grants nothing the
link itself does not.

It must wrap the app's CORS middleware (be added after it), or that one would
refuse the preflight from an unknown origin before this could answer it.
"""
from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_PREFIX = "/public/"
_ALLOW_METHODS = b"GET, POST, OPTIONS"
_ALLOW_HEADERS = b"Content-Type"
_EXPOSE_HEADERS = b"X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After"


class PublicCorsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(_PREFIX):
            await self.app(scope, receive, send)
            return

        if scope["method"] == "OPTIONS":
            await send({
                "type": "http.response.start",
                "status": 204,
                "headers": [
                    (b"access-control-allow-origin", b"*"),
                    (b"access-control-allow-methods", _ALLOW_METHODS),
                    (b"access-control-allow-headers", _ALLOW_HEADERS),
                    (b"access-control-max-age", b"600"),
                ],
            })
            await send({"type": "http.response.body", "body": b""})
            return

        async def send_open(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if not name.lower().startswith(b"access-control-")
                ]
                headers += [
                    (b"access-control-allow-origin", b"*"),
                    (b"access-control-expose-headers", _EXPOSE_HEADERS),
                ]
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_open)
