from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


class SkillScriptTests(unittest.TestCase):
    def test_validator_accepts_episode_02_example(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "validate_pce_vn.py"),
                "--scenes",
                str(ROOT / "examples/episode-02/pce-vn-scenes.json"),
                "--assets",
                str(ROOT / "tests/fixtures/minimal-pce-assets.json"),
                "--episode",
                "2",
                "--strict",
                "--json",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["ok"])
        self.assertEqual(report["stats"]["episodeMessageCount"], 248)
        self.assertEqual(report["stats"]["eventStillCount"], 4)

    def test_prepare_event_still(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            source = temp / "source.png"
            output = temp / "output.png"
            image = Image.new("RGB", (640, 360), "white")
            draw = ImageDraw.Draw(image)
            draw.rectangle((10, 10, 300, 340), fill=(32, 64, 160), outline="black", width=12)
            draw.ellipse((330, 40, 610, 330), fill=(80, 190, 30), outline="black", width=12)
            image.save(source)

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "prepare_event_stills.py"),
                    "--input",
                    str(source),
                    "--output",
                    str(output),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            converted = Image.open(output)
            pixels = converted.get_flattened_data() if hasattr(converted, "get_flattened_data") else converted.getdata()
            used = set(pixels)
            self.assertEqual(converted.size, (224, 136))
            self.assertEqual(converted.mode, "P")
            self.assertLessEqual(len(used), 15)
            self.assertNotIn(0, used)

    def test_integrate_event_still_replaces_visual_setup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            scenes_path = temp / "scenes.json"
            mapping_path = temp / "mapping.json"
            output_path = temp / "out.json"
            scenes_path.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "settings": {},
                        "startScene": "logo",
                        "scenes": [
                            {
                                "id": "ep02_01_test",
                                "name": "第02話/テスト",
                                "fullScreenBg": False,
                                "commands": [
                                    {"type": "audio", "kind": "psg", "action": "play", "assetId": "bgm", "channel": 0},
                                    {"type": "background", "assetId": "bg_clubroom_day", "transition": "fade", "fadeOutFrames": 30, "fadeInFrames": 30, "x": 2, "y": 1},
                                    {"type": "sprite", "slot": 0, "assetId": "sp_mu_01", "x": 30, "y": 16, "animationId": "default", "flipX": True, "flipY": False, "visible": True},
                                    {"type": "message", "speaker": "部長", "text": "テスト", "textColor": "", "voiceAssetId": "", "mouthSlot": 0},
                                ],
                                "nextSceneId": "",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            mapping_path.write_text(
                json.dumps(
                    {
                        "operations": [
                            {
                                "sceneId": "ep02_01_test",
                                "assetId": "ep02_001",
                                "mode": "replace-setup",
                                "hideSprites": [
                                    {"slot": 0, "assetId": "sp_mu_01", "x": 30, "y": 16, "animationId": "default", "flipX": True, "flipY": False}
                                ],
                                "background": {"x": 2, "y": 1},
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "integrate_event_stills.py"),
                    "--scenes",
                    str(scenes_path),
                    "--mapping",
                    str(mapping_path),
                    "--output",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            output = json.loads(output_path.read_text(encoding="utf-8"))
            commands = output["scenes"][0]["commands"]
            self.assertEqual(commands[0]["type"], "audio")
            self.assertFalse(commands[1]["visible"])
            self.assertEqual(commands[2]["assetId"], "ep02_001")
            self.assertEqual(commands[3]["type"], "message")


if __name__ == "__main__":
    unittest.main()
