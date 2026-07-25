#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run(
    [sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "tests"), "-v"],
    cwd=ROOT,
    check=False,
)
raise SystemExit(result.returncode)
