"""AI training advisor powered by the Anthropic API.

After each pipeline run, this module sends the training notebook source code,
the run's metrics/logs, and the metric history of previous runs to Claude and
asks for concrete, actionable feedback: which features to engineer, which
hyperparameters to tune, and which parts of the code to change to get better
results on the next run.
"""
from __future__ import annotations

import json
from typing import Any

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)

SYSTEM_PROMPT = """\
You are an expert ML engineer reviewing automated training pipeline runs for an \
MLOps platform. You receive the training notebook source code, the metrics of \
the current run, the logs of each pipeline phase, and the metric history of \
previous runs on the same repository.

Your job is to give the developer concrete, actionable feedback to improve the \
next run. Always answer in the same language as the notebook comments when \
identifiable (default to Spanish), formatted as Markdown with these sections:

## Resumen del entrenamiento
2-3 sentences: what happened in this run and how the metrics compare to previous runs.

## Diagnostico
What is limiting the model right now (underfitting/overfitting, data quality, \
class imbalance, leakage risk, weak features, bad split, etc.). Cite specific \
evidence from the metrics, logs, or code.

## Mejoras recomendadas
A numbered list ordered by expected impact. For each item: what to change, why, \
and a short code snippet showing how to change it in THIS notebook (reference \
the actual variable and function names from the code you were given).

## Features sugeridas
Concrete feature-engineering ideas based on the columns/data visible in the code.

## Riesgos
Anything that looks wrong or fragile in the pipeline code itself (missing \
validation, hardcoded values, no random seed, metrics not logged to MLflow, etc.).

Be specific to the code you were given — never give generic advice that ignores it. \
If the run FAILED, focus the whole analysis on the root cause of the failure and \
how to fix it.\
"""


def _extract_code_cells(notebook: dict[str, Any]) -> str:
    """Return the notebook's code cells as a single annotated source listing."""
    parts: list[str] = []
    for i, cell in enumerate(notebook.get("cells", [])):
        if cell.get("cell_type") != "code":
            continue
        tags = cell.get("metadata", {}).get("tags", [])
        source = cell.get("source", "")
        if isinstance(source, list):
            source = "".join(source)
        header = f"# --- Cell {i}" + (f" [tags: {', '.join(tags)}]" if tags else "") + " ---"
        parts.append(f"{header}\n{source}")
    return "\n\n".join(parts)


def build_analysis_prompt(
    *,
    notebook: dict[str, Any],
    status: str,
    metrics: dict[str, Any],
    phases: list[dict[str, Any]],
    history: list[dict[str, Any]],
    commit_sha: str,
) -> str:
    """Assemble the user prompt for the advisor from pipeline artifacts."""
    code = _extract_code_cells(notebook)

    # Keep only the interesting bits of the phase logs (errors + tails).
    phase_summary = [
        {
            "phase": p.get("name"),
            "status": p.get("status"),
            "logs": (p.get("logs") or "")[:3000],
        }
        for p in phases
    ]

    history_summary = [
        {
            "pipeline_id": h.get("id", "")[:8],
            "status": h.get("status"),
            "metrics": h.get("metrics", {}),
            "finished_at": h.get("finished_at"),
        }
        for h in history
    ]

    return (
        f"## Estado del pipeline: {status.upper()} (commit {commit_sha[:8]})\n\n"
        f"## Metricas de esta ejecucion\n```json\n{json.dumps(metrics, indent=2, default=str)}\n```\n\n"
        f"## Historial de ejecuciones anteriores (mas reciente primero)\n"
        f"```json\n{json.dumps(history_summary, indent=2, default=str)}\n```\n\n"
        f"## Fases del pipeline y logs\n"
        f"```json\n{json.dumps(phase_summary, indent=2, default=str)}\n```\n\n"
        f"## Codigo del notebook de entrenamiento\n```python\n{code}\n```"
    )


def generate_insight(
    *,
    notebook: dict[str, Any],
    status: str,
    metrics: dict[str, Any],
    phases: list[dict[str, Any]],
    history: list[dict[str, Any]],
    commit_sha: str,
) -> str:
    """Call Claude and return the feedback report as Markdown.

    Raises:
        RuntimeError: if no Anthropic API key is configured.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured; cannot generate AI insights."
        )

    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    prompt = build_analysis_prompt(
        notebook=notebook,
        status=status,
        metrics=metrics,
        phases=phases,
        history=history,
        commit_sha=commit_sha,
    )

    log = logger.bind(model=settings.ai_advisor_model)
    log.info("ai_advisor.request.start", prompt_chars=len(prompt))

    with client.messages.stream(
        model=settings.ai_advisor_model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        log.warning("ai_advisor.request.refused")
        raise RuntimeError("The AI advisor refused to analyze this pipeline.")

    report = "".join(block.text for block in message.content if block.type == "text")
    log.info(
        "ai_advisor.request.done",
        output_tokens=message.usage.output_tokens,
        report_chars=len(report),
    )
    return report
