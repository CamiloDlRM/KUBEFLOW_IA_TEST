"""Which Gemini models this key can actually use, and what the aliases resolve to.

Run it inside the backend container, so it reads the same key the agent reads:

    docker compose exec -T backend python < scripts/check_gemini_models.py

Two questions it answers that a model list cannot.

`gemini-pro-latest` is an alias, and an alias does not say what it points at —
which matters, because what it points at is what gets billed and what carries
the quota.

And a name appearing in ListModels does not mean a key may call it. A model can
be listed and closed to new accounts (404), or open and out of quota (429).
The only way to know is to call it, which is what this does: one token-sized
request per candidate.
"""

import os

import httpx

BASE = "https://generativelanguage.googleapis.com/v1beta/models"

#: Aliases first, then the pinned names worth comparing against. Flash-class
#: models are the ones a free tier normally allows; pro-class usually needs
#: billing, which is what "quota exceeded on first use" tends to mean.
CANDIDATES = [
    "gemini-pro-latest",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
]


def main() -> None:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise SystemExit("GEMINI_API_KEY is not set in this container.")

    headers = {"x-goog-api-key": key}

    print("What the aliases point at")
    print("-" * 72)
    for alias in [name for name in CANDIDATES if name.endswith("-latest")]:
        try:
            meta = httpx.get(f"{BASE}/{alias}", headers=headers, timeout=30).json()
        except httpx.HTTPError as exc:
            print(f"  {alias:26} could not be read: {exc}")
            continue
        if "error" in meta:
            print(f"  {alias:26} {meta['error'].get('message', '')[:60]}")
            continue
        print(
            f"  {alias:26} version {meta.get('version', '?')}"
            f"  ({meta.get('displayName', '?')})"
        )

    print()
    print("What a real call returns")
    print("-" * 72)
    print(f"  {'model':26} {'status':7} detail")
    for name in CANDIDATES:
        try:
            response = httpx.post(
                f"{BASE}/{name}:generateContent",
                headers=headers,
                # One token in, one token out: enough to learn whether the call
                # is allowed without spending anything worth counting.
                json={
                    "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
                    "generationConfig": {"maxOutputTokens": 1},
                },
                timeout=60,
            )
        except httpx.HTTPError as exc:
            print(f"  {name:26} {'ERR':7} {exc}")
            continue

        detail = "ok"
        if response.status_code != 200:
            try:
                detail = response.json()["error"]["message"]
            except Exception:
                detail = response.text
            detail = " ".join(detail.split())[:120]
        print(f"  {name:26} {response.status_code:<7} {detail}")

    print()
    print("A 200 means the agent can use it. Put that name in DASHBOARD_AGENT_MODEL.")


if __name__ == "__main__":
    main()
