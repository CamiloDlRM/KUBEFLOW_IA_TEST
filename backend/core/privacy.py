"""Health data: the legal basis for holding it, and suppressing identity before it lands.

Colombian law treats health data as *sensitive* (Ley 1581 de 2012, art. 5).
Processing it is prohibited (art. 6) unless the data subject authorised it,
or the purpose is historical, statistical or scientific — and then "measures
leading to the suppression of the subjects' identity" must be adopted (art. 6,
lit. e). Health research additionally needs the approval of an ethics
committee and must protect the subject's privacy (Resolución 8430 de 1993,
arts. 8 and 11).

This module is the technical half of that. A project that holds health data
says so, records *why* it may hold it (the legal basis), and from then on
every row it lands has its direct identifiers suppressed before anything is
written — before bronze, so no layer, no profile and no report ever holds
them:

- **Identifiers** (patient id, document numbers, SSN, record numbers, any
  ``*_id``) are replaced with a keyed pseudonym: HMAC-SHA256 under a key held
  by the platform, per project. The same value always gets the same
  pseudonym, so tables still join and a patient's history still lines up;
  without the key, the pseudonym leads nowhere. A plain hash would not do:
  the space of document numbers is small enough to hash exhaustively.
- **Direct identifiers with no analytic use** (names, addresses, phones,
  e-mails, exact coordinates, birthplace) are removed.
- **Quasi-identifiers** that single people out in combination are coarsened:
  dates of birth and death keep the year, postal codes their first three
  characters.

The rest — diagnoses, procedures, clinical dates, measurements — is kept,
because it is what the research is for; that is what the legal basis and the
ethics approval are about. This is pseudonymisation, not anonymisation: the
platform holds the key, so the data remains personal data in the law's
sense, and access to it stays restricted.

What this does *not* do, and nobody should claim it does: obtain the
authorisations, approve the protocol, publish a data-processing policy or
register the database with the SIC. Those are the institution's acts; the
platform records that they happened and refuses to land health data until
someone says which one applies.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Final

#: The two classifications a project can have.
CLASSIFICATIONS: Final[tuple[str, ...]] = ("general", "health")

#: Why the platform may hold a project's health data. Each names the article
#: it rests on, so the record says what was claimed, not only that something
#: was.
LEGAL_BASES: Final[dict[str, dict[str, str]]] = {
    "authorization": {
        "title": "Authorisation of the data subjects",
        "law": "Ley 1581 de 2012, arts. 6(a) and 9",
        "reference_hint": "Where the signed authorisations are kept (consent form and version).",
    },
    "scientific": {
        "title": "Scientific or statistical purpose, with ethics approval",
        "law": "Ley 1581 de 2012, art. 6(e); Resolución 8430 de 1993",
        "reference_hint": "Ethics committee and the number and date of its approval.",
    },
    "synthetic": {
        "title": "Synthetic data, no real data subjects",
        "law": "Outside Ley 1581 (no data subject); handled as health data to keep the controls exercised",
        "reference_hint": "Generator and version, e.g. Synthea sample, seed 20260911.",
    },
}

PSEUDONYM_PREFIX: Final[str] = "ps_"
_PSEUDONYM_HEX: Final[int] = 20  # 80 bits: collisions are not a concern at this scale

#: Columns whose whole (standardised) name marks them as an identifier.
_IDENTIFIER_NAMES: Final[frozenset[str]] = frozenset({
    "id", "patient", "paciente", "person", "persona", "subject", "sujeto",
    "historia_clinica", "numero_historia", "identificacion", "numero_identificacion",
    "numero_documento", "num_documento", "nro_documento", "documento_identidad",
})
#: Words that mark a column as an identifier wherever they appear in its name.
_IDENTIFIER_WORDS: Final[frozenset[str]] = frozenset({
    "ssn", "dni", "cedula", "nuip", "nit", "rut", "curp", "passport", "pasaporte",
    "drivers", "licencia", "mrn", "nhc", "documento",
})
#: Words that mark a direct identifier with no analytic use wherever they appear.
_SUPPRESS_WORDS: Final[frozenset[str]] = frozenset({
    "apellido", "apellidos", "surname", "maiden", "address", "direccion", "phone",
    "telefono", "celular", "movil", "email", "correo", "mail", "latitude",
    "longitude", "latitud", "longitud", "birthplace",
})
#: Whole names of direct identifiers. "name", "first" and "last" are only
#: identifiers on their own or about a person: ``drug_name``, ``test_name`` and
#: ``first_dose`` are clinical data and must survive.
_SUPPRESS_NAMES: Final[frozenset[str]] = frozenset({
    "name", "names", "nombre", "nombres", "full_name", "nombre_completo", "first", "last",
    "firstname", "lastname", "first_name", "last_name", "given_name", "family_name",
    "middle_name", "primer_nombre", "segundo_nombre", "prefix", "suffix", "lat", "lon",
    "lng", "lugar_nacimiento", "lugar_de_nacimiento",
})
#: "name"/"nombre" together with one of these is a person's name.
_PERSON_WORDS: Final[frozenset[str]] = frozenset({
    "patient", "paciente", "person", "persona", "provider", "doctor", "medico",
    "contact", "contacto", "acudiente", "responsable", "user", "usuario",
})
#: Dates that, with sex and place, single a person out: keep the year.
_YEAR_NAMES: Final[frozenset[str]] = frozenset({
    "birthdate", "birth_date", "date_of_birth", "dob", "fecha_nacimiento",
    "fecha_de_nacimiento", "deathdate", "death_date", "date_of_death",
    "fecha_defuncion", "fecha_de_defuncion", "fecha_muerte",
})
_ZIP_WORDS: Final[frozenset[str]] = frozenset({"zip", "zipcode", "postal", "postcode", "codigo_postal"})

_NON_NAME = re.compile(r"[^a-z0-9]+")
_YEAR = re.compile(r"(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)")


class PrivacyError(ValueError):
    """A privacy setting that cannot be used, and why."""


def _snake(name: str) -> str:
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name.strip())
    folded = unicodedata.normalize("NFKD", spaced).encode("ascii", "ignore").decode()
    return _NON_NAME.sub("_", folded.lower()).strip("_")


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LegalBasis:
    kind: str
    #: What the data is processed for (Ley 1581, principle of purpose).
    purpose: str
    #: The approval, the authorisations, or the generator — whatever backs ``kind``.
    reference: str
    #: Who is responsible for the processing (the institution or person).
    responsible: str
    recorded_by: str = ""
    recorded_at: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "purpose": self.purpose,
            "reference": self.reference,
            "responsible": self.responsible,
            "recorded_by": self.recorded_by,
            "recorded_at": self.recorded_at,
        }

    @classmethod
    def from_dict(cls, raw: Any) -> LegalBasis:
        if not isinstance(raw, dict):
            raise PrivacyError("the legal basis is an object with kind, purpose, reference and responsible")
        kind = raw.get("kind")
        if kind not in LEGAL_BASES:
            raise PrivacyError(f"the legal basis is one of {', '.join(LEGAL_BASES)}")
        fields: dict[str, str] = {}
        for name, what in (
            ("purpose", "the purpose of the processing"),
            ("reference", "the reference that backs it"),
            ("responsible", "who is responsible for the processing"),
        ):
            value = raw.get(name)
            if not isinstance(value, str) or not value.strip():
                raise PrivacyError(f"{what} is required")
            if len(value) > 1000:
                raise PrivacyError(f"{what} is longer than 1000 characters")
            fields[name] = value.strip()
        return cls(
            kind=kind,
            recorded_by=str(raw.get("recorded_by") or ""),
            recorded_at=str(raw.get("recorded_at") or ""),
            **fields,
        )


@dataclass(frozen=True)
class PrivacyPolicy:
    """Adjustments to the automatic detection. Names match as written or standardised."""

    #: Also pseudonymise these.
    pseudonymize: tuple[str, ...] = ()
    #: Also remove these.
    suppress: tuple[str, ...] = ()
    #: Leave these alone although they were detected. The owner's decision,
    #: kept on the record with the rest of the policy.
    keep: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, list[str]]:
        return {"pseudonymize": list(self.pseudonymize), "suppress": list(self.suppress), "keep": list(self.keep)}

    @classmethod
    def from_dict(cls, raw: Any) -> PrivacyPolicy:
        if raw is None:
            return cls()
        if not isinstance(raw, dict) or set(raw) - {"pseudonymize", "suppress", "keep"}:
            raise PrivacyError("the privacy policy lists columns to pseudonymize, suppress and keep")
        lists = {}
        for name in ("pseudonymize", "suppress", "keep"):
            values = raw.get(name) or []
            if not isinstance(values, list) or not all(isinstance(v, str) for v in values) or len(values) > 500:
                raise PrivacyError(f"{name} is a list of column names")
            lists[name] = tuple(dict.fromkeys(v.strip() for v in values if v.strip()))
        overlap = {_snake(v) for v in lists["keep"]} & {_snake(v) for v in (*lists["pseudonymize"], *lists["suppress"])}
        if overlap:
            raise PrivacyError(f"a column cannot be both kept and protected: {', '.join(sorted(overlap))}")
        return cls(**lists)


@dataclass(frozen=True)
class ProjectPrivacy:
    """A project's privacy settings, as stored on ``Project.privacy``."""

    classification: str = "general"
    legal_basis: LegalBasis | None = None
    policy: PrivacyPolicy = PrivacyPolicy()

    @property
    def health(self) -> bool:
        return self.classification == "health"

    @classmethod
    def from_stored(cls, raw: Any) -> ProjectPrivacy:
        """Read what is stored, failing safe: a health project stays a health project."""
        raw = raw or {}
        classification = raw.get("classification", "general")
        if classification not in CLASSIFICATIONS:
            classification = "health"
        try:
            basis = LegalBasis.from_dict(raw["legal_basis"]) if raw.get("legal_basis") else None
        except PrivacyError:
            basis = None
        try:
            policy = PrivacyPolicy.from_dict(raw.get("policy"))
        except PrivacyError:
            policy = PrivacyPolicy()
        return cls(classification=classification, legal_basis=basis, policy=policy)


