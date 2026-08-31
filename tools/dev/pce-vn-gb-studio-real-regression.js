#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeAssetDocument } = require('../../pce-asset-manager');
const { normalizeSceneDocument } = require('../../pce-vn-manager');
const {
  MANIFEST_FILE,
  SIDECAR_FILE,
  generateGbStudioProject,
  inspectGbStudioExport,
  sourceSnapshot,
  validateGbStudioProject,
} = require('../../pce-vn-gb-studio-exporter');

const DEFAULT_PROJECTS = Object.freeze([
  { id: '000_hyakumonogatari', relative: path.join('data', 'projects', 'ホラーストーリー', '000_百物語') },
  { id: '001_sakai_no_ma', relative: path.join('data', 'projects', 'ホラーストーリー', '001_境の間') },
  { id: 'kitahe_pm', relative: path.join('data', 'projects', '北へ。PM') },
]);

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function stableValue(value) { if (Array.isArray(value)) return value.map(stableValue); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])); return value; }
function stableJson(value) { return JSON.stringify(stableValue(value)); }
function usage() {
  return `PCE VN -> GB Studio Phase 3 real-project regression\n\nUsage:\n  node tools/dev/pce-vn-gb-studio-real-regression.js --gb-studio <exe> [options]\n\nOptions:\n  --project <dir>          target project; repeatable (defaults to 000/001/北へ。PM)\n  --out-root <dir>         A/B output root (default: build/gb-studio-phase3/real-regression-v1.4.0)\n  --report <file>          JSON report path (default: <out-root>/report.json)\n  --portrait-mode <mode>   baked or actor (default: baked)\n  --json                   print the completed report\n`;
}

function parseArgs(argv, cwd = process.cwd()) {
  const options = { projects: [], portraitRenderMode: 'baked', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]; const next = () => { if (index + 1 >= argv.length) throw new Error(`${arg}に値が必要です`); return argv[++index]; };
    if (arg === '--gb-studio') options.gbStudio = path.resolve(next());
    else if (arg === '--project') options.projects.push(path.resolve(next()));
    else if (arg === '--out-root') options.outRoot = path.resolve(next());
    else if (arg === '--report') options.report = path.resolve(next());
    else if (arg === '--portrait-mode') options.portraitRenderMode = next();
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`不明なoptionです: ${arg}`);
  }
  if (!['baked', 'actor'].includes(options.portraitRenderMode)) throw new Error('--portrait-modeはbaked/actorです');
  options.outRoot ||= path.resolve(cwd, 'build', 'gb-studio-phase3', 'real-regression-v1.4.0');
  options.report ||= path.join(options.outRoot, 'report.json');
  if (!options.projects.length) options.projects = DEFAULT_PROJECTS.map((entry) => path.resolve(cwd, entry.relative));
  return options;
}

function automaticAudioSubstitutions(projectDir) {
  const assets = normalizeAssetDocument(JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'pce-assets.json'), 'utf-8')));
  const scenes = normalizeSceneDocument(JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), 'utf-8')), assets);
  const types = new Map(assets.assets.map((asset) => [asset.id, asset.type])); const substitutions = {};
  for (const scene of scenes.scenes || []) for (const command of scene.commands || []) {
    if (command.type !== 'audio' || command.action !== 'play' || !['adpcm', 'psg'].includes(command.kind)) continue;
    if (['adpcm', 'psg-sfx'].includes(types.get(command.assetId))) substitutions[command.assetId] = { type: 'omit' };
  }
  return substitutions;
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return []; const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) { const absolute = path.join(root, entry.name); if (entry.isDirectory()) output.push(...walkFiles(absolute)); else if (entry.isFile()) output.push(absolute); }
  return output;
}

function outputResourceDigest(outputDir) {
  const entries = walkFiles(outputDir).map((absolute) => path.relative(outputDir, absolute).replace(/\\/g, '/')).filter((relative) => relative !== MANIFEST_FILE && !relative.startsWith('build/rom/') && !relative.startsWith('build/web/')).sort().map((relative) => ({ path: relative, size: fs.statSync(path.join(outputDir, relative)).size, sha256: sha256(fs.readFileSync(path.join(outputDir, relative))) }));
  return { files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0), hash: sha256(stableJson(entries)) };
}

function auditDigest(outputDir) {
  const controlPath = path.join(outputDir, 'build', 'qa', 'control-flow-audit.json'); const visualPath = path.join(outputDir, 'build', 'qa', 'visual-audit.json');
  const control = fs.readFileSync(controlPath); const visual = fs.readFileSync(visualPath); const visualDoc = JSON.parse(visual.toString('utf-8'));
  return { controlFlowHash: sha256(control), visualFileHash: sha256(visual), visualAuditHash: String(visualDoc.hash || '') };
}

