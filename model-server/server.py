"""Model serving server.

Loads trained models from MLflow and exposes dynamic prediction endpoints.
Models are held in memory and can be loaded/unloaded at runtime.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

import structlog
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.concurrency import run_in_threadpool

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class ModelServerSettings(BaseSettings):
    """Model-server configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        protected_namespaces=("settings_",),
    )

    mlflow_tracking_uri: str = Field(default="http://mlflow:5000")
    models_base_path: str = Field(default="/app/model_artifacts")
    log_level: str = Field(default="INFO")
    port: int = Field(default=8001)
    #: Shared with the backend and worker. Every endpoint but the health checks
    #: requires it, so only the platform can load, unload or query models. Empty
    #: disables the check, for local runs.
    model_server_internal_token: str = Field(default="")
    #: Rows one prediction may carry, and how long it may run.
    predict_max_rows: int = Field(default=1000)
    predict_timeout_seconds: float = Field(default=20.0)


settings = ModelServerSettings()


# ---------------------------------------------------------------------------
# Structlog setup
# ---------------------------------------------------------------------------


def _configure_structlog() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
    )


_configure_structlog()
logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# In-memory model registry
# ---------------------------------------------------------------------------


class _ModelEntry:
    """Container for a loaded model and its metadata."""

    def __init__(
        self,
        model: Any,
        model_name: str,
        version: str,
        mlflow_run_id: str,
    ) -> None:
        self.model = model
        self.model_name = model_name
        self.version = version
        self.mlflow_run_id = mlflow_run_id
        self.loaded_at = datetime.now(timezone.utc)
        self.request_count = 0


_models: dict[str, _ModelEntry] = {}


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class LoadModelRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    mlflow_run_id: str
    version: str


class PredictRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    data: list[list[FiniteFloat]] = Field(
        ..., min_length=1, description="2-D array of feature vectors."
    )

    @field_validator("data")
    @classmethod
    def _rows_are_rectangular(cls, data: list[list[float]]) -> list[list[float]]:
        if any(len(row) == 0 for row in data):
            raise ValueError("every row needs at least one number")
        if len({len(row) for row in data}) > 1:
            raise ValueError("every row must have the same number of values")
        return data


class PredictResponse(BaseModel):
    prediction: list[Any]
    model_name: str
    version: str
    probabilities: list[dict[str, float]] | None = None


class ModelInfoResponse(BaseModel):
    model_name: str
    version: str
    mlflow_run_id: str
    loaded_at: str
    request_count: int


class HealthResponse(BaseModel):
    status: str = "ok"


class ReadyResponse(BaseModel):
    status: str
    models_loaded: int


class MessageResponse(BaseModel):
    message: str


# ---------------------------------------------------------------------------
# Internal token
# ---------------------------------------------------------------------------


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """Refuse callers without the platform's shared token.

    Loading a model unpickles an artifact (joblib), which runs code: an open
    load endpoint would let anyone run code here. Unloading takes models
    offline, and predicting skips the backend's limits. So all of it is the
    platform's alone. Compared in constant time, so the token cannot be
    guessed a character at a time from response timings.
    """
    expected = settings.model_server_internal_token
    if not expected:
        return
    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or wrong internal token.")


_internal = [Depends(require_internal_token)]


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("model_server.startup")
    Path(settings.models_base_path).mkdir(parents=True, exist_ok=True)
    yield
    logger.info("model_server.shutdown", models_in_memory=len(_models))


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MLOps Model Server",
    description="Dynamic model serving with runtime load/unload.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 with where and why, never the value sent: a NaN cannot be written as
    JSON, so echoing it back turned a 422 into a 500."""
    errors = [
        {key: value for key, value in error.items() if key in ("type", "loc", "msg")}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


# ---------------------------------------------------------------------------
# System endpoints
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Health check. Returns 200 if the server process is alive."""
    return HealthResponse()


@app.get("/ready", response_model=ReadyResponse, tags=["system"])
async def ready() -> ReadyResponse:
    """Readiness check. Reports number of models loaded."""
    return ReadyResponse(
        status="ok" if _models else "no_models",
        models_loaded=len(_models),
    )


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------


