#!/usr/bin/env python3
"""Package a PCE VN episode script, event stills, and registration plan."""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError:  # Packaging still works without Pillow; dimensions are not checked.
    Image = None  # type: ignore[assignment]


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON {path}: {exc}") from exc


def asset_rows(plan: Any) -> list[dict[str, Any]]:
    if not isinstance(plan, dict):
        return []
    rows = plan.get("proposedAssets") or plan.get("assets") or []
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def resolve_still(stills_dir: Path, row: dict[str, Any]) -> Path:
    source = row.get("source")
    asset_id = row.get("id")
    candidates: list[Path] = []
    if isinstance(source, str) and source:
        candidates.append(stills_dir / Path(source).name)
        candidates.append(stills_dir / source)
    if isinstance(asset_id, str) and asset_id:
        candidates.append(stills_dir / f"{asset_id}.png")
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise SystemExit(f"still image not found for {asset_id!r}; searched under {stills_dir}")


def check_image(path: Path) -> None:
    if Image is None:
        return
    with Image.open(path) as image:
        if image.size != (224, 136):
            raise SystemExit(f"still must be 224x136: {path} is {image.size}")
        if image.format != "PNG":
            raise SystemExit(f"still must be PNG: {path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=Path, required=True)
    parser.add_argument("--stills", type=Path, required=True, help="event still directory")
    parser.add_argument("--registration-plan", type=Path, required=True)
    parser.add_argument("--validation-report", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--root", default="episode-package", help="ZIP top-level folder")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    scenes = load_json(args.scenes)
    plan = load_json(args.registration_plan)
    if not isinstance(scenes, dict) or not isinstance(scenes.get("scenes"), list):
        raise SystemExit("scene JSON must contain scenes array")

    rows = asset_rows(plan)
    if not rows:
        raise SystemExit("registration plan has no proposedAssets")

    still_files: list[tuple[Path, str]] = []
    for row in rows:
        if row.get("type") != "image" or row.get("kind") != "background":
            raise SystemExit(f"planned still must be image/background: {row.get('id')}")
        source = row.get("source")
        if not isinstance(source, str) or not source.startswith("assets/images/"):
            raise SystemExit(f"planned still source must be assets/images/...: {row.get('id')}")
        still = resolve_still(args.stills, row)
        check_image(still)
        still_files.append((still, source))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    root = args.root.strip("/")
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(args.scenes, f"{root}/assets/pce-vn-scenes.json")
        archive.write(args.registration_plan, f"{root}/docs/event-still-registration-plan.json")
        for still, source in still_files:
            archive.write(still, f"{root}/{source}")
        if args.validation_report:
            if not args.validation_report.exists():
                raise SystemExit(f"validation report not found: {args.validation_report}")
            archive.write(args.validation_report, f"{root}/docs/validation-report.json")

    print(
        json.dumps(
            {
                "ok": True,
                "output": str(args.output),
                "sceneFile": str(args.scenes),
                "stillCount": len(still_files),
                "topLevelFolder": root,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
