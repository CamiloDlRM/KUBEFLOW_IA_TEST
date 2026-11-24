"""Working out, and installing, the libraries a notebook needs to run.

The notebook's own ``import`` lines decide what is installed; a
``requirements.txt`` in the repository only says which version. A package the
file lists but no cell imports is never installed: the file is the author's,
and installing what the code does not use would let it put anything on the
platform.

Everything goes into one shared place, ``PYTHONUSERBASE`` (a volume mounted in
the worker and, read-only, in the model server), so what a model trained with
is there when it is served. One version of each library for the whole
platform: what is already installed wins over what a file asks for, and the
run says so rather than failing. Nothing here ever upgrades the platform's own
packages.
"""
from __future__ import annotations

import ast
import importlib
import importlib.metadata
import importlib.util
import json
import os
import re
import site
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator

import structlog
from packaging.specifiers import InvalidSpecifier, SpecifierSet
from packaging.version import InvalidVersion, Version

from core.notebook_parser import code_cells, parse_code

logger = structlog.get_logger(__name__)

#: Import names whose package on PyPI is called something else. ``None`` means
#: there is no telling which package is meant, so nothing is guessed.
IMPORT_TO_PACKAGE: dict[str, str | None] = {
    "sklearn": "scikit-learn",
    "skimage": "scikit-image",
    "cv2": "opencv-python-headless",
    "PIL": "Pillow",
    "yaml": "PyYAML",
    "bs4": "beautifulsoup4",
    "dateutil": "python-dateutil",
    "dotenv": "python-dotenv",
    "jwt": "PyJWT",
    "jose": "python-jose",
    "Crypto": "pycryptodome",
    "OpenSSL": "pyOpenSSL",
    "attr": "attrs",
    "docx": "python-docx",
    "pptx": "python-pptx",
    "serial": "pyserial",
    "fitz": "PyMuPDF",
    "imblearn": "imbalanced-learn",
    "umap": "umap-learn",
    "sentence_transformers": "sentence-transformers",
    "category_encoders": "category-encoders",
    "mpl_toolkits": "matplotlib",
    "IPython": "ipython",
    "google": None,
}

_REQUIREMENT_LINE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$")


def normalize(name: str) -> str:
    """A package name as pip compares them: case and ``-_.`` do not matter."""
    return re.sub(r"[-_.]+", "-", name).lower()


def notebook_imports(notebook: dict[str, Any]) -> set[str]:
    """The top-level modules the notebook's code imports.

    Relative imports (``from . import x``) are the repository's own code, not
    a package, so they are left out.
    """
    found: set[str] = set()
    for source in code_cells(notebook):
        tree = parse_code(source)
        if tree is None:
            # Not valid Python as a whole; the import lines usually still are.
            for match in re.finditer(r"^\s*(?:import|from)\s+([A-Za-z_]\w*)", source, re.MULTILINE):
                found.add(match.group(1))
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                found.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                found.add(node.module.split(".")[0])
    return found - {"__future__"}


def parse_requirements(text: str) -> dict[str, tuple[str, str]]:
    """``requirements.txt`` as ``{normalized name: (name, version spec)}``.

    Options (``-r``, ``-e``, ``--index-url``), URLs and ``pkg @ url`` lines are
    skipped: only plain names with an optional version are honoured, so the
    file cannot point pip anywhere else.
    """
    wanted: dict[str, tuple[str, str]] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].split(";", 1)[0].strip()
        if not line or line.startswith("-") or "://" in line or "@" in line:
            continue
        match = _REQUIREMENT_LINE.match(line)
        if not match:
            continue
        name, spec = match.group(1), match.group(2).replace(" ", "")
        try:
            SpecifierSet(spec)
        except InvalidSpecifier:
            spec = ""
        wanted[normalize(name)] = (name, spec)
    return wanted


def installed_version(module: str) -> str | None:
    """The version of the package that provides ``module``, when one does."""
    for dist in importlib.metadata.packages_distributions().get(module, []):
        try:
            return importlib.metadata.version(dist)
        except importlib.metadata.PackageNotFoundError:
            continue
    return None