@app.post(
    "/internal/load/{model_name}",
    response_model=MessageResponse,
    tags=["internal"],
    dependencies=_internal,
    summary="Load a model from MLflow",
)
async def load_model(
    model_name: str,
    body: LoadModelRequest,
) -> MessageResponse:
    """Load a trained model artifact from MLflow into memory.

    Called internally by the backend after a successful pipeline run.

    Args:
        model_name: Name to register the model under.
        body: MLflow run ID and version.
    """
    import mlflow

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)

    try:
        # Try to download the artifact from MLflow
        client = mlflow.tracking.MlflowClient()
        local_path = client.download_artifacts(
            body.mlflow_run_id,
            "model",
            dst_path=settings.models_base_path,
        )

        # Load the model with joblib
        import joblib

        model_file = Path(local_path)
        if model_file.is_dir():
            # Find the .joblib file inside the directory
            joblib_files = list(model_file.glob("*.joblib"))
            if joblib_files:
                model = joblib.load(joblib_files[0])
            else:
                # Try pickle or any file
                files = list(model_file.iterdir())
                if files:
                    model = joblib.load(files[0])
                else:
                    raise FileNotFoundError(f"No model files in {local_path}")
        else:
            model = joblib.load(model_file)

        _models[model_name] = _ModelEntry(
            model=model,
            model_name=model_name,
            version=body.version,
            mlflow_run_id=body.mlflow_run_id,
        )

        logger.info(
            "model.loaded",
            model_name=model_name,
            version=body.version,
            mlflow_run_id=body.mlflow_run_id,
        )
        return MessageResponse(
            message=f"Model '{model_name}' v{body.version} loaded successfully."
        )

    except Exception as exc:
        logger.exception(
            "model.load_failed",
            model_name=model_name,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load model; see the model-server logs.",
        )


def _probabilities(model: Any, data: list[list[float]]) -> list[dict[str, float]] | None:
    """Each row's probability per class, or None when the model has none.

    Best effort: a classifier that cannot produce probabilities still answers
    the prediction, which is what the request was for.
    """
    if not hasattr(model, "predict_proba") or not hasattr(model, "classes_"):
        return None
    try:
        rows = model.predict_proba(data)
    except Exception:  # noqa: BLE001
        return None
    labels = [str(label) for label in model.classes_]
    return [{label: round(float(p), 6) for label, p in zip(labels, row)} for row in rows]


@app.post(
    "/predict/{model_name}",
    response_model=PredictResponse,
    tags=["inference"],
    dependencies=_internal,
    summary="Run inference",
)
async def predict(
    model_name: str,
    body: PredictRequest,
) -> PredictResponse:
    """Run inference on a loaded model.

    Args:
        model_name: Name of the model.
        body: Input features as a 2-D list.
    """
    if model_name not in _models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_name}' is not loaded.",
        )

    entry = _models[model_name]
    if len(body.data) > settings.predict_max_rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {settings.predict_max_rows} rows per request.",
        )
    # scikit-learn models remember how many features they were fitted on: a row
    # of another length is refused here instead of failing inside the model.
    expected = getattr(entry.model, "n_features_in_", None)
    if isinstance(expected, int) and len(body.data[0]) != expected:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Each row must have {expected} values; got {len(body.data[0])}.",
        )

    def _infer() -> tuple[list[Any], list[dict[str, float]] | None]:
        prediction = entry.model.predict(body.data)
        values = prediction.tolist() if hasattr(prediction, "tolist") else list(prediction)
        return values, _probabilities(entry.model, body.data)

    try:
        # Off the event loop, so a slow model does not stall every other request,
        # and bounded, so a pathological input cannot hold a worker forever.
        result, probabilities = await asyncio.wait_for(
            run_in_threadpool(_infer), timeout=settings.predict_timeout_seconds
        )
        entry.request_count += 1

        logger.info(
            "model.predict",
            model_name=model_name,
            input_rows=len(body.data),
            request_count=entry.request_count,
        )
        return PredictResponse(
            prediction=result,
            model_name=model_name,
            version=entry.version,
            probabilities=probabilities,
        )
    except asyncio.TimeoutError:
        logger.error("model.predict_timeout", model_name=model_name, rows=len(body.data))
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The model took too long to answer.",
        )
    except Exception as exc:
        # The exception text is internal detail (paths, shapes, library
        # internals): it goes to the log, not to whoever sent the request.
        logger.exception("model.predict_failed", model_name=model_name, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Prediction failed.",
        )


@app.get(
    "/models",
    response_model=list[ModelInfoResponse],
    tags=["models"],
    dependencies=_internal,
    summary="List loaded models",
)
async def list_models() -> list[ModelInfoResponse]:
    """List all models currently loaded in memory with metadata."""
    return [
        ModelInfoResponse(
            model_name=entry.model_name,
            version=entry.version,
            mlflow_run_id=entry.mlflow_run_id,
            loaded_at=entry.loaded_at.isoformat(),
            request_count=entry.request_count,
        )
        for entry in _models.values()
    ]


@app.delete(
    "/models/{model_name}",
    response_model=MessageResponse,
    tags=["models"],
    dependencies=_internal,
    summary="Unload a model",
)
async def delete_model(
    model_name: str,
) -> MessageResponse:
    """Unload a model from memory.

    Args:
        model_name: Name of the model to unload.
    """
    if model_name not in _models:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_name}' is not loaded.",
        )

    del _models[model_name]
    logger.info("model.unloaded", model_name=model_name)
    return MessageResponse(message=f"Model '{model_name}' unloaded.")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=settings.port,
        reload=True,
        log_level=settings.log_level.lower(),
    )
