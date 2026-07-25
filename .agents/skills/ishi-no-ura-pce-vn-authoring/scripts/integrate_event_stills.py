#!/usr/bin/env python3
"""Insert event-still setup commands into selected PCE VN scenes.

The mapping is intentionally explicit: it names the scene, still asset, and the
sprite assets to hide. Use a dedicated scene when the still belongs in the
middle of a longer scene; this script operates at scene setup boundaries.
"""

from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

SETUP_TYPES = {"background", "sprite", "spritemove"}
CONTENT_TYPES = {"message", "choice", "jump", "wait", "effect"}


def load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON {path}: {exc}") from exc


def hidden_sprite_command(spec: dict[str, Any]) -> dict[str, Any]:
    required = ("slot", "assetId", "x", "y")
    missing = [key for key in required if key not in spec]
    if missing:
        raise ValueError(f"hideSprites entry is missing: {', '.join(missing)}")
    return {
        "type": "sprite",
        "slot": spec["slot"],
        "assetId": spec["assetId"],
        "x": spec["x"],
        "y": spec["y"],
        "animationId": spec.get("animationId", "default"),
        "flipX": bool(spec.get("flipX", False)),
        "flipY": bool(spec.get("flipY", False)),
        "visible": False,
    }


def background_command(asset_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "background",
        "assetId": asset_id,
        "transition": spec.get("transition", "fade"),
        "fadeOutFrames": int(spec.get("fadeOutFrames", 30)),
        "fadeInFrames": int(spec.get("fadeInFrames", 30)),
        "x": int(spec.get("x", 2)),
        "y": int(spec.get("y", 1)),
    }


def replace_setup(commands: list[dict[str, Any]], setup: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Keep leading audio commands, remove visual setup commands before the first
    # narrative/content command, then place the still setup at that boundary.
    prefix: list[dict[str, Any]] = []
    remainder_start = 0
    for index, command in enumerate(commands):
        command_type = command.get("type")
        if command_type in CONTENT_TYPES:
            remainder_start = index
            break
        if command_type not in SETUP_TYPES:
            prefix.append(command)
        remainder_start = index + 1
    return prefix + setup + commands[remainder_start:]


def apply_operation(scene: dict[str, Any], operation: dict[str, Any], force: bool) -> None:
    asset_id = operation.get("assetId")
    if not isinstance(asset_id, str) or not asset_id:
        raise ValueError("operation.assetId is required")
    commands = scene.get("commands")
    if not isinstance(commands, list):
        raise ValueError(f"scene {scene.get('id')} has no commands array")

    already_present = any(
        isinstance(command, dict)
        and command.get("type") == "background"
        and command.get("assetId") == asset_id
        for command in commands
    )
    if already_present and not force:
        raise ValueError(f"scene {scene.get('id')} already uses {asset_id}; pass --force to reapply")

    hide_specs = operation.get("hideSprites", [])
    if not isinstance(hide_specs, list):
        raise ValueError("hideSprites must be an array")
    setup = [hidden_sprite_command(spec) for spec in hide_specs if isinstance(spec, dict)]
    background_spec = operation.get("background", {})
    if not isinstance(background_spec, dict):
        raise ValueError("background must be an object")
    setup.append(background_command(asset_id, background_spec))

    mode = operation.get("mode", "replace-setup")
    if mode == "prepend":
        scene["commands"] = setup + commands
    elif mode == "replace-setup":
        scene["commands"] = replace_setup(commands, setup)
    elif mode == "replace-first-background":
        replaced = False
        new_commands: list[dict[str, Any]] = []
        for command in commands:
            if not replaced and isinstance(command, dict) and command.get("type") == "background":
                new_commands.extend(setup)
                replaced = True
            else:
                new_commands.append(command)
        if not replaced:
            new_commands = setup + new_commands
        scene["commands"] = new_commands
    else:
        raise ValueError(f"unknown mode: {mode}")

    scene_name = operation.get("sceneName")
    if isinstance(scene_name, str) and scene_name:
        scene["name"] = scene_name


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    document = load(args.scenes)
    mapping = load(args.mapping)
    if not isinstance(document, dict) or not isinstance(document.get("scenes"), list):
        raise SystemExit("scene JSON must contain scenes array")
    if not isinstance(mapping, dict) or not isinstance(mapping.get("operations"), list):
        raise SystemExit("mapping JSON must contain operations array")

    result = deepcopy(document)
    scene_by_id = {
        scene.get("id"): scene
        for scene in result["scenes"]
        if isinstance(scene, dict) and isinstance(scene.get("id"), str)
    }

    applied: list[dict[str, str]] = []
    for index, operation in enumerate(mapping["operations"]):
        if not isinstance(operation, dict):
            raise SystemExit(f"operations[{index}] must be an object")
        scene_id = operation.get("sceneId")
        if not isinstance(scene_id, str) or scene_id not in scene_by_id:
            raise SystemExit(f"operations[{index}] scene does not exist: {scene_id!r}")
        try:
            apply_operation(scene_by_id[scene_id], operation, args.force)
        except ValueError as exc:
            raise SystemExit(f"operations[{index}] {scene_id}: {exc}") from exc
        applied.append({"sceneId": scene_id, "assetId": str(operation.get("assetId"))})

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "output": str(args.output), "applied": applied}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
