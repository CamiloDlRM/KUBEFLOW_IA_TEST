"""AI training advisor with pluggable model providers.

After each pipeline run, this module sends the training notebook source code,
the run's metrics/logs, and the metric history of previous runs to an LLM and
asks for concrete, actionable feedback: which features to engineer, which
hyperparameters to tune, and which parts of the code to change to get better
results on the next run.

Supported providers (selected via ``AI_ADVISOR_PROVIDER``):

- ``anthropic`` — Claude via the Anthropic API (needs ``ANTHROPIC_API_KEY``)
- ``gemini``    — Google Gemini via the Generative Language API
                  (needs ``GEMINI_API_KEY``)
- ``ollama``    — any local model served by Ollama (needs a reachable
                  ``OLLAMA_BASE_URL``; no API key)
"""
from __future__ import annotations

import json
from typing import Any

import structlog

from core.config import AppSettings, get_settings

logger = structlog.get_logger(__name__)

# Default model per provider, used when AI_ADVISOR_MODEL is left empty.
DEFAULT_MODELS = {
    "anthropic": "claude-opus-4-8",
    "gemini": "gemini-2.5-pro",
    "ollama": "llama3.1",
}

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


# ---------------------------------------------------------------------------
# Provider configuration helpers
# ---------------------------------------------------------------------------

def resolve_model(settings: AppSettings | None = None) -> str:
    """Return the configured model, falling back to the provider default."""
    settings = settings or get_settings()
    return settings.ai_advisor_model or DEFAULT_MODELS.get(
        settings.ai_advisor_provider, ""
    )


def advisor_configured(settings: AppSettings | None = None) -> bool:
    """Return True when the configured provider has what it needs to run."""
    settings = settings or get_settings()
    if not settings.ai_advisor_enabled:
        return False
    provider = settings.ai_advisor_provider
    if provider == "anthropic":
        return bool(settings.anthropic_api_key)
    if provider == "gemini":
        return bool(settings.gemini_api_key)
    if provider == "ollama":
        return bool(settings.ollama_base_url)
    return False


def advisor_label(settings: AppSettings | None = None) -> str:
    """Human-readable ``provider:model`` label stored with each insight."""
    settings = settings or get_settings()
    return f"{settings.ai_advisor_provider}:{resolve_model(settings)}"


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Provider backends
# ---------------------------------------------------------------------------

def _generate_anthropic(
    settings: AppSettings, model: str, prompt: str, system: str = SYSTEM_PROMPT
) -> str:
    """Claude via the official Anthropic SDK."""
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    with client.messages.stream(
        model=model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=system,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        raise RuntimeError("The AI advisor refused to analyze this pipeline.")

    return "".join(block.text for block in message.content if block.type == "text")


def _generate_gemini(
    settings: AppSettings, model: str, prompt: str, system: str = SYSTEM_PROMPT
) -> str:
    """Google Gemini via the Generative Language REST API."""
    import httpx

    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{model}:generateContent"
    )
    resp = httpx.post(
        url,
        headers={"x-goog-api-key": settings.gemini_api_key},
        json={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 16000},
        },
        timeout=300,
    )
    resp.raise_for_status()
    data = resp.json()

    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError(
            f"Gemini returned no candidates (blocked?): {json.dumps(data)[:500]}"
        )
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts)
    if not text.strip():
        raise RuntimeError("Gemini returned an empty response.")
    return text


def _generate_ollama(
    settings: AppSettings, model: str, prompt: str, system: str = SYSTEM_PROMPT
) -> str:
    """Any local model served by Ollama (/api/chat)."""
    import httpx

    base = settings.ollama_base_url.rstrip("/")
    resp = httpx.post(
        f"{base}/api/chat",
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
        },
        # Local models can be slow, especially on CPU.
        timeout=600,
    )
    resp.raise_for_status()
    text = resp.json().get("message", {}).get("content", "")
    if not text.strip():
        raise RuntimeError("Ollama returned an empty response.")
    return text


