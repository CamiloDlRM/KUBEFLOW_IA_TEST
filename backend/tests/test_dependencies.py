"""What a notebook needs installed: its imports decide, requirements.txt gives versions."""
from __future__ import annotations

import subprocess

import pytest

from core import dependencies
from core.dependencies import DependencyError, Install, Plan, notebook_imports, parse_requirements, plan


def _nb(*sources, tags=()):
    return {"cells": [{"cell_type": "code", "metadata": {"tags": list(tags)}, "source": s} for s in sources]}


def _plan(imports, requirements_text="", have=None, local=frozenset()):
    have = have or {}
    return plan(
        set(imports),
        parse_requirements(requirements_text),
        set(local),
        importable=lambda module: module in have,
        version_of=lambda module: have.get(module),
    )


class TestNotebookImports:
    def test_reads_import_and_from_lines_to_their_top_level(self):
        nb = _nb("import xgboost as xgb\nimport os.path\n", "from sklearn.model_selection import train_test_split\n")
        assert notebook_imports(nb) == {"xgboost", "os", "sklearn"}

    def test_relative_imports_and_future_are_not_packages(self):
        assert notebook_imports(_nb("from __future__ import annotations\nfrom . import helpers\n")) == set()

    def test_jupyter_lines_do_not_hide_the_imports(self):
        assert notebook_imports(_nb("!pip install lightgbm\n%matplotlib inline\nimport lightgbm\n")) == {"lightgbm"}

    def test_a_cell_that_is_not_python_still_gives_its_imports(self):
        assert notebook_imports(_nb("import catboost\nthis is not python (\n")) == {"catboost"}

    def test_papermills_injected_cell_is_left_out(self):
        assert notebook_imports(_nb("import injected_thing\n", tags=("injected-parameters",))) == set()


class TestParseRequirements:
    def test_names_and_versions(self):
        parsed = parse_requirements("xgboost==2.1.0\nscikit_learn>=1.4  # comment\n\nlightgbm\n")
        assert parsed == {
            "xgboost": ("xgboost", "==2.1.0"),
            "scikit-learn": ("scikit_learn", ">=1.4"),
            "lightgbm": ("lightgbm", ""),
        }

    def test_options_urls_and_direct_references_are_never_honoured(self):
        text = "-r other.txt\n--index-url https://evil.example/simple\n-e git+https://x/y\nfoo @ https://x/foo.whl\n"
        assert parse_requirements(text) == {}

    def test_markers_and_extras_are_dropped(self):
        assert parse_requirements('shap[plots]==0.46 ; python_version>"3"\n') == {"shap": ("shap", "==0.46")}


class TestPlan:
    def test_without_requirements_installs_what_is_missing_at_its_newest(self):
        result = _plan({"xgboost", "pandas", "json"}, have={"pandas": "2.2.3"})
        assert [i.requirement for i in result.installs] == ["xgboost"]
        assert result.versions == {"pandas": "2.2.3"}

    def test_requirements_give_the_version_of_what_is_imported(self):
        result = _plan({"xgboost"}, "xgboost==2.1.0\n")
        assert [i.requirement for i in result.installs] == ["xgboost==2.1.0"]

    def test_a_listed_package_nobody_imports_is_ignored_and_said(self):
        result = _plan({"xgboost"}, "xgboost\nrequests-malicioso==1.0\n")
        assert [i.package for i in result.installs] == ["xgboost"]
        assert any("requests-malicioso" in note for note in result.notes)

    def test_the_platforms_version_wins_with_a_note(self):
        result = _plan({"sklearn"}, "scikit-learn==1.3.0\n", have={"sklearn": "1.5.2"})
        assert result.installs == []
        assert result.notes == [
            "scikit-learn: requirements.txt asks for ==1.3.0; trained with 1.5.2, the version the platform has."
        ]

    def test_a_version_the_platform_satisfies_gets_no_note(self):
        assert _plan({"sklearn"}, "scikit-learn>=1.4\n", have={"sklearn": "1.5.2"}).notes == []

    def test_import_names_map_to_their_package(self):
        result = _plan({"cv2", "PIL", "yaml"})
        assert sorted(i.package for i in result.installs) == ["Pillow", "PyYAML", "opencv-python-headless"]

    def test_the_file_may_name_the_package_an_import_comes_from(self):
        result = _plan({"sklearn"}, "scikit-learn==1.5.2\n")
        assert [i.requirement for i in result.installs] == ["scikit-learn==1.5.2"]

    def test_the_repositorys_own_modules_are_not_installed(self):
        assert _plan({"helpers", "xgboost"}, local={"helpers"}).installs == [Install("xgboost", "xgboost")]

    def test_an_ambiguous_import_is_not_guessed(self):
        result = _plan({"google"})
        assert result.installs == []
        assert "google" in result.notes[0]


def _done(code=0, err=""):
    return subprocess.CompletedProcess([], code, stdout="", stderr=err)


class TestInstall:
    def test_nothing_to_install_does_nothing(self, monkeypatch):
        monkeypatch.delenv("PYTHONUSERBASE", raising=False)
        assert dependencies.install(Plan()) == []

    def test_installs_are_off_without_the_shared_volume(self, monkeypatch):
        monkeypatch.delenv("PYTHONUSERBASE", raising=False)
        with pytest.raises(DependencyError, match="automatic installs are off"):
            dependencies.install(Plan(installs=[Install("xgboost", "xgboost")]))

    def test_a_version_that_cannot_be_had_falls_back_to_the_newest_that_fits(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PYTHONUSERBASE", str(tmp_path))
        calls = []

        def run_pip(requirements, constraints):
            calls.append(requirements)
            return _done(1, "conflict") if "==" in requirements[0] else _done()

        lines = dependencies.install(Plan(installs=[Install("zzz_not_here", "zzz-pkg", "==9.9")]), run_pip=run_pip)
        assert calls == [["zzz-pkg==9.9"], ["zzz-pkg"]]
        assert "cannot be installed alongside" in lines[0]

    def test_a_package_that_cannot_be_installed_stops_the_run_and_says_which(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PYTHONUSERBASE", str(tmp_path))
        with pytest.raises(DependencyError, match="imports 'zzz_not_here'"):
            dependencies.install(
                Plan(installs=[Install("zzz_not_here", "zzz-pkg")]),
                run_pip=lambda r, c: _done(1, "ERROR: No matching distribution found for zzz-pkg"),
            )

    def test_never_lets_pip_change_the_platforms_packages(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PYTHONUSERBASE", str(tmp_path))
        seen = {}

        def run_pip(requirements, constraints):
            with open(constraints) as handle:
                seen["constraints"] = handle.read()
            return _done()

        dependencies.install(Plan(installs=[Install("zzz_not_here", "zzz-pkg")]), run_pip=run_pip)
        assert "pytest==" in seen["constraints"]
