"""What leaves the platform for an external language model, in a health project.

The agents work on structure: a notebook's code, the run's metrics, the
errors it raised, the names and types of the columns. None of that is a
patient's data, and in a project that holds health data none of it is
allowed to carry any. Sending personal data to a provider abroad would be an
international transmission (Ley 1581 de 2012, art. 26) needing a contract or
an adequacy finding; the simpler and stronger position is not to send it.

Every call to a provider goes through an :class:`Egress`. In a general
project it changes nothing and records nothing — the flow is exactly as it
was. In a health project it:

- withholds the outputs of notebook cells (a ``df.head()`` is patient rows),
  keeping errors and tracebacks, which is what a diagnosis is made from;
- removes data from tool answers the dashboard agent receives;
- scrubs what is left of anything shaped like an identifier — e-mails,
  phones, document numbers, the platform's own pseudonyms — as a second net
  behind the pseudonymisation that already happened before bronze;
- and records the call: which agent, which provider and model, how much was
  sent and what was withheld. That record is the evidence that the rule held.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Final

#: Patterns scrubbed from text sent from a health project, in order. Kept
#: narrow on purpose: a metric like 0.912345678 or a run id must survive, or
#: the agent loses what it needs to say anything useful.
_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    ("email", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")),
    ("pseudonym", re.compile(r"\bps_[0-9a-f]{20}\b")),
    ("ssn", re.compile(r"(?<![\w.-])\d{3}-\d{2}-\d{4}(?![\w.-])")),
    (
        "phone",
        re.compile(r"(?<![\w.])(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?|\d{3}[\s-])\d{3}[\s-]?\d{4}(?![\w.])"),
    ),
    ("document", re.compile(r"(?<![\w.])\d{8,12}(?![\w.])")),
)

#: Keys in a tool answer that carry data rather than structure.
_DATA_KEYS: Final[frozenset[str]] = frozenset({
    "data", "rows", "records", "sample", "samples", "sample_data", "sample_rows",
    "preview", "preview_data", "query_result", "query_results",
})

WITHHELD_OUTPUTS: Final[str] = "[cell outputs withheld: this project holds health data]"


def scrub(text: str) -> tuple[str, Counter]:
    """``text`` without anything shaped like an identifier, and what was removed."""
    counts: Counter = Counter()
    for kind, pattern in _PATTERNS:
        text, found = pattern.subn(f"[withheld:{kind}]", text)
        if found:
            counts[kind] += found
    return text, counts


def _prune(value: Any, counts: Counter) -> Any:
    if isinstance(value, dict):
        kept = {}
        for key, item in value.items():
            if isinstance(key, str) and key.lower() in _DATA_KEYS:
                counts["tool_data"] += 1
                continue
            kept[key] = _prune(item, counts)
        return kept
    if isinstance(value, list):
        return [_prune(item, counts) for item in value]
    return value


@dataclass
class Egress:
    """One agent call's way out: a pass-through unless the project holds health data."""

    agent: str
    project_id: int | None = None
    health: bool = False
    sent_chars: int = 0
    withheld: Counter = field(default_factory=Counter)

    def text(self, value: str) -> str:
        """Text on its way out, scrubbed in a health project."""
        if not self.health or not value:
            return value
        cleaned, counts = scrub(value)
        self.withheld.update(counts)
        return cleaned

    def outgoing(self, prompt: str) -> str:
        """The final text of a call: scrubbed, and counted."""
        prompt = self.text(prompt)
        self.sent_chars += len(prompt or "")
        return prompt

    def phases(self, phases: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """A run's phases without the outputs of its cells.

        A successful execute phase logs every cell's output — whatever the
        notebook printed, rows included. A failed phase logs the error, which
        is what the diagnosis needs, so it is kept and scrubbed.
        """
        if not self.health:
            return phases
        guarded = []
        for phase in phases or []:
            phase = dict(phase)
            if phase.get("name") == "execute" and phase.get("status") == "success":
                phase["logs"] = WITHHELD_OUTPUTS
                self.withheld["cell_outputs"] += 1
            else:
                phase["logs"] = self.text(phase.get("logs") or "")
            guarded.append(phase)
        return guarded

    def tool_result(self, result: str) -> str:
        """A dashboard tool's answer as the model may see it."""
        if not self.health:
            return result
        try:
            parsed = json.loads(result)
        except (TypeError, ValueError):
            return self.outgoing(result)
        return self.outgoing(json.dumps(_prune(parsed, self.withheld), default=str))

    def summary(self) -> dict[str, Any]:
        return {"sent_chars": self.sent_chars, "withheld": dict(self.withheld)}


def egress_for(session: Any, project_id: int | None, agent: str) -> Egress:
    """The way out for an agent working on ``project_id``."""
    from core.privacy import ProjectPrivacy
    from models.schemas import Project

    project = session.get(Project, project_id) if project_id is not None else None
    health = bool(project and ProjectPrivacy.from_stored(project.privacy).health)
    return Egress(agent=agent, project_id=project_id, health=health)


def record(session: Any, egress: Egress | None, provider: str, model: str, *, ok: bool = True) -> None:
    """Keep the record of a call from a health project. Nothing for a general one."""
    if egress is None or not egress.health:
        return
    from models.schemas import LlmEgress

    session.add(
        LlmEgress(
            project_id=egress.project_id,
            agent=egress.agent,
            provider=provider,
            model=model,
            sent_chars=egress.sent_chars,
            withheld=dict(egress.withheld),
            ok=ok,
            created_at=datetime.now(timezone.utc),
        )
    )
    session.commit()
