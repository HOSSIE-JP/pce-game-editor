import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.join(SCRIPT_DIR, "validate-vn-project.mjs");
const ENGINE_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..", "..");

function createProject(messageText) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pce-vn-validator-test-"));
  const assetsDir = path.join(projectDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "pce-assets.json"), JSON.stringify({ version: 2, assets: [] }, null, 2));
  fs.writeFileSync(path.join(assetsDir, "pce-vn-scenes.json"), JSON.stringify({
    version: 2,
    settings: {
      messageSpeedFrames: 10,
      messageAdvanceMode: "button",
      messageAutoWaitFrames: 60,
    },
    startScene: "opening",
    scenes: [
      {
        id: "opening",
        fullScreenBg: false,
        nextSceneId: "",
        commands: [
          {
            type: "message",
            speaker: "A",
            text: messageText,
            textColor: "",
            voiceAssetId: "",
            mouthSlot: null,
          },
        ],
      },
    ],
  }, null, 2));
  return projectDir;
}

function runValidator(projectDir, media = "both") {
  return spawnSync(process.execPath, [
    VALIDATOR,
    projectDir,
    "--media",
    media,
    "--engine-root",
    ENGINE_ROOT,
  ], { encoding: "utf8" });
}

function removeProject(projectDir) {
  fs.rmSync(projectDir, { recursive: true, force: true });
}

test("accepts a minimal project for CD-ROM2 and HuCARD", () => {
  const projectDir = createProject("HELLO\nWORLD");
  try {
    const result = runValidator(projectDir);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[OK\] both validation passed/);
    assert.match(result.stdout, /CD-ROM2 scene packs/);
    assert.match(result.stdout, /HuCARD scene packs/);
  } finally {
    removeProject(projectDir);
  }
});

test("rejects a message line longer than 17 characters", () => {
  const projectDir = createProject("123456789012345678");
  try {
    const result = runValidator(projectDir, "cd");
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /maximum is 17/);
  } finally {
    removeProject(projectDir);
  }
});