function writeReport(filePath, report) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp-${process.pid}`; fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf-8'); fs.renameSync(temporary, filePath); }
function projectId(projectDir, index) { const known = DEFAULT_PROJECTS.find((entry) => path.resolve(entry.relative).toLowerCase() === path.resolve(projectDir).toLowerCase()); if (known) return known.id; const safe = path.basename(projectDir).normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80); return `${String(index + 1).padStart(3, '0')}_${safe || 'project'}`; }

function runProject(projectDir, index, options) {
  const started = Date.now(); const id = projectId(projectDir, index); const outputA = path.join(options.outRoot, `${id}-a`); const outputB = path.join(options.outRoot, `${id}-b`);
  const settings = { portraitRenderMode: options.portraitRenderMode, warningsAcknowledged: true, visualOmissionsConfirmed: true, audioSubstitutions: automaticAudioSubstitutions(projectDir) };
  const inspectionStarted = Date.now(); const inspection = inspectGbStudioExport({ projectDir, settings, gbStudio: options.gbStudio }); const inspectionMs = Date.now() - inspectionStarted;
  const base = { id, projectDir, outputA, outputB, status: inspection.ok ? 'inspected' : 'inspection-failed', timings: { inspectionMs }, inspection: { ok: inspection.ok, sourceSignature: inspection.sourceSignature, summary: inspection.summary, errors: inspection.errors, warningCounts: Object.fromEntries([...new Set((inspection.warnings || []).map((entry) => entry.code))].sort().map((code) => [code, inspection.warnings.filter((entry) => entry.code === code).length])), omissions: inspection.omissions?.length || 0, visualAuditHash: inspection.audits?.visual?.auditHash || '' } };
  if (!inspection.ok) return { ...base, elapsedMs: Date.now() - started };
  const snapshotBefore = sourceSnapshot(projectDir, inspection._model.sceneDoc, inspection._model.assetDoc, inspection._model.settings);
  const generateStarted = Date.now(); const generatedA = generateGbStudioProject({ inspection, outputDir: outputA }); const generatedB = generateGbStudioProject({ inspection, outputDir: outputB }); const generateMs = Date.now() - generateStarted;
  const validationA = validateGbStudioProject({ outputDir: outputA, inspection }); const validationB = validateGbStudioProject({ outputDir: outputB, inspection }); const digestA = outputResourceDigest(outputA); const digestB = outputResourceDigest(outputB); const auditsA = auditDigest(outputA); const auditsB = auditDigest(outputB);
  const snapshotAfter = sourceSnapshot(projectDir, inspection._model.sceneDoc, inspection._model.assetDoc, inspection._model.settings); const stable = digestA.hash === digestB.hash && auditsA.controlFlowHash === auditsB.controlFlowHash && auditsA.visualFileHash === auditsB.visualFileHash && auditsA.visualAuditHash === auditsB.visualAuditHash; const sourceUnchanged = snapshotBefore.signature === snapshotAfter.signature && stableJson(snapshotBefore.files) === stableJson(snapshotAfter.files);
  const passed = generatedA.ok && generatedB.ok && validationA.ok && validationB.ok && stable && sourceUnchanged;
  return { ...base, status: passed ? 'pass' : 'fail', elapsedMs: Date.now() - started, timings: { inspectionMs, generateAndValidateMs: generateMs }, generated: { a: { ok: generatedA.ok, stats: generatedA.stats, validation: validationA }, b: { ok: generatedB.ok, stats: generatedB.stats, validation: validationB } }, stability: { stable, resourceA: digestA, resourceB: digestB, auditsA, auditsB }, inputIntegrity: { sourceUnchanged, beforeSignature: snapshotBefore.signature, afterSignature: snapshotAfter.signature, files: snapshotBefore.files.length, sidecarExcludedByDesign: SIDECAR_FILE.replace(/\\/g, '/') } };
}

function main() {
  let options; try { options = parseArgs(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n\n${usage()}`); process.exitCode = 2; return; }
  if (options.help) { process.stdout.write(usage()); return; } if (!options.gbStudio) { process.stderr.write(usage()); process.exitCode = 2; return; }
  const report = { format: 'pce-vn-gb-studio-real-regression', version: 1, exporterVersion: '1.4.0', startedAt: new Date().toISOString(), gbStudio: options.gbStudio, portraitRenderMode: options.portraitRenderMode, projects: [] }; writeReport(options.report, report);
  for (const [index, projectDir] of options.projects.entries()) {
    process.stderr.write(`[${index + 1}/${options.projects.length}] ${projectDir}\n`);
    try { report.projects.push(runProject(projectDir, index, options)); } catch (error) { report.projects.push({ id: projectId(projectDir, index), projectDir, status: 'error', error: { code: String(error.code || ''), message: String(error.message || error), stack: String(error.stack || '') } }); }
    writeReport(options.report, report);
  }
  report.completedAt = new Date().toISOString(); report.ok = report.projects.length > 0 && report.projects.every((entry) => entry.status === 'pass'); writeReport(options.report, report); if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); else process.stdout.write(`Report: ${options.report}\nStatus: ${report.ok ? 'PASS' : 'FAIL'}\n`); if (!report.ok) process.exitCode = 3;
}

if (require.main === module) main();
module.exports = { DEFAULT_PROJECTS, auditDigest, automaticAudioSubstitutions, outputResourceDigest, parseArgs, runProject };
