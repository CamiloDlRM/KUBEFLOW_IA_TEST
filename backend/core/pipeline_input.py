"""What a pipeline trains on, chosen rather than implied.

Before this, the notebook was handed the project's *active dataset*: whatever
had last been uploaded or built, decided by whichever of those happened most
recently, and recorded nowhere on the run. Two runs a day apart could train on
different data with nothing on either saying so.

Now a repository says which layer it trains on — the newest gold build, a
particular one, or one source's silver or bronze — and every run records what
that resolved to. The choice is the intent; the record is the fact. Keeping
them apart is what lets a repository follow gold as it is rebuilt while each
run still names the exact build it saw.

An empty choice keeps the old behaviour, so a repository nobody has touched
trains exactly as it did before.
"""
from __future__ import annotations

import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from sqlmodel import Session, select

from core import medallion
from models.schemas import DataSource, GoldTable

logger = structlog.get_logger(__name__)

#: The layers a pipeline can be pointed at. Bronze is allowed on purpose: it is
#: the uncleaned extract, which is exactly what you want when the question is
#: whether the cleaning standard is helping the model or hurting it.
INPUT_LAYERS: tuple[str, ...] = ("bronze", "silver", "gold")


class InputError(ValueError):
    """The choice cannot be resolved to anything that exists."""


@dataclass(frozen=True)
class InputChoice:
    """What a repository asks to train on.

    ``layer`` empty means "the project's active dataset", the behaviour from
    before layers could be chosen. Gold takes a ``version``, or none to follow
    the newest build. Bronze and silver are per source, because each source is
    its own table with its own columns: stacking two of them would hand the
    notebook a frame that is mostly nulls.
    """

    layer: str = ""
    source_id: int | None = None
    version: int | None = None

    @classmethod
    def parse(cls, raw: dict[str, Any] | None) -> InputChoice:
        raw = raw or {}
        layer = str(raw.get("layer") or "")
        if layer and layer not in INPUT_LAYERS:
            raise InputError(
                f"unknown layer {layer!r}; expected one of {', '.join(INPUT_LAYERS)}"
            )
        source_id = raw.get("source_id")
        version = raw.get("version")
        if layer in ("bronze", "silver") and source_id is None:
            raise InputError(f"{layer} is per source: say which source")
        if version is not None and int(version) < 1:
            raise InputError("gold versions start at 1")
        return cls(
            layer=layer,
            source_id=int(source_id) if source_id is not None and layer != "gold" else None,
            version=int(version) if version is not None and layer == "gold" else None,
        )

    def as_dict(self) -> dict[str, Any]:
        return {key: value for key, value in asdict(self).items() if value not in (None, "")}


@dataclass
class ResolvedInput:
    """What a choice pointed at when it was resolved: the objects themselves."""

    layer: str
    bucket: str
    keys: list[str]
    label: str
    version: int | None = None
    source_id: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _source_of(session: Session, project_id: int, source_id: int) -> DataSource:
    source = session.get(DataSource, source_id)
    # Another project's source is reported as missing, not as forbidden: the
    # id is someone else's, and saying so would confirm that it exists.
    if source is None or source.project_id != project_id:
        raise InputError(f"source {source_id} does not exist in this project")
    return source


def _gold_of(session: Session, project_id: int) -> GoldTable:
    table = session.exec(select(GoldTable).where(GoldTable.project_id == project_id)).first()
    if table is None or table.version < 1 or not table.object_key:
        raise InputError("gold has not been built for this project yet")
    return table


_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def _stream_keys(layer: str, project_id: int, source_id: int) -> list[str]:
    """Every object of one source in ``layer``, oldest first."""
    objects = [
        item
        for item in medallion.list_layer(layer, medallion.stream_prefix(project_id, source_id))
        if item.key.endswith(".parquet")
    ]
    objects.sort(key=lambda item: (item.last_modified or _EPOCH, item.key))
    return [item.key for item in objects]


def resolve(session: Session, project_id: int, choice: InputChoice) -> ResolvedInput | None:
    """Turn a choice into the objects it means today.

    Returns ``None`` for the empty choice: the caller falls back to the active
    dataset. Anything else that resolves to nothing raises, because a
    repository that asked for gold and was quietly handed something else is
    the implicitness this module exists to remove.
    """
    if not choice.layer:
        return None

    if choice.layer == "gold":
        table = _gold_of(session, project_id)
        if choice.version is None or choice.version == table.version:
            key, version = table.object_key, table.version
        else:
            key = medallion.gold_key(project_id, table.name, choice.version)
            listed = {
                item.key
                for item in medallion.list_layer("gold", medallion.gold_prefix(project_id, table.name))
            }
            if key not in listed:
                raise InputError(f"gold v{choice.version} is not in object storage")
            version = choice.version
        return ResolvedInput(
            layer="gold",
            bucket=medallion.bucket_for("gold"),
            keys=[key],
            label=f"gold v{version}",
            version=version,
        )

    source = _source_of(session, project_id, choice.source_id)  # type: ignore[arg-type]
    keys = _stream_keys(choice.layer, project_id, source.id)  # type: ignore[arg-type]
    if not keys:
        raise InputError(f"{source.name!r} has nothing in {choice.layer} yet")
    return ResolvedInput(
        layer=choice.layer,
        bucket=medallion.bucket_for(choice.layer),
        keys=keys,
        label=f"{choice.layer} · {source.name} ({len(keys)} object{'s' if len(keys) != 1 else ''})",
        source_id=source.id,
    )