# ---------------------------------------------------------------------------
# Deciding what happens to each column
# ---------------------------------------------------------------------------

ACTIONS: Final[tuple[str, ...]] = ("pseudonymize", "suppress", "year", "zip3")


def classify(column: str, policy: PrivacyPolicy = PrivacyPolicy()) -> str | None:
    """What happens to ``column`` in a health project, or ``None`` for nothing."""
    name = _snake(column)
    if name in {_snake(v) for v in policy.keep}:
        return None
    if name in {_snake(v) for v in policy.suppress}:
        return "suppress"
    if name in {_snake(v) for v in policy.pseudonymize}:
        return "pseudonymize"

    words = set(name.split("_"))
    if name in _YEAR_NAMES:
        return "year"
    if words & _ZIP_WORDS or name in _ZIP_WORDS:
        return "zip3"
    # A document *type* (CC, TI, passport) is a category, not an identifier.
    is_type = bool(words & {"tipo", "type", "kind", "clase"})
    if not is_type and (
        name in _IDENTIFIER_NAMES or words & _IDENTIFIER_WORDS or name.endswith("_id") or name.startswith("id_")
    ):
        return "pseudonymize"
    if name in _SUPPRESS_NAMES or words & _SUPPRESS_WORDS:
        return "suppress"
    if words & {"name", "nombre", "nombres"} and words & _PERSON_WORDS:
        return "suppress"
    return None


