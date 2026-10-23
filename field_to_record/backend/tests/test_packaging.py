import os, shutil, subprocess, sys
from pathlib import Path


def test_application_imports_in_container_directory_layout(tmp_path):
    root = Path(__file__).resolve().parents[2]
    shutil.copytree(
        root / "backend/app",
        tmp_path / "app",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    shutil.copytree(root / "data/lexicons", tmp_path / "data/lexicons")
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.extraction import DRUGS; from app.main import app; assert len(DRUGS)>=100; print(app.version)",
        ],
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": str(tmp_path)},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "2.0.0" in result.stdout