def _filename(resolved: ResolvedInput) -> str:
    if resolved.layer == "gold":
        return f"gold-v{resolved.version:04d}.parquet"
    return f"{resolved.layer}-source-{resolved.source_id}.parquet"


def mount(resolved: ResolvedInput, directory: Path) -> Path:
    """Download what ``resolved`` names and return one Parquet file.

    A notebook reads ``DATASET_PATH`` as one file, and it always has, so a
    source's history is stacked into one before the notebook sees it. The
    stacking is by column name, for the reason gold's is: a column added to the
    source last month is absent from the older objects, and a positional union
    would shift every value after it one column left.
    """
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / _filename(resolved)

    if len(resolved.keys) == 1:
        return medallion.download_parquet(resolved.layer, resolved.keys[0], target)

    import duckdb

    parts = directory / "parts"
    parts.mkdir(exist_ok=True)
    paths = [
        medallion.download_parquet(resolved.layer, key, parts / f"{index:04d}.parquet")
        for index, key in enumerate(resolved.keys)
    ]
    # Inlined rather than bound, because DuckDB will not prepare a COPY. The
    # paths are files this process just wrote; the quotes are escaped anyway.
    files = ", ".join("'" + str(path).replace("'", "''") + "'" for path in paths)
    out = str(target).replace("'", "''")
    connection = duckdb.connect(":memory:")
    try:
        connection.execute(
            f"COPY (SELECT * FROM read_parquet([{files}], union_by_name := true)) "
            f"TO '{out}' (FORMAT parquet)"
        )
    finally:
        connection.close()
    shutil.rmtree(parts, ignore_errors=True)
    return target


def match_reader(path: Path, wanted: str | None) -> Path:
    """Convert the mounted file to the format the notebook reads, if it differs.

    The platform stores layers as Parquet, but a notebook written against a
    local CSV file calls ``read_csv``; handing it Parquet fails on bytes it
    cannot decode. Only CSV and Parquet are converted; anything else, or a
    file already in the wanted format, is returned untouched.
    """
    current = path.suffix.lower().lstrip(".")
    if wanted not in ("csv", "parquet") or current not in ("csv", "parquet") or current == wanted:
        return path

    import pandas as pd

    target = path.with_suffix(f".{wanted}")
    if wanted == "csv":
        pd.read_parquet(path).to_csv(target, index=False)
    else:
        pd.read_csv(path).to_parquet(target, index=False)
    path.unlink()
    return target


# ---------------------------------------------------------------------------
# What can be chosen
# ---------------------------------------------------------------------------


@dataclass
class StreamOption:
    source_id: int
    source_name: str
    objects: int
    size_bytes: int


@dataclass
class GoldOption:
    version: int
    key: str
    size_bytes: int
    built_at: datetime | None
    latest: bool


@dataclass
class InputOptions:
    bronze: list[StreamOption] = field(default_factory=list)
    silver: list[StreamOption] = field(default_factory=list)
    gold: list[GoldOption] = field(default_factory=list)


def options(session: Session, project_id: int) -> InputOptions:
    """Everything in this project a pipeline could be pointed at.

    Read from object storage rather than from the run records, because what
    can be mounted is what is actually there. Gold lists every build still
    stored, not only the newest: pinning an older one is how a result from
    last month is reproduced.
    """
    found = InputOptions()
    sources = session.exec(select(DataSource).where(DataSource.project_id == project_id)).all()

    for layer in ("bronze", "silver"):
        streams: list[StreamOption] = getattr(found, layer)
        for source in sources:
            if source.id is None:
                continue
            objects = [
                item
                for item in medallion.list_layer(layer, medallion.stream_prefix(project_id, source.id))
                if item.key.endswith(".parquet")
            ]
            if objects:
                streams.append(
                    StreamOption(
                        source_id=source.id,
                        source_name=source.name,
                        objects=len(objects),
                        size_bytes=sum(item.size_bytes for item in objects),
                    )
                )

    table = session.exec(select(GoldTable).where(GoldTable.project_id == project_id)).first()
    if table is not None and table.version >= 1:
        prefix = medallion.gold_prefix(project_id, table.name)
        for item in medallion.list_layer("gold", prefix):
            stem = item.key[len(prefix):].removesuffix(".parquet")
            if not (stem.startswith("v") and stem[1:].isdigit()):
                continue
            version = int(stem[1:])
            found.gold.append(
                GoldOption(
                    version=version,
                    key=item.key,
                    size_bytes=item.size_bytes,
                    built_at=item.last_modified,
                    latest=version == table.version,
                )
            )
        found.gold.sort(key=lambda option: option.version, reverse=True)

    return found
