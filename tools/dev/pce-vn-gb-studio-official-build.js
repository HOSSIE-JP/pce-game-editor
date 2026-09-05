#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { inspectGbStudioInstallation } = require('../../pce-vn-gb-studio-exporter');
const { expectedCgbFlag, normalizeOutputTargetMode } = require('../../pce-vn-gb-studio-target');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function filesUnder(root) { const files = []; if (!fs.existsSync(root)) return files; const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) visit(absolute); else if (entry.isFile()) files.push(absolute); }); visit(root); return files; }
function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port)); }); }); }

class CdpClient {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
  async connect() { this.ws = new WebSocket(this.url); this.ws.addEventListener('message', (event) => { const message = JSON.parse(event.data); const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); clearTimeout(pending.timer); if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result); }); await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }); }); }
  call(method, params = {}, timeoutMs = 300000) { const id = this.nextId++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression, timeoutMs) { const response = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime.evaluate failed'); return response.result?.value; }
  close() { try { this.ws?.close(); } catch (_) {} }
}

async function listTargets(port) { const response = await fetch(`http://127.0.0.1:${port}/json`); if (!response.ok) throw new Error(`CDP target HTTP ${response.status}`); return response.json(); }
async function waitTargets(port, predicate, attempts = 180) { let last = []; for (let attempt = 0; attempt < attempts; attempt += 1) { try { last = await listTargets(port); const found = last.find(predicate); if (found) return found; } catch (_) {} await delay(500); } throw new Error(`GB Studio CDP target timeout: ${JSON.stringify(last.map((target) => ({ type: target.type, url: target.url })))}`); }

async function evaluateOnce(target, expression) { const client = new CdpClient(target.webSocketDebuggerUrl); await client.connect(); try { return await client.evaluate(expression, 30000); } finally { client.close(); } }
function isExpectedProjectOpenNavigation(error) { return /Execution context was destroyed|Inspected target navigated or closed|Target closed/i.test(String(error?.message || error || '')); }
function assertExpectedInstallation(installation, expectedVersion = '', expectedEngineVersion = '') {
  if (!installation?.verified) { const error = new Error(`GB Studio実行fileを検証できません: ${installation?.error || installation?.errorCode || 'unknown'}`); error.code = installation?.errorCode || 'GBVN_GB_STUDIO_VERSION_MISMATCH'; throw error; }
  if (expectedVersion && String(installation.version) !== String(expectedVersion)) { const error = new Error(`GB Studio versionが一致しません（期待: ${expectedVersion}; 検出: ${installation.version || '不明'}）`); error.code = 'GBVN_GB_STUDIO_VERSION_MISMATCH'; throw error; }
  if (expectedEngineVersion && String(installation.engineVersion) !== String(expectedEngineVersion)) { const error = new Error(`GB Studio engine versionが一致しません（期待: ${expectedEngineVersion}; 検出: ${installation.engineVersion || '不明'}）`); error.code = 'GBVN_GB_STUDIO_VERSION_MISMATCH'; throw error; }
  return installation;
}