def plan(columns: list[str], policy: PrivacyPolicy = PrivacyPolicy()) -> dict[str, str]:
    """``{column: action}`` for the columns something happens to."""
    decided = {column: classify(column, policy) for column in columns}
    return {column: action for column, action in decided.items() if action}


# ---------------------------------------------------------------------------
# Applying it
# ---------------------------------------------------------------------------


def new_key() -> str:
    """A fresh pseudonymisation key, hex-encoded."""
    return secrets.token_hex(32)


def key_id(key: str) -> str:
    """A short, non-secret name for a key, so a report says which key made it."""
    return hashlib.sha256(("key-id:" + key).encode()).hexdigest()[:8]


def pseudonym(value: str, key: str) -> str:
    digest = hmac.new(bytes.fromhex(key), value.strip().encode("utf-8"), hashlib.sha256).hexdigest()
    return PSEUDONYM_PREFIX + digest[:_PSEUDONYM_HEX]


def _year(value: str) -> str | None:
    match = _YEAR.search(value)
    return match.group(1) if match else None


def _apply(action: str, value: Any, key: str) -> Any:
    if value is None:
        return None
    text = str(value)
    if not text.strip():
        return value
    if action == "pseudonymize":
        # Idempotent: protecting twice must not pseudonymise a pseudonym.
        return text if text.startswith(PSEUDONYM_PREFIX) else pseudonym(text, key)
    if action == "year":
        return _year(text)
    if action == "zip3":
        return text.strip()[:3]
    raise ValueError(action)