_BACKENDS = {
    "anthropic": _generate_anthropic,
    "gemini": _generate_gemini,
    "ollama": _generate_ollama,
}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def generate_insight(
    *,
    notebook: dict[str, Any],
    status: str,
    metrics: dict[str, Any],
    phases: list[dict[str, Any]],
    history: list[dict[str, Any]],
    commit_sha: str,
) -> str:
    """Call the configured provider and return the feedback report as Markdown.

    Raises:
        RuntimeError: if the configured provider is missing credentials/config.
    """
    settings = get_settings()
    if not advisor_configured(settings):
        raise RuntimeError(
            f"AI advisor provider '{settings.ai_advisor_provider}' is not "
            "configured (missing API key or base URL)."
        )

    backend = _BACKENDS[settings.ai_advisor_provider]
    model = resolve_model(settings)

    prompt = build_analysis_prompt(
        notebook=notebook,
        status=status,
        metrics=metrics,
        phases=phases,
        history=history,
        commit_sha=commit_sha,
    )

    log = logger.bind(provider=settings.ai_advisor_provider, model=model)
    log.info("ai_advisor.request.start", prompt_chars=len(prompt))

    report = backend(settings, model, prompt)

    log.info("ai_advisor.request.done", report_chars=len(report))
    return report


# ---------------------------------------------------------------------------
# Apply suggestions: generate an improved notebook
# ---------------------------------------------------------------------------

APPLY_SYSTEM_PROMPT = """\
You are an expert ML engineer. You receive a training notebook (its code cells, \
each with an index) and a review report with improvement recommendations.

Apply the recommendations from the report directly to the notebook code. Keep \
the notebook's overall structure and the `mlops:*` cell tags working: do NOT \
remove or rename MODEL_NAME, VERSION, MODEL_OUTPUT_PATH, or the joblib.dump \
export. Only change what the report justifies.

Respond ONLY with a JSON object, no prose and no Markdown fences, with exactly \
this shape:

{
  "commit_message": "<one-line conventional commit message in Spanish>",
  "cells": [
    {"index": <int, index of an existing code cell>, "source": "<the FULL new source code of that cell>"}
  ]
}

Rules:
- Include only the cells you actually changed.
- "source" must be the complete replacement source for the cell, not a diff.
- The code must be valid Python that runs top-to-bottom in the notebook.\
"""


def _extract_json(text: str) -> dict[str, Any]:
    """Parse a JSON object from model output, tolerating Markdown fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Strip a leading ```json / ``` fence and the trailing fence
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[: -3]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"Model did not return a JSON object: {text[:300]}")
    return json.loads(cleaned[start : end + 1])


def apply_cells_patch(
    notebook: dict[str, Any], cells: list[dict[str, Any]]
) -> dict[str, Any]:
    """Return a copy of the notebook with the given cell sources replaced."""
    import copy

    patched = copy.deepcopy(notebook)
    nb_cells = patched.get("cells", [])
    for change in cells:
        index = change.get("index")
        source = change.get("source", "")
        if not isinstance(index, int) or index < 0 or index >= len(nb_cells):
            raise ValueError(f"Patch references invalid cell index: {index}")
        if nb_cells[index].get("cell_type") != "code":
            raise ValueError(f"Patch targets non-code cell at index {index}")
        # nbformat stores source as a list of lines with trailing newlines
        nb_cells[index]["source"] = source.splitlines(keepends=True)
        nb_cells[index]["outputs"] = []
        nb_cells[index]["execution_count"] = None
    return patched


def generate_improved_notebook(
    *,
    notebook: dict[str, Any],
    report: str,
) -> tuple[dict[str, Any], str]:
    """Ask the configured provider to apply the report's suggestions.

    Returns:
        (patched notebook dict, commit message)

    Raises:
        RuntimeError: if the provider is not configured.
        ValueError: if the model response cannot be parsed or applied.
    """
    settings = get_settings()
    if not advisor_configured(settings):
        raise RuntimeError(
            f"AI advisor provider '{settings.ai_advisor_provider}' is not "
            "configured (missing API key or base URL)."
        )

    backend = _BACKENDS[settings.ai_advisor_provider]
    model = resolve_model(settings)

    prompt = (
        f"## Informe de revision\n{report}\n\n"
        f"## Codigo actual del notebook\n```python\n{_extract_code_cells(notebook)}\n```"
    )

    log = logger.bind(provider=settings.ai_advisor_provider, model=model)
    log.info("ai_advisor.apply.start", prompt_chars=len(prompt))

    raw = backend(settings, model, prompt, APPLY_SYSTEM_PROMPT)
    patch = _extract_json(raw)

    cells = patch.get("cells") or []
    if not cells:
        raise ValueError("The model returned no cell changes to apply.")
    commit_message = patch.get("commit_message") or "ai: aplica sugerencias del advisor"

    patched = apply_cells_patch(notebook, cells)
    log.info("ai_advisor.apply.done", cells_changed=len(cells))
    return patched, commit_message
