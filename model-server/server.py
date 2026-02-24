"""Model serving server.

Loads trained models from MLflow and exposes dynamic prediction endpoints.
Models are held in memory and can be loaded/unloaded at runtime.
"""
from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

import structlog
import uvicorn
from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class ModelServerSettings(BaseSettings):
    """Model-server configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    mlflow_tracking_uri: str = Field(default="http://mlflow:5000")
    models_base_path: str = Field(default="/app/models")
    log_level: str = Field(default="INFO")
    port: int = Field(default=8001)


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

    data: list[list[float]] = Field(
        ..., description="2-D array of feature vectors."
    )


class PredictResponse(BaseModel):
    prediction: list[Any]
    model_name: str
    version: str


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
            detail=f"Failed to load model: {exc}",
        )


@app.post(
    "/predict/{model_name}",
    response_model=PredictResponse,
    tags=["inference"],
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
    try:
        prediction = entry.model.predict(body.data)
        entry.request_count += 1
        result = prediction.tolist() if hasattr(prediction, "tolist") else list(prediction)

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
        )
    except Exception as exc:
        logger.exception("model.predict_failed", model_name=model_name, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction failed: {exc}",
        )


@app.get(
    "/models",
    response_model=list[ModelInfoResponse],
    tags=["models"],
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
