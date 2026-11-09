"""Rate limiting for public endpoints, counted in Redis.

A fixed one-minute window per key: the first hit in a minute creates a counter
that expires with the minute, every hit increments it, and a count past the
limit is refused until the window rolls over. Counting in Redis rather than in
memory means every backend process shares one count, and a restart does not
hand out a fresh allowance.

If Redis cannot be reached the request is let through and the failure logged:
the public link going dark whenever Redis blinks would be worse than a minute
without a limit. Payload limits still apply either way.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from functools import lru_cache

import structlog
from fastapi import Request

from core.config import AppSettings, get_settings

logger = structlog.get_logger(__name__)

WINDOW_SECONDS = 60


@dataclass(frozen=True)
class RateResult:
    allowed: bool
    limit: int
    remaining: int
    #: Seconds until the window rolls over and the count starts again.
    retry_after: int


class RateLimiter:
    """Counts hits per key; ``redis`` is any client with async incr/expire."""

    def __init__(self, redis) -> None:  # noqa: ANN001 - redis.asyncio.Redis or a test double
        self._redis = redis

    async def hit(self, key: str, limit: int) -> RateResult:
        now = int(time.time())
        window = now // WINDOW_SECONDS
        retry_after = WINDOW_SECONDS - now % WINDOW_SECONDS
        counter = f"ratelimit:{key}:{window}"
        try:
            count = await self._redis.incr(counter)
            if count == 1:
                await self._redis.expire(counter, WINDOW_SECONDS)
        except Exception as exc:  # noqa: BLE001 - fail open, see the module docstring
            logger.warning("rate_limit.redis_unavailable", key=key, error=str(exc))
            return RateResult(allowed=True, limit=limit, remaining=limit, retry_after=retry_after)
        return RateResult(
            allowed=count <= limit,
            limit=limit,
            remaining=max(limit - count, 0),
            retry_after=retry_after,
        )


@lru_cache
def _redis_client(url: str):  # noqa: ANN202
    import redis.asyncio as redis

    return redis.Redis.from_url(url, socket_timeout=1, socket_connect_timeout=1)


def get_rate_limiter() -> RateLimiter:
    """FastAPI dependency; tests override it with an in-memory limiter."""
    return RateLimiter(_redis_client(get_settings().redis_url))


def client_ip(request: Request, settings: AppSettings) -> str:
    """The caller's IP, from X-Forwarded-For only when a trusted proxy sets it."""
    if settings.trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            # The left-most entry is the original client; the rest are proxies.
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