async function runOfficialBuild({ executablePath, projectPath, outputDir, gbStudioVersion = '', engineVersion = '', targetMode = 'dual' } = {}) {
  const unquote = (value) => { const text = String(value || '').trim(); return text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) ? text.slice(1, -1).trim() : text; };
  const executable = path.resolve(unquote(executablePath)); const project = path.resolve(unquote(projectPath)); const root = path.resolve(String(outputDir || path.dirname(project))); if (!fs.existsSync(executable)) throw new Error(`GB Studio executableがありません: ${executable}`); if (!fs.existsSync(project)) throw new Error(`.gbsprojがありません: ${project}`);
  const installation = assertExpectedInstallation(inspectGbStudioInstallation(executable), gbStudioVersion, engineVersion); gbStudioVersion = installation.version; engineVersion = installation.engineVersion; targetMode = normalizeOutputTargetMode(targetMode); const expectedFlag = expectedCgbFlag(targetMode);
  const port = await freePort(); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-gb-studio-43x-')); const startedAt = Date.now(); const child = spawn(executable, [project, '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', (data) => { stdout = `${stdout}${data}`.slice(-65536); }); child.stderr.on('data', (data) => { stderr = `${stderr}${data}`.slice(-65536); }); let client;
  try {
    const firstPage = await waitTargets(port, (target) => target.type === 'page', 120); let main = (await listTargets(port)).find((target) => target.type === 'page' && target.url.includes('main_window'));
    if (!main) { try { await evaluateOnce(firstPage, `Promise.resolve(API.project.openProject(${JSON.stringify(project)})).then(() => true)`); } catch (error) { if (!isExpectedProjectOpenNavigation(error)) throw error; } main = await waitTargets(port, (target) => target.type === 'page' && target.url.includes('main_window'), 240); }
    client = new CdpClient(main.webSocketDebuggerUrl); await client.connect(); let loaded;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      loaded = await client.evaluate(`(() => { let runtime = window.__pceVnGbRuntime; if (typeof runtime !== 'function' && window.webpackChunkgb_studio) { window.webpackChunkgb_studio.push([["pce_vn_gb_export_" + Date.now()], {}, (value) => { runtime = value; }]); window.__pceVnGbRuntime = runtime; } if (typeof runtime !== 'function') return { ready: false, reason: 'webpack' }; const entries = Object.entries(runtime.m || {}); const storeId = entries.find(([, factory]) => { const source = String(factory); return source.includes('actionsDenylist') && source.includes('trackerDocumentMiddleware'); })?.[0]; const actionId = entries.find(([, factory]) => { const source = String(factory); return source.includes('buildGame/exportProject') && source.includes('buildGame/build'); })?.[0]; const store = storeId ? runtime(storeId)?.default : null; const actions = actionId ? runtime(actionId)?.default : null; if (!store || !actions) return { ready: false, reason: 'modules' }; window.__pceVnGbStore = store; window.__pceVnGbActions = actions; const state = store.getState(); return { ready: Boolean(state.document?.loaded), title: document.title, projectName: state.project?.present?.name, console: state.console }; })()`);
      if (loaded?.ready) break; await delay(500);
    }
    if (!loaded?.ready) throw new Error(`GB Studio project load timeout: ${JSON.stringify(loaded)}`);
    const dispatchBuild = (buildType) => client.evaluate(`(async () => { const store = window.__pceVnGbStore; const actions = window.__pceVnGbActions; store.dispatch(actions.buildGame({ buildType: ${JSON.stringify(buildType)}, exportBuild: true, debugEnabled: false })); let state = store.getState(); let sawRunning = false; for (let attempt = 0; attempt < 3600; attempt += 1) { state = store.getState(); if (state.console?.status === 'running') sawRunning = true; if (sawRunning && state.console?.status !== 'running') break; await new Promise((resolve) => setTimeout(resolve, 250)); } return { sawRunning, console: state.console }; })()`, 930000);
    const build = await dispatchBuild('rom');
    if (!build.sawRunning || build.console?.status !== 'complete') throw new Error(`GB Studio ROM build失敗: ${JSON.stringify(build.console)}`); if (listWarnings(build.console).length) throw new Error(`GB Studio ROM build warning: ${JSON.stringify(listWarnings(build.console))}`);
    const roms = filesUnder(path.join(root, 'build', 'rom')).filter((file) => /\.(gb|gbc)$/i.test(file) && fs.statSync(file).mtimeMs >= startedAt - 2000).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); if (!roms.length) throw new Error('新しい公式ROM成果物が見つかりません'); const romPath = roms[0]; const rom = fs.readFileSync(romPath); if (rom.length < 0x150) throw new Error('ROMが短すぎます'); if (rom[0x143] !== expectedFlag) throw new Error(`${targetMode} ROMのCGB flagは0x${expectedFlag.toString(16).padStart(2, '0')}必須です: 0x${rom[0x143].toString(16).padStart(2, '0')}`);
    const webBuild = await dispatchBuild('web'); if (!webBuild.sawRunning || webBuild.console?.status !== 'complete') throw new Error(`GB Studio Web build失敗: ${JSON.stringify(webBuild.console)}`); if (listWarnings(webBuild.console).length) throw new Error(`GB Studio Web build warning: ${JSON.stringify(listWarnings(webBuild.console))}`);
    const webFiles = filesUnder(path.join(root, 'build', 'web')); const webIndex = webFiles.find((file) => path.basename(file).toLowerCase() === 'index.html' && fs.statSync(file).mtimeMs >= startedAt - 2000); if (!webIndex) throw new Error('新しい公式Web成果物index.htmlが見つかりません'); const webRom = webFiles.find((file) => /[\\/]rom[\\/].*\.(gb|gbc)$/i.test(file)); if (!webRom) throw new Error('公式Web成果物内ROMが見つかりません'); const romHash = sha256(romPath); const webRomHash = sha256(webRom); if (romHash !== webRomHash) throw new Error(`公式ROM/Web内ROMのhashが一致しません: ${romHash} / ${webRomHash}`);
    return { status: 'pass', targetMode, gbStudioVersion: String(gbStudioVersion || ''), engineVersion: String(engineVersion || ''), title: loaded.title, projectName: loaded.projectName, startedAt: new Date(startedAt).toISOString(), build, webBuild, rom: { path: romPath, bytes: rom.length, sha256: romHash, cgbFlag: `0x${expectedFlag.toString(16).padStart(2, '0')}`, title: rom.subarray(0x134, 0x143).toString('ascii').replace(/\0+$/, '') }, web: { indexPath: webIndex, files: webFiles.length, sha256: sha256(webIndex), romPath: webRom, romSha256: webRomHash, matchesStandaloneRom: true }, process: { pid: child.pid, profile, stdout, stderr } };
  } finally { client?.close(); if (!child.killed) child.kill(); }
}

function listWarnings(consoleState) { return Array.isArray(consoleState?.warnings) ? consoleState.warnings : []; }

async function main() { const args = process.argv.slice(2); const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; }; try { const result = await runOfficialBuild({ executablePath: value('--gb-studio'), gbStudioVersion: value('--gb-studio-version'), engineVersion: value('--engine-version'), projectPath: value('--project'), outputDir: value('--out'), targetMode: value('--target') || 'dual' }); const reportPath = path.join(path.resolve(value('--out')), 'build', 'qa', 'official-build-report.json'); fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`); process.stdout.write(`${JSON.stringify({ ...result, reportPath }, null, 2)}\n`); } catch (error) { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; } }

if (require.main === module) void main();
module.exports = { CdpClient, assertExpectedInstallation, isExpectedProjectOpenNavigation, runOfficialBuild };