def is_importable(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


@dataclass
class Install:
    module: str
    package: str
    spec: str = ""

    @property
    def requirement(self) -> str:
        return f"{self.package}{self.spec}"


@dataclass
class Plan:
    installs: list[Install] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    #: The versions the run trains with, for every library it imports.
    versions: dict[str, str] = field(default_factory=dict)


def plan(
    imports: set[str],
    requirements: dict[str, tuple[str, str]],
    local_names: set[str] = frozenset(),  # type: ignore[assignment]
    *,
    importable: Callable[[str], bool] = is_importable,
    version_of: Callable[[str], str | None] = installed_version,
) -> Plan:
    """What to install for ``imports``, and what to tell the person about it."""
    result = Plan()
    used: set[str] = set()
    for module in sorted(imports):
        if module in sys.stdlib_module_names or module in local_names:
            continue
        package = IMPORT_TO_PACKAGE.get(module, module)
        candidates = {normalize(module)} | ({normalize(package)} if package else set())
        listed = next((key for key in candidates if key in requirements), None)
        if listed:
            used.add(listed)

        if importable(module):
            version = version_of(module)
            if version:
                result.versions[module] = version
            spec = requirements[listed][1] if listed else ""
            if spec and version and not _satisfies(version, spec):
                result.notes.append(
                    f"{requirements[listed][0]}: requirements.txt asks for {spec}; "
                    f"trained with {version}, the version the platform has."
                )
            continue

        if listed:
            name, spec = requirements[listed]
            result.installs.append(Install(module, name, spec))
        elif package:
            result.installs.append(Install(module, package))
        else:
            result.notes.append(
                f"'{module}' is imported but there is no telling which package provides it; "
                "add it to requirements.txt if the run needs it."
            )

    ignored = sorted(requirements[key][0] for key in requirements if key not in used)
    if ignored:
        result.notes.append(
            "Not installed from requirements.txt because no cell imports them: " + ", ".join(ignored) + "."
        )
    return result


def _satisfies(version: str, spec: str) -> bool:
    try:
        return Version(version) in SpecifierSet(spec)
    except (InvalidVersion, InvalidSpecifier):
        return True


def install_target() -> str | None:
    """Where installs go, or None when automatic installs are off.

    Only on when ``PYTHONUSERBASE`` is set (it is in the compose services), so
    running the worker on a laptop never pip-installs into the laptop.
    """
    return os.environ.get("PYTHONUSERBASE") or None


def _notebook_site() -> str:
    """The site-packages that installs for notebooks go into.

    Worked out from ``PYTHONUSERBASE`` as it is now, not from the user site
    Python fixed when it started: the two agree in the containers, but where
    the platform's own packages were installed with ``pip --user`` (CI does
    this) the start-up user site holds them, and reading it would leave them
    out of the constraints and let pip change them.
    """
    base = install_target()
    if not base:
        return site.getusersitepackages()
    version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    return str(Path(base) / "lib" / version / "site-packages")


def _platform_constraints() -> str:
    """Every package the platform ships, pinned: what pip may not change."""
    user_site = _notebook_site()
    lines = []
    for dist in importlib.metadata.distributions():
        name = dist.metadata["Name"]
        location = str(dist.locate_file(""))
        if name and not location.startswith(user_site):
            lines.append(f"{name}=={dist.version}")
    return "\n".join(sorted(set(lines)))


@contextmanager
def _install_lock(base: str) -> Iterator[None]:
    """Two runs installing at once would trip over each other's files."""
    Path(base).mkdir(parents=True, exist_ok=True)
    with open(Path(base) / ".install.lock", "w") as handle:
        try:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX)
        except ImportError:  # Windows: no worker runs there, nothing to share
            pass
        yield


def _pip(requirements: list[str], constraints: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "pip", "install", "--user", "--no-input", "--disable-pip-version-check",
         "-c", constraints, *requirements],
        capture_output=True,
        text=True,
        timeout=900,
    )


class DependencyError(ValueError):
    """A library the notebook imports could not be installed."""


def install(
    the_plan: Plan,
    *,
    run_pip: Callable[[list[str], str], subprocess.CompletedProcess[str]] = _pip,
) -> list[str]:
    """Install what ``the_plan`` lists. Returns the lines to show the person.

    A version that cannot be had (it clashes with the platform's own packages,
    or does not exist) falls back to the newest one that fits, with a note. A
    package that cannot be installed at all stops the run: the notebook would
    fail on its import anyway, later and less clearly.
    """
    if not the_plan.installs:
        return []
    base = install_target()
    if base is None:
        missing = ", ".join(item.package for item in the_plan.installs)
        raise DependencyError(
            f"The notebook imports libraries this worker does not have ({missing}) "
            "and automatic installs are off here (PYTHONUSERBASE is not set)."
        )

    lines: list[str] = []
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
        handle.write(_platform_constraints())
        constraints = handle.name
    try:
        with _install_lock(base):
            for item in the_plan.installs:
                # Another run may have installed it while this one waited.
                importlib.invalidate_caches()
                if is_importable(item.module):
                    continue
                result = run_pip([item.requirement], constraints)
                if result.returncode != 0 and item.spec:
                    lines.append(
                        f"{item.package}{item.spec} from requirements.txt cannot be installed "
                        "alongside the platform's libraries; installed the newest version that fits."
                    )
                    result = run_pip([item.package], constraints)
                if result.returncode != 0:
                    tail = (result.stderr or result.stdout).strip().splitlines()[-3:]
                    raise DependencyError(
                        f"The notebook imports '{item.module}' but '{item.package}' could not be "
                        f"installed: {' '.join(tail)} If the package has another name, put that "
                        "name in a requirements.txt next to the notebook."
                    )
    finally:
        os.unlink(constraints)

    _refresh_path()
    for item in the_plan.installs:
        version = installed_version(item.module)
        if version:
            the_plan.versions[item.module] = version
        lines.append(f"Installed {item.package} {version or ''}".rstrip() + f" (imported as {item.module}).")
    return lines


def _refresh_path() -> None:
    """Make what was just installed importable in this process too."""
    user_site = site.getusersitepackages()
    if os.path.isdir(user_site) and user_site not in sys.path:
        site.addsitedir(user_site)
    importlib.invalidate_caches()


def model_environment(model_path: str) -> dict[str, str]:
    """``{package: version}`` for what loading the model imports.

    Loaded in a separate interpreter, so the worker's own modules do not count
    and nothing the model does on load stays in the worker. The notebook that
    wrote it already ran here, so loading it is no new trust.
    """
    script = (
        "import json, sys, joblib\n"
        "joblib.load(sys.argv[1])\n"
        "print(json.dumps(sorted({m.split('.')[0] for m in list(sys.modules)})))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script, model_path], capture_output=True, text=True, timeout=300
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or "").strip().splitlines()[-1:] or "could not load the model")
    modules = json.loads(result.stdout.strip().splitlines()[-1])
    packages: dict[str, str] = {}
    for module in modules:
        if module.startswith("_") or module in sys.stdlib_module_names or module == "joblib":
            continue
        for dist in importlib.metadata.packages_distributions().get(module, []):
            try:
                packages[dist] = importlib.metadata.version(dist)
            except importlib.metadata.PackageNotFoundError:
                pass
            break
    return packages