@dataclass
class PrivacyReport:
    """What was done to one landed file, kept on the run and the upload."""

    pseudonymized: list[str] = field(default_factory=list)
    suppressed: list[str] = field(default_factory=list)
    generalized: dict[str, str] = field(default_factory=dict)
    kept: list[str] = field(default_factory=list)
    rows: int = 0
    key_id: str = ""
    protected_at: str = ""

    def summary(self) -> dict[str, Any]:
        return {
            "protected": True,
            "pseudonymized": self.pseudonymized,
            "suppressed": self.suppressed,
            "generalized": self.generalized,
            "kept": self.kept,
            "rows": self.rows,
            "key_id": self.key_id,
            "protected_at": self.protected_at,
        }


def protect_parquet(path: Path, key: str, policy: PrivacyPolicy = PrivacyPolicy()) -> PrivacyReport:
    """Suppress identity in a bronze Parquet file, in place.

    Bronze holds text, as the source gave it, so every action works on
    strings. The file is rewritten whole; a landed slice is read into memory
    by the cleaning anyway, so this is no new bound.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pq.read_table(path)
    actions = plan(list(table.column_names), policy)
    report = PrivacyReport(
        rows=table.num_rows,
        key_id=key_id(key),
        protected_at=datetime.now(timezone.utc).isoformat(),
        kept=[name for name in table.column_names if _snake(name) in {_snake(v) for v in policy.keep}],
    )
    arrays, fields = [], []
    for name in table.column_names:
        action = actions.get(name)
        if action == "suppress":
            report.suppressed.append(name)
            continue
        column = table.column(name)
        if action:
            values = [_apply(action, value, key) for value in column.to_pylist()]
            column = pa.array(values, type=pa.string())
            if action == "pseudonymize":
                report.pseudonymized.append(name)
            else:
                report.generalized[name] = action
        arrays.append(column)
        fields.append(pa.field(name, column.type))
    protected = pa.Table.from_arrays(arrays, schema=pa.schema(fields))
    scratch = path.with_suffix(".protected.parquet")
    pq.write_table(protected, scratch, compression="snappy")
    scratch.replace(path)
    return report


def redact_profile(profile: dict[str, Any], actions: dict[str, str]) -> dict[str, Any]:
    """A column profile without what it would leak about protected columns.

    Profiles keep each column's most frequent values, which for a name or a
    document number is exactly the data being suppressed.
    """
    redacted: dict[str, Any] = {}
    for column, summary in (profile or {}).items():
        action = actions.get(column)
        if action == "suppress":
            continue
        if action and isinstance(summary, dict):
            summary = {
                key: value
                for key, value in summary.items()
                if key not in ("top_values", "min", "max", "mean", "stddev", "examples")
            }
            summary["protected"] = action
        redacted[column] = summary
    return redacted


def actions_of(report: dict[str, Any]) -> dict[str, str]:
    """``{column: action}`` back out of a stored report."""
    actions = {column: "pseudonymize" for column in report.get("pseudonymized", [])}
    actions.update({column: "suppress" for column in report.get("suppressed", [])})
    actions.update(report.get("generalized", {}))
    return actions


def protect_file(source: Path, extension: str, destination: Path, key: str, policy: PrivacyPolicy) -> PrivacyReport:
    """Turn an uploaded file into a protected bronze Parquet file.

    For a health project the upload request does this itself, so the file
    that is stored is already protected: the original is never written to
    object storage, not even while it waits for the worker.
    """
    from core.tabular import to_bronze

    to_bronze(source, extension, destination)
    return protect_parquet(destination, key, policy)


# ---------------------------------------------------------------------------
# The key and the stored settings
# ---------------------------------------------------------------------------


def project_key(session: Any, project: Any, settings: Any) -> str:
    """The project's pseudonymisation key, made on first use.

    Stored encrypted with the platform's Fernet key, like a GitHub token, and
    never returned by the API. Losing it does not lose data; it only means new
    pseudonyms will not match old ones — which is why it is made once and kept.
    """
    from core.github_credentials import decrypt_token, encrypt_token

    if project.pseudonym_key:
        return decrypt_token(project.pseudonym_key, settings)
    key = new_key()
    project.pseudonym_key = encrypt_token(key, settings)
    session.add(project)
    session.commit()
    session.refresh(project)
    return key
