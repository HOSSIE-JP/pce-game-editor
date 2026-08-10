#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALID_MEDIA = new Set(["cd", "hucard", "both"]);

function usage() {
  console.log([
    "Usage:",
    "  node validate-vn-project.mjs <project-directory> [--media cd|hucard|both] [--engine-root <pce-game-editor>]",
    "",
    "The validator never writes the supplied project. CD uses inspectionOnly; HuCARD is generated in a temporary assets copy.",
  ].join("\n"));
}

function parseArgs(argv) {
  const options = { projectDir: "", media: "both", engineRoot: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { ...options, help: true };
    if (arg === "--media") {
      options.media = String(argv[index + 1] || "").toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--engine-root") {
      options.engineRoot = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    if (options.projectDir) throw new Error(`Unexpected argument: ${arg}`);
    options.projectDir = arg;
  }
  if (!options.projectDir) throw new Error("A project directory is required");
  if (!VALID_MEDIA.has(options.media)) throw new Error(`Invalid --media value: ${options.media}`);
  return options;
}

function findEngineRoot(explicitRoot = "") {
  const starts = [explicitRoot, process.cwd(), SCRIPT_DIR].filter(Boolean).map((entry) => path.resolve(entry));
  for (const start of starts) {
    let current = start;
    while (true) {
      if (fs.existsSync(path.join(current, "pce-vn-manager.js"))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error("Could not find pce-vn-manager.js; pass --engine-root <pce-game-editor>");
}

function readJson(filePath) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function glyphLength(value) {
  return Array.from(String(value ?? "")).length;
}

function addDiagnostic(list, severity, scope, message, details = {}) {
  list.push({ severity, scope, message, ...details });
}

function validateAuthoringRules(doc) {
  const diagnostics = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    addDiagnostic(diagnostics, "error", "authoring", "Scene document must be a JSON object");
    return diagnostics;
  }
  if (doc.version !== 2) addDiagnostic(diagnostics, "error", "authoring", `version must be 2; got ${JSON.stringify(doc.version)}`);
  if (!Array.isArray(doc.scenes) || doc.scenes.length === 0) {
    addDiagnostic(diagnostics, "error", "authoring", "scenes must contain at least one scene");
    return diagnostics;
  }

  doc.scenes.forEach((scene, sceneIndex) => {
    const sceneId = String(scene?.id || `scene_${sceneIndex + 1}`);
    const commands = Array.isArray(scene?.commands) ? scene.commands : [];
    commands.forEach((command, commandIndex) => {
      if (!command || command.type !== "message") return;
      const location = `${sceneId} command ${commandIndex + 1}`;
      const speaker = String(command.speaker || "");
      const text = String(command.text ?? "").replace(/\r/g, "");
      const lines = text.split("\n");
      const maxLines = speaker.trim() ? 3 : 4;
      if (glyphLength(speaker.trim()) > 16) {
        addDiagnostic(diagnostics, "error", "authoring", `${location}: speaker exceeds 16 characters`);
      }
      if (glyphLength(text) > 96) {
        addDiagnostic(diagnostics, "error", "authoring", `${location}: message exceeds 96 characters`);
      }
      if (lines.length > maxLines) {
        addDiagnostic(diagnostics, "error", "authoring", `${location}: message has ${lines.length} lines; maximum is ${maxLines}${speaker.trim() ? " with a speaker" : " for narration"}`);
      }
      lines.forEach((line, lineIndex) => {
        const length = glyphLength(line);
        if (length > 17) {
          addDiagnostic(diagnostics, "error", "authoring", `${location}: line ${lineIndex + 1} has ${length} characters; maximum is 17`);
        }
      });
    });
  });
  return diagnostics;
}

function copyAssetsToTemporaryProject(projectDir) {
  const sourceAssets = path.join(projectDir, "assets");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pce-vn-validate-"));
  fs.cpSync(sourceAssets, path.join(tempRoot, "assets"), { recursive: true });
  return tempRoot;
}

function removeTemporaryProject(tempRoot) {
  if (!tempRoot) return;
  const resolved = path.resolve(tempRoot);
  const tempPrefix = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(tempPrefix) || !path.basename(resolved).startsWith("pce-vn-validate-")) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function appendEngineDiagnostics(target, diagnostics, scope) {
  for (const diagnostic of diagnostics || []) {
    addDiagnostic(
      target,
      diagnostic.severity === "warning" ? "warning" : "error",
      scope,
      String(diagnostic.message || diagnostic.code || "Unknown engine diagnostic"),
      { code: diagnostic.code || "" },
    );
  }
}

function runCdInspection(vnManager, projectDir, sceneDocument, assetDocument, diagnostics) {
  const result = vnManager.inspectVnSceneDocumentBuild({
    projectDir,
    targetMedia: "cd",
    sceneDocument,
    assetDocument,
  });
  appendEngineDiagnostics(diagnostics, result.diagnostics, "cd");
  return result.sceneBudgets || [];
}

function runHuCardInspection(vnManager, projectDir, diagnostics) {
  let tempRoot = "";
  try {
    tempRoot = copyAssetsToTemporaryProject(projectDir);
    const generated = vnManager.generateVnSources(tempRoot, { targetMedia: "hucard" });
    for (const warning of generated.warnings || []) {
      addDiagnostic(diagnostics, "warning", "hucard", String(warning));
    }
    return (generated.scenePackBytes || []).map((packBytes, index) => ({
      sceneId: generated.sceneIds?.[index] || `scene_${index + 1}`,
      packBytes,
      packByteLimit: 4096,
    }));
  } catch (error) {
    addDiagnostic(diagnostics, "error", "hucard", String(error?.message || error));
    return [];
  } finally {
    removeTemporaryProject(tempRoot);
  }
}

function printBudgets(label, budgets) {
  if (!budgets.length) return;
  console.log(`[INFO] ${label} scene packs`);
  for (const budget of budgets) {
    const bytes = budget.packBytes == null ? "unknown" : budget.packBytes;
    const limit = budget.packByteLimit || (label === "CD-ROM2" ? 8192 : 4096);
    console.log(`  ${budget.sceneId}: ${bytes}/${limit} bytes`);
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    usage();
    return 2;
  }
  if (options.help) {
    usage();
    return 0;
  }

  try {
    const projectDir = path.resolve(options.projectDir);
    const assetsDir = path.join(projectDir, "assets");
    const scenePath = path.join(assetsDir, "pce-vn-scenes.json");
    const assetPath = path.join(assetsDir, "pce-assets.json");
    if (!fs.statSync(projectDir).isDirectory()) throw new Error(`Not a directory: ${projectDir}`);
    if (!fs.statSync(assetsDir).isDirectory()) throw new Error(`Missing assets directory: ${assetsDir}`);
    const sceneDocument = readJson(scenePath);
    const assetDocument = readJson(assetPath);
    const engineRoot = findEngineRoot(options.engineRoot);
    const require = createRequire(import.meta.url);
    const vnManager = require(path.join(engineRoot, "pce-vn-manager.js"));
    const diagnostics = validateAuthoringRules(sceneDocument);
    let cdBudgets = [];
    let hucardBudgets = [];

    if (options.media === "cd" || options.media === "both") {
      cdBudgets = runCdInspection(vnManager, projectDir, sceneDocument, assetDocument, diagnostics);
    }
    if (options.media === "hucard" || options.media === "both") {
      hucardBudgets = runHuCardInspection(vnManager, projectDir, diagnostics);
    }

    for (const diagnostic of diagnostics) {
      const level = diagnostic.severity === "warning" ? "WARNING" : "ERROR";
      console.log(`[${level}] ${diagnostic.scope}: ${diagnostic.message}`);
    }
    printBudgets("CD-ROM2", cdBudgets);
    printBudgets("HuCARD", hucardBudgets);

    const errors = diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length) {
      console.log(`[FAIL] ${errors.length} error(s), ${diagnostics.length - errors.length} warning(s)`);
      return 1;
    }
    console.log(`[OK] ${options.media} validation passed with ${diagnostics.length} warning(s)`);
    console.log("[NEXT] Run the normal target build(s); this validator does not link a ROM or CUE.");
    return 0;
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    return 2;
  }
}

process.exitCode = main();
