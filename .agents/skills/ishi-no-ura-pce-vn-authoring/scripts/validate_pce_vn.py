#!/usr/bin/env python3
"""Validate an 'いしのうらにいる！？' PCE VN scene JSON.

The byte check is a conservative UTF-8 JSON estimate, not a substitute for the
editor's scene-budget display or an actual HuCARD build.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Iterable

ALLOWED_SPEAKERS = {"", "部長", "チカ", "レン"}
MOUTH_SLOTS = {"": None, "部長": 0, "チカ": 1, "レン": 2}
ALLOWED_EPISODE_COMMANDS = {
    "background",
    "sprite",
    "spritemove",
    "message",
    "audio",
    "choice",
    "jump",
    "wait",
    "effect",
}
SYSTEM_SCENES = {"logo", "title", "eye_catch"}
PCE_LEVELS = {0, 36, 73, 109, 146, 182, 219, 255}


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    location: str = ""


class Report:
    def __init__(self) -> None:
        self.findings: list[Finding] = []
        self.stats: dict[str, Any] = {}

    def error(self, code: str, message: str, location: str = "") -> None:
        self.findings.append(Finding("error", code, message, location))

    def warning(self, code: str, message: str, location: str = "") -> None:
        self.findings.append(Finding("warning", code, message, location))

    def info(self, code: str, message: str, location: str = "") -> None:
        self.findings.append(Finding("info", code, message, location))

    @property
    def errors(self) -> list[Finding]:
        return [item for item in self.findings if item.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [item for item in self.findings if item.severity == "warning"]


def load_json(path: Path, report: Report, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        report.error("file_missing", f"{label}が見つかりません: {path}")
    except json.JSONDecodeError as exc:
        report.error(
            "json_parse",
            f"{label}をJSONとして解析できません: {exc.msg} (line {exc.lineno}, column {exc.colno})",
            str(path),
        )
    return None


def find_planned_assets(data: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(data, dict):
        return {}
    rows = data.get("proposedAssets") or data.get("assets") or []
    result: dict[str, dict[str, Any]] = {}
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and isinstance(row.get("id"), str):
                result[row["id"]] = row
    return result


def iter_asset_ids(command: dict[str, Any]) -> Iterable[tuple[str, str]]:
    command_type = command.get("type")
    asset_id = command.get("assetId")
    if not isinstance(asset_id, str) or not asset_id:
        return
    if command_type == "background":
        yield asset_id, "image"
    elif command_type == "sprite":
        yield asset_id, "sprite"
    elif command_type == "audio" and command.get("action") == "play":
        kind = command.get("kind")
        expected = {
            "psg": "psg",
            "cdda": "cdda-track",
            "adpcm": "adpcm",
        }.get(kind, "audio")
        yield asset_id, expected


def is_allowed_jis_character(ch: str) -> tuple[bool, str]:
    if ch in "\n\r\t":
        return True, "control"
    code = ord(ch)
    if 0x20 <= code <= 0x7E:
        return True, "ascii"
    if 0xFF61 <= code <= 0xFF9F:
        return False, "halfwidth-kana"
    try:
        encoded = ch.encode("euc_jp")
    except UnicodeEncodeError:
        return False, "not-euc-jp"
    if len(encoded) == 1:
        return True, "single-byte"
    if len(encoded) == 2 and all(0xA1 <= b <= 0xFE for b in encoded):
        ku = encoded[0] - 0xA0
        # JIS X 0208 non-kanji rows and first-level kanji rows are accepted.
        if 1 <= ku <= 47:
            return True, f"jis-row-{ku}"
        return False, f"jis-second-level-row-{ku}"
    # Three-byte EUC-JP generally indicates JIS X 0212 or another unsupported set.
    return False, "unsupported-jis-set"


def validate_text_charset(text: str, report: Report, location: str) -> None:
    for index, ch in enumerate(text):
        ok, reason = is_allowed_jis_character(ch)
        if not ok:
            report.error(
                "charset",
                f"使用不可文字 U+{ord(ch):04X} {ch!r} ({reason})",
                f"{location}:char[{index}]",
            )


def build_graph(scenes: list[dict[str, Any]]) -> dict[str, set[str]]:
    graph: dict[str, set[str]] = defaultdict(set)
    for scene in scenes:
        sid = scene.get("id")
        if not isinstance(sid, str):
            continue
        next_scene = scene.get("nextSceneId")
        if isinstance(next_scene, str) and next_scene:
            graph[sid].add(next_scene)
        for command in scene.get("commands", []):
            if not isinstance(command, dict):
                continue
            if command.get("type") == "jump":
                target = command.get("sceneId")
                if isinstance(target, str) and target:
                    graph[sid].add(target)
            elif command.get("type") == "choice":
                for choice in command.get("choices", []):
                    if isinstance(choice, dict):
                        target = choice.get("targetSceneId")
                        if isinstance(target, str) and target:
                            graph[sid].add(target)
        graph.setdefault(sid, set())
    return graph


def reachable(graph: dict[str, set[str]], start: str, blocked: set[str] | None = None) -> set[str]:
    blocked = blocked or set()
    if start in blocked:
        return set()
    seen: set[str] = set()
    queue: deque[str] = deque([start])
    while queue:
        node = queue.popleft()
        if node in seen or node in blocked:
            continue
        seen.add(node)
        for target in graph.get(node, set()):
            if target not in seen and target not in blocked:
                queue.append(target)
    return seen


def find_episode_start(title_scene: dict[str, Any], episode_prefix: str) -> str | None:
    commands = title_scene.get("commands", [])
    after_game_start = False
    candidates: list[str] = []
    for command in commands:
        if not isinstance(command, dict):
            continue
        if command.get("type") == "label" and command.get("name") == "GAME_START":
            after_game_start = True
            continue
        if command.get("type") == "jump":
            target = command.get("sceneId")
            if isinstance(target, str):
                if after_game_start and target.startswith(episode_prefix):
                    return target
                if target.startswith(episode_prefix):
                    candidates.append(target)
    return candidates[0] if candidates else None


def check_asset_type(actual: str, expected: str) -> bool:
    if expected == "psg":
        return actual in {"psg-song", "psg-sfx"}
    if expected == "audio":
        return actual in {"psg-song", "psg-sfx", "cdda-track", "adpcm"}
    return actual == expected


def scene_json_size(scene: dict[str, Any]) -> int:
    return len(json.dumps(scene, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def validate(args: argparse.Namespace) -> Report:
    report = Report()
    scenes_doc = load_json(args.scenes, report, "scene JSON")
    assets_doc = load_json(args.assets, report, "asset JSON") if args.assets else None
    planned_doc = load_json(args.planned_assets, report, "planned asset JSON") if args.planned_assets else None
    if scenes_doc is None:
        return report

    if not isinstance(scenes_doc, dict):
        report.error("document_type", "scene JSONのトップレベルはobjectである必要があります")
        return report

    version = scenes_doc.get("version")
    if version != 2:
        report.error("version", f"versionは2である必要があります: {version!r}")

    scenes = scenes_doc.get("scenes")
    if not isinstance(scenes, list):
        report.error("scenes_type", "scenesはarrayである必要があります")
        return report

    ids = [scene.get("id") for scene in scenes if isinstance(scene, dict)]
    string_ids = [sid for sid in ids if isinstance(sid, str)]
    counts = Counter(string_ids)
    for sid, count in counts.items():
        if count > 1:
            report.error("duplicate_scene", f"scene IDが重複しています: {sid} ({count}件)")

    scene_by_id = {scene.get("id"): scene for scene in scenes if isinstance(scene, dict) and isinstance(scene.get("id"), str)}
    start_scene = scenes_doc.get("startScene")
    if not isinstance(start_scene, str) or start_scene not in scene_by_id:
        report.error("start_scene", f"startSceneが実在sceneを指していません: {start_scene!r}")
    if args.strict and start_scene != "logo":
        report.error("start_scene_logo", f"startSceneはlogoを維持してください: {start_scene!r}")

    for system_id in SYSTEM_SCENES:
        if system_id not in scene_by_id:
            report.error("system_scene", f"必須system sceneがありません: {system_id}")

    episode_num = int(args.episode)
    episode_prefix = f"ep{episode_num:02d}_"
    episode_name_prefix = f"第{episode_num:02d}話/"
    episode_scenes = [scene for scene in scenes if isinstance(scene, dict) and str(scene.get("id", "")).startswith(episode_prefix)]
    if not episode_scenes:
        report.error("episode_scenes", f"{episode_prefix}形式のsceneがありません")

    for scene in episode_scenes:
        sid = str(scene.get("id"))
        name = scene.get("name")
        if not isinstance(name, str) or not name.startswith(episode_name_prefix):
            report.error("scene_name", f"scene nameは{episode_name_prefix}で始めてください: {name!r}", sid)

    old_episode_pattern = re.compile(r"^ep(?!%02d)\d{2}_" % episode_num)
    for sid in string_ids:
        if old_episode_pattern.match(sid):
            report.warning("other_episode_scene", f"別話数sceneが残っています: {sid}")

    title_scene = scene_by_id.get("title", {})
    episode_start = args.episode_start or find_episode_start(title_scene, episode_prefix)
    if not episode_start:
        report.error("game_start_jump", "titleのGAME_START後に新話冒頭へのjumpが見つかりません", "title")
    elif episode_start not in scene_by_id:
        report.error("game_start_target", f"ゲーム開始先が存在しません: {episode_start}", "title")

    assets_by_id: dict[str, dict[str, Any]] = {}
    if assets_doc is not None:
        if not isinstance(assets_doc, dict) or not isinstance(assets_doc.get("assets"), list):
            report.error("assets_type", "pce-assets.jsonはassets arrayを持つ必要があります")
        else:
            for asset in assets_doc["assets"]:
                if isinstance(asset, dict) and isinstance(asset.get("id"), str):
                    assets_by_id[asset["id"]] = asset
    planned_assets = find_planned_assets(planned_doc)

    message_count = 0
    choice_count = 0
    choice_targets: list[tuple[str, str]] = []
    still_scenes: dict[str, set[str]] = defaultdict(set)
    referenced_assets: Counter[str] = Counter()
    max_scene_size = 0
    max_scene_id = ""

    all_targets: list[tuple[str, str, str]] = []

    for scene in scenes:
        if not isinstance(scene, dict):
            report.error("scene_type", "scenes内の要素はobjectである必要があります")
            continue
        sid = scene.get("id")
        if not isinstance(sid, str) or not sid:
            report.error("scene_id", "scene IDが空または文字列ではありません")
            continue
        commands = scene.get("commands")
        if not isinstance(commands, list):
            report.error("commands_type", "commandsはarrayである必要があります", sid)
            continue

        size = scene_json_size(scene)
        if size > max_scene_size:
            max_scene_size = size
            max_scene_id = sid
        if size > args.max_scene_bytes:
            severity = report.error if args.strict else report.warning
            severity(
                "scene_bytes",
                f"sceneのUTF-8 JSON概算が{args.max_scene_bytes} bytesを超えています: {size} bytes",
                sid,
            )

        next_scene = scene.get("nextSceneId")
        if isinstance(next_scene, str) and next_scene:
            all_targets.append((sid, "nextSceneId", next_scene))

        last_command = commands[-1] if commands else None
        if isinstance(next_scene, str) and next_scene and isinstance(last_command, dict) and last_command.get("type") == "jump":
            report.error("duplicate_transition", "nextSceneIdと末尾jumpを重複させないでください", sid)

        is_episode = sid.startswith(episode_prefix)
        if is_episode:
            for index, command in enumerate(commands):
                if isinstance(command, dict) and command.get("type") not in ALLOWED_EPISODE_COMMANDS:
                    report.error(
                        "episode_command",
                        f"新話sceneで未許可commandを使用しています: {command.get('type')!r}",
                        f"{sid}.commands[{index}]",
                    )

        for index, command in enumerate(commands):
            location = f"{sid}.commands[{index}]"
            if not isinstance(command, dict):
                report.error("command_type", "commandはobjectである必要があります", location)
                continue
            command_type = command.get("type")

            if command_type == "jump":
                target = command.get("sceneId")
                if isinstance(target, str) and target:
                    all_targets.append((sid, "jump", target))
                else:
                    report.error("jump_target", "jump.sceneIdが空です", location)

            elif command_type == "choice":
                choice_count += 1
                choices = command.get("choices")
                if not isinstance(choices, list):
                    report.error("choice_type", "choice.choicesはarrayである必要があります", location)
                    continue
                if len(choices) != 2:
                    report.error("choice_count", f"このシリーズのchoiceは2択です: {len(choices)}択", location)
                for choice_index, choice in enumerate(choices):
                    choice_location = f"{location}.choices[{choice_index}]"
                    if not isinstance(choice, dict):
                        report.error("choice_item", "choice項目はobjectである必要があります", choice_location)
                        continue
                    label = choice.get("label")
                    if not isinstance(label, str) or not label:
                        report.error("choice_label", "choice labelが空です", choice_location)
                    elif len(label) > 24:
                        report.error("choice_label_length", f"choice labelが24文字を超えています: {len(label)}", choice_location)
                    else:
                        validate_text_charset(label, report, choice_location + ".label")
                    target = choice.get("targetSceneId")
                    if isinstance(target, str) and target:
                        all_targets.append((sid, "choice", target))
                        choice_targets.append((sid, target))
                    else:
                        report.error("choice_target", "targetSceneIdが空です", choice_location)

            elif command_type == "message":
                if is_episode:
                    message_count += 1
                speaker = command.get("speaker")
                text = command.get("text")
                mouth_slot = command.get("mouthSlot")
                voice_asset = command.get("voiceAssetId")

                if speaker not in ALLOWED_SPEAKERS:
                    report.error("speaker", f"未許可話者名です: {speaker!r}", location)
                if isinstance(speaker, str) and speaker in MOUTH_SLOTS:
                    expected_slot = MOUTH_SLOTS[speaker]
                    if mouth_slot != expected_slot:
                        report.error(
                            "mouth_slot",
                            f"{speaker or 'ナレーション'}のmouthSlotは{expected_slot!r}です: {mouth_slot!r}",
                            location,
                        )
                if not isinstance(text, str):
                    report.error("message_text", "message.textは文字列である必要があります", location)
                else:
                    lines = text.split("\n")
                    max_lines = 4 if speaker == "" else 3
                    if len(lines) > max_lines:
                        report.error("message_lines", f"本文が{max_lines}行を超えています: {len(lines)}行", location)
                    for line_index, line in enumerate(lines):
                        if len(line) > 17:
                            report.error(
                                "line_length",
                                f"1行17文字を超えています: {len(line)}文字 / {line!r}",
                                f"{location}.text.line[{line_index}]",
                            )
                    if len(text) > 96:
                        report.error("message_length", f"message.textが96文字を超えています: {len(text)}", location)
                    validate_text_charset(text, report, location + ".text")
                if is_episode and voice_asset != "":
                    report.error("voice_asset", f"新話messageのvoiceAssetIdは空文字です: {voice_asset!r}", location)
                if isinstance(speaker, str):
                    validate_text_charset(speaker, report, location + ".speaker")

            for asset_id, expected_type in iter_asset_ids(command):
                referenced_assets[asset_id] += 1
                if re.fullmatch(rf"ep{episode_num:02d}_\d{{3}}", asset_id) and command_type == "background":
                    still_scenes[asset_id].add(sid)
                if assets_by_id:
                    asset = assets_by_id.get(asset_id)
                    if asset is None:
                        if asset_id in planned_assets:
                            report.warning("planned_asset", f"未登録だが計画済みassetを参照しています: {asset_id}", location)
                        else:
                            report.error("asset_missing", f"pce-assets.jsonに存在しないassetIdです: {asset_id}", location)
                    else:
                        actual_type = asset.get("type")
                        if not isinstance(actual_type, str) or not check_asset_type(actual_type, expected_type):
                            report.error(
                                "asset_type",
                                f"asset typeがcommandと一致しません: {asset_id} / expected={expected_type}, actual={actual_type}",
                                location,
                            )
                        if command_type == "background":
                            options = asset.get("options", {}) if isinstance(asset.get("options"), dict) else {}
                            if options.get("kind") != "background":
                                report.error("background_kind", f"background assetのkindがbackgroundではありません: {asset_id}", location)
                            if re.fullmatch(rf"ep{episode_num:02d}_\d{{3}}", asset_id):
                                if options.get("width") != 224 or options.get("height") != 136:
                                    report.error(
                                        "still_size",
                                        f"イベントスチルは224x136登録が必要です: {asset_id} ({options.get('width')}x{options.get('height')})",
                                        location,
                                    )

    for source, edge_type, target in all_targets:
        if target not in scene_by_id:
            report.error("transition_target", f"{edge_type}先が存在しません: {target}", source)

    if choice_count != 2:
        report.error("total_choices", f"choiceは合計2回必要です: {choice_count}回")
    if not 220 <= message_count <= 280:
        severity = report.error if args.strict else report.warning
        severity("message_count", f"episode messageは220〜280が目安です: {message_count}")

    graph = build_graph(scenes)
    if episode_start and episode_start in graph:
        episode_reachable = reachable(graph, episode_start)
        if "eye_catch" not in episode_reachable:
            report.error("ending_reachability", f"{episode_start}からeye_catchへ到達できません")
        for source, target in choice_targets:
            if target in graph and "eye_catch" not in reachable(graph, target):
                report.error("branch_reachability", f"choice分岐先からeye_catchへ到達できません: {target}", source)

        if len(still_scenes) < 3:
            report.error("still_count", f"話数固有イベントスチルを最低3枚使用してください: {len(still_scenes)}枚")
        for still_id, containing_scenes in sorted(still_scenes.items()):
            if not containing_scenes & episode_reachable:
                report.error("still_unreachable", f"イベントスチルsceneが新話冒頭から到達不能です: {still_id}")
                continue
            # A mandatory still should lie on every route from episode start to eye_catch.
            without_still = reachable(graph, episode_start, blocked=set(containing_scenes))
            if "eye_catch" in without_still:
                report.error(
                    "still_skippable",
                    f"イベントスチルを通らずeye_catchへ到達する経路があります: {still_id}",
                    ",".join(sorted(containing_scenes)),
                )
    else:
        report.warning("graph_skipped", "episode startを特定できないため到達性検査を省略しました")

    report.stats = {
        "version": version,
        "sceneCount": len(scenes),
        "episodeSceneCount": len(episode_scenes),
        "episodeMessageCount": message_count,
        "choiceCount": choice_count,
        "eventStillCount": len(still_scenes),
        "eventStills": {key: sorted(value) for key, value in sorted(still_scenes.items())},
        "episodeStart": episode_start,
        "maxSceneUtf8JsonBytes": max_scene_size,
        "maxSceneId": max_scene_id,
        "referencedAssetCount": len(referenced_assets),
        "errors": len(report.errors),
        "warnings": len(report.warnings),
    }
    return report


def print_report(report: Report, as_json: bool) -> None:
    if as_json:
        print(
            json.dumps(
                {
                    "ok": not report.errors,
                    "stats": report.stats,
                    "findings": [asdict(item) for item in report.findings],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    print("PCE VN validation")
    print(json.dumps(report.stats, ensure_ascii=False, indent=2))
    if not report.findings:
        print("OK: findingsなし")
        return
    order = {"error": 0, "warning": 1, "info": 2}
    for item in sorted(report.findings, key=lambda x: (order.get(x.severity, 9), x.code, x.location)):
        location = f" [{item.location}]" if item.location else ""
        print(f"{item.severity.upper()}: {item.code}{location}: {item.message}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=Path, required=True, help="pce-vn-scenes.json")
    parser.add_argument("--assets", type=Path, help="pce-assets.json")
    parser.add_argument("--planned-assets", type=Path, help="登録前イベントスチル計画JSON")
    parser.add_argument("--episode", type=int, required=True, help="話数。例: 2")
    parser.add_argument("--episode-start", help="titleから判定できない場合の新話冒頭scene ID")
    parser.add_argument("--max-scene-bytes", type=int, default=4096)
    parser.add_argument("--strict", action="store_true", help="message数とscene概算超過をerrorにする")
    parser.add_argument("--json", action="store_true", help="JSONレポートを出力")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    report = validate(args)
    print_report(report, args.json)
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
