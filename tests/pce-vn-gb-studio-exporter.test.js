'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { adjustBackgroundImage, analyzeGbStudioAutoPalettes, encodeRgbaPng, quantizeDmg, quantizeGbc } = require('../pce-vn-gb-studio-image');
const { packAtomicUnits, parseBdf } = require('../pce-vn-gb-studio-font');
const { convertPsgToMod, normalizeMusicTrackSettings } = require('../pce-vn-gb-studio-music');
const { modeSceneId, speakerToneFrequency } = require('../pce-vn-gb-studio-project');
const { EXPORTER_FORMAT, EXPORTER_RELEASE_VERSION, MANIFEST_FILE, SUPPORTED_GB_STUDIO_VERSIONS, generateGbStudioProject, inspectGbStudioExport, inspectGbStudioInstallation, isSupportedGbStudioInstallation, normalizeGbStudioExecutablePath, normalizeSidecar, previewVnGbStudioBackground, previewVnGbStudioMusic, readAsarEntry, validateGbStudioProject } = require('../pce-vn-gb-studio-exporter');
const { normalizeProjectConfig } = require('../pce-build-system');
const { isExpectedProjectOpenNavigation } = require('../tools/dev/pce-vn-gb-studio-official-build');
const { BUTTON_BITS, buttonByte, clearRunOutputs, makeDemo, parseArgs: parseBgbArgs } = require('../tools/dev/pce-vn-gb-studio-bgb-smoke');
const cli = require('../tools/dev/pce-vn-gb-studio-export');

const GB_STUDIO = { version: '4.3.1', engineVersion: '4.3.0-e1', executablePath: 'fixture-gb-studio.exe', verified: true };
const GB_STUDIO_432 = { ...GB_STUDIO, version: '4.3.2' };
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function fixturePng() {
  const width = 32; const height = 32; const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const at = (y * width + x) * 4; const shade = (Math.floor(x / 8) + Math.floor(y / 8)) % 4; const colors = [[240, 230, 180], [180, 180, 100], [80, 110, 90], [10, 25, 30]]; rgba.set([...colors[shade], 255], at); }
  return encodeRgbaPng({ width, height, rgba });
}

function makeFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-gb-export-')); fs.mkdirSync(path.join(root, 'assets', 'images'), { recursive: true });
  const project = { coreId: 'pc-engine', title: '変換テスト', romName: 'gbvn_test', author: 'Codex' }; fs.writeFileSync(path.join(root, 'project.json'), JSON.stringify(project)); fs.writeFileSync(path.join(root, 'assets', 'images', 'bg.png'), fixturePng());
  const assets = { version: 2, assets: [{ id: 'bg', type: 'image', name: 'BG', source: 'assets/images/bg.png', options: { kind: 'background', width: 32, height: 32 } }, { id: 'song', type: 'psg-song', name: 'Song', source: '', options: { kind: 'song', bpm: 120, speed: 6, steps: 65, loop: true, loopPoint: 17, pattern: [{ step: 0, channel: 0, note: 'C4', volume: 20 }, { step: 17, channel: 2, note: 'E4', volume: 12 }] } }, ...(overrides.assets || [])] };
  const scenes = overrides.scenes || { version: 2, settings: {}, startScene: 'opening', scenes: [{ id: 'opening', name: 'Opening', commands: [{ type: 'background', assetId: 'bg', transition: 'fade', fadeInFrames: 30, fadeOutFrames: 30 }, { type: 'audio', kind: 'psg', action: 'play', assetId: 'song' }, { type: 'message', speaker: 'チカ', text: 'こんにちは。変換テストです。' }, { type: 'choice', variableName: 'route', choices: [{ label: '右へ行く', value: 7, targetSceneId: 'right' }, { label: '左へ行く', value: 9, targetSceneId: 'left' }] }] }, { id: 'right', name: 'Right', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', speaker: '', text: '右を選びました。' }, { type: 'jump', sceneId: 'opening' }] }, { id: 'left', name: 'Left', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', speaker: '', text: '左を選びました。' }, { type: 'wait', frames: 30 }, { type: 'jump', sceneId: 'opening' }] }] };
  fs.writeFileSync(path.join(root, 'assets', 'pce-assets.json'), JSON.stringify(assets)); fs.writeFileSync(path.join(root, 'assets', 'pce-vn-scenes.json'), JSON.stringify(scenes)); return { root, project, assets, scenes };
}
function readGeneratedScenes(outputDir) {
  return fs.readdirSync(path.join(outputDir, 'project', 'scenes'), { recursive: true }).filter((name) => String(name).endsWith('.gbsres')).map((name) => JSON.parse(fs.readFileSync(path.join(outputDir, 'project', 'scenes', name), 'utf-8')));
}
function flattenEvents(events, output = []) {
  for (const item of events || []) { output.push(item); for (const children of Object.values(item.children || {})) flattenEvents(children, output); }
  return output;
}
function generatedEvents(outputDir, predicate = () => true) { return readGeneratedScenes(outputDir).flatMap((scene) => flattenEvents(scene.script).map((event) => ({ scene, event }))).filter(({ event }) => predicate(event)); }


test('official build helper tolerates only the expected project-open navigation interruption', () => {
  assert.equal(isExpectedProjectOpenNavigation(new Error('Execution context was destroyed.')), true);
  assert.equal(isExpectedProjectOpenNavigation(new Error('Inspected target navigated or closed')), true);
  assert.equal(isExpectedProjectOpenNavigation(new Error('GB Studio compile failed')), false);
});

test('BGB runtime smoke input bytes preserve standard buttons and reject the hard-reset marker', () => {
  assert.equal(buttonByte('A+Down'), BUTTON_BITS.a | BUTTON_BITS.down);
  assert.throws(() => buttonByte('A+B+Select+Start+Right+Left+Up+Down'), /0xff/);
  const result = makeDemo(20, ['3:A'], ['5:5:15:Down']);
  assert.equal(result.demo[3], 0x01); assert.equal(result.demo[5], 0x80); assert.equal(result.demo[10], 0x80); assert.equal(result.demo[15], 0x80);
  assert.equal(result.audit.length, 4);
  assert.equal(parseBgbArgs(['--mode', 'dmg', '--breakpoint', '_vm_choice/..3', '--summary']).breakpoint, '_vm_choice/..3');
  const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-bgb-stale-')), 'gbc.png'); fs.writeFileSync(output, 'stale'); clearRunOutputs([output]); assert.equal(fs.existsSync(output), false);
});

test('GB Studio installation metadata accepts 4.3.1/4.3.2 with engine 4.3.0-e1 and unquotes executable paths', () => {
  assert.deepEqual(SUPPORTED_GB_STUDIO_VERSIONS, ['4.3.1', '4.3.2']); assert.deepEqual(inspectGbStudioInstallation(GB_STUDIO), GB_STUDIO); assert.equal(isSupportedGbStudioInstallation(GB_STUDIO), true); assert.equal(isSupportedGbStudioInstallation(GB_STUDIO_432), true); assert.equal(isSupportedGbStudioInstallation({ ...GB_STUDIO_432, engineVersion: 'wrong' }), false); const executable = path.resolve('fixture-gb-studio.exe'); assert.equal(normalizeGbStudioExecutablePath(`"${executable}"`), executable);
});

test('GB Studio exporter remembers the selected executable in project settings', () => {
  const executable = 'C:\\Tools\\GB Studio\\gb-studio.exe';
  const config = normalizeProjectConfig({ pluginSettings: { enabled: { 'pce-vn-gb-studio-exporter': true }, 'pce-vn-gb-studio-exporter': { gbStudioExecutable: executable } } });
  assert.equal(config.pluginSettings['pce-vn-gb-studio-exporter'].gbStudioExecutable, executable);
  assert.equal(config.pluginSettings.enabled['pce-vn-gb-studio-exporter'], true);
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-vn-gb-studio-exporter', 'renderer.js'), 'utf-8');
  assert.match(renderer, /getProjectConfig\?\.\(\)/);
  assert.match(renderer, /saveProjectConfig\(\{ pluginSettings:/);
  assert.match(renderer, /if \(state\.gbStudioExecutable\) void inspect\(\)/);
});

test('missing GB Studio executable produces a dedicated preflight error', () => {
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-gb-missing-')), 'gb-studio.exe');
  const installation = inspectGbStudioInstallation(missing);
  assert.equal(installation.verified, false);
  assert.equal(installation.errorCode, 'GBVN_GB_STUDIO_EXECUTABLE_NOT_FOUND');
  const inspection = inspectGbStudioExport({ projectDir: makeFixture().root, settings: { warningsAcknowledged: true }, gbStudio: missing });
  const error = inspection.errors.find((entry) => entry.code === 'GBVN_GB_STUDIO_EXECUTABLE_NOT_FOUND');
  assert.ok(error);
  assert.match(error.message, /GB Studio実行ファイルが見つかりません/);
  assert.match(error.message, /gb-studio\.exe/);
});

test('Electron preflight reads GB Studio metadata without patched-fs ENOENT', async () => {
  const asar = require('@electron/asar'); const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-gb-electron-asar-')); const source = path.join(installRoot, 'source'); const resources = path.join(installRoot, 'resources'); const executable = path.join(installRoot, 'gb-studio.exe'); fs.mkdirSync(path.join(source, 'appData', 'engine'), { recursive: true }); fs.mkdirSync(resources); fs.writeFileSync(executable, 'fixture'); fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '4.3.2' })); fs.writeFileSync(path.join(source, 'appData', 'engine', 'engine.json'), JSON.stringify({ version: '4.3.0-e1' })); await asar.createPackage(source, path.join(resources, 'app.asar'));
  const exporterPath = path.join(__dirname, '..', 'pce-vn-gb-studio-exporter.js'); const script = 'const result=require(' + JSON.stringify(exporterPath) + ').inspectGbStudioInstallation(' + JSON.stringify(executable) + ');process.stdout.write(JSON.stringify(result));';
  const child = require('node:child_process').spawnSync(require('electron'), ['-e', script], { encoding: 'utf-8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout); assert.equal(result.verified, true, JSON.stringify(result)); assert.equal(result.version, '4.3.2'); assert.equal(result.engineVersion, '4.3.0-e1');
});

test('GB Studio auto-color greedy palette count is audited instead of only the quantizer cluster count', () => {
  const width = 112; const height = 8; const rgba = new Uint8Array(width * height * 4);
  const groups = Array.from({ length: 7 }, (_, group) => Array.from({ length: 4 }, (_, shade) => [16 + group * 24, 8 + shade * 24, 248 - group * 24]));
  for (let tile = 0; tile < 14; tile += 1) {
    const group = tile % 7;
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
      const color = groups[group][tile < 7 ? 0 : x % 4];
      rgba.set([...color, 255], (y * width + tile * 8 + x) * 4);
    }
  }
  const compilerAudit = analyzeGbStudioAutoPalettes({ width, height, rgba });
  assert.equal(compilerAudit.palettes, 9); assert.equal(compilerAudit.maxColorsPerTile, 4);
});

test('image quantizers enforce GBC 7x4 colors and DMG 4 shades/192 tiles', () => {
  const image = require('../pce-vn-gb-studio-image').readRgbaPng(fixturePng()); const gbc = quantizeGbc(image); const dmg = quantizeDmg(image, { fullScreen: true });
  assert.ok(gbc.audit.palettes <= 7); assert.ok(gbc.audit.maxColorsPerTile <= 4); assert.equal(dmg.audit.meaningfulShades, 4); assert.ok(dmg.audit.uniqueTiles <= 192);
});

test('BDF parser preserves baseline placement and atomic font page limits deterministically', () => {
  const glyphs = parseBdf('STARTFONT 2.1\nFONTBOUNDINGBOX 8 8 0 -2\nSTARTPROPERTIES 1\nFONT_ASCENT 6\nENDPROPERTIES\nSTARTCHAR A\nENCODING 65\nBBX 8 8 0 -2\nBITMAP\n18\n24\n42\n7E\n42\n42\n42\n18\nENDCHAR\nSTARTCHAR BORDER\nENCODING 22659\nBBX 7 7 0 -1\nBITMAP\n48\n7E\nD4\n7E\n5C\nDC\n26\nENDCHAR\nENDFONT\n'); const border = glyphs.get(String.fromCodePoint(22659)); assert.equal(glyphs.get('A').length, 64); assert.deepEqual(border.slice(0, 8), [0, 1, 0, 0, 1, 0, 0, 0]); assert.deepEqual(border.slice(48, 56), [0, 0, 1, 0, 0, 1, 1, 0]); assert.ok(border.slice(56, 64).every((value) => value === 0)); assert.equal(packAtomicUnits([{ id: 'a', text: 'abc' }, { id: 'b', text: 'bcd' }]).pages.length, 1); assert.throws(() => packAtomicUnits([{ id: 'overflow', text: Array.from({ length: 223 }, (_, index) => String.fromCodePoint(0x400 + index)).join('') }]), (error) => error.code === 'GBVN_FONT_ATOMIC_UNIT_OVERFLOW');
});

test('PSG MOD preserves a non-zero loop boundary and automatically avoids needless channel conflicts', () => {
  const result = convertPsgToMod({ id: 'music', options: { steps: 65, loop: true, loopPoint: 17, bpm: 120, speed: 6, pattern: [{ step: 0, channel: 1, note: 'C4', volume: 4 }, { step: 0, channel: 3, note: 'E4', volume: 12 }, { step: 17, channel: 0, note: 'G4', volume: 16 }] } }); assert.equal(result.buffer.subarray(1080, 1084).toString('ascii'), 'M.K.'); assert.equal(result.audit.loop.sourceStep, 17); assert.equal(result.audit.loop.targetOrder, 1); assert.equal(result.audit.droppedEvents.length, 0); assert.equal(result.audit.mappedEvents.length, 3); assert.equal(new Set(result.audit.channelAssignments.filter((entry) => entry.target !== 'mute').map((entry) => entry.target)).size, 3);
});

test('preflight and generation emit one mixed ROM project with dual graphs and audits', () => {
  const fixture = makeFixture(); const sourceFiles = ['project.json', 'assets/pce-assets.json', 'assets/pce-vn-scenes.json', 'assets/images/bg.png'].map((relative) => [relative, digest(path.join(fixture.root, relative))]); const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.equal(inspection.summary.outputScenes, 7); assert.equal(inspection.summary.musicTracks, 1);
  const outputDir = path.join(fixture.root, 'gb-output'); const result = generateGbStudioProject({ inspection, outputDir }); assert.equal(result.ok, true, JSON.stringify(result.validation.errors)); assert.ok(fs.existsSync(result.descriptorPath)); assert.ok(fs.existsSync(path.join(outputDir, MANIFEST_FILE))); assert.equal(fs.existsSync(path.join(outputDir, 'plugins', 'pce-vn-dialogue-prepare')), false); assert.ok(fs.existsSync(path.join(outputDir, 'build', 'qa', 'backgrounds-gbc.png'))); assert.ok(fs.existsSync(path.join(outputDir, 'build', 'qa', 'music-audit.json')));
  assert.ok(fs.existsSync(path.join(outputDir, 'build', 'qa', 'conversion-audit.json')));
  const settings = JSON.parse(fs.readFileSync(path.join(outputDir, 'project', 'settings.gbsres'))); assert.equal(settings.colorMode, 'mixed'); assert.equal(settings.defaultBackgroundPaletteIds[7], 'default-ui'); const validation = validateGbStudioProject({ outputDir }); assert.equal(validation.ok, true, JSON.stringify(validation.errors)); sourceFiles.forEach(([relative, hash]) => assert.equal(digest(path.join(fixture.root, relative)), hash));
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, MANIFEST_FILE))); assert.equal(manifest.format, EXPORTER_FORMAT); assert.equal(manifest.conversion.font.id, 'builtin:misaki-gothic-8x8'); assert.ok(manifest.ownedPaths.length > 20);
  const fontResources = fs.readdirSync(path.join(outputDir, 'assets', 'fonts', 'pce-vn')).filter((name) => name.endsWith('.png.gbsres')).map((name) => JSON.parse(fs.readFileSync(path.join(outputDir, 'assets', 'fonts', 'pce-vn', name), 'utf-8'))); assert.ok(fontResources.length > 0); for (const font of fontResources) { const sidecar = JSON.parse(fs.readFileSync(path.join(outputDir, 'assets', 'fonts', font.filename.replace(/\.png$/i, '.json')), 'utf-8')); assert.deepEqual(sidecar.mapping, font.mapping); }
  const sceneResources = fs.readdirSync(path.join(outputDir, 'project', 'scenes'), { recursive: true }).filter((name) => String(name).endsWith('.gbsres')).map((name) => JSON.parse(fs.readFileSync(path.join(outputDir, 'project', 'scenes', name), 'utf-8'))); const dialogueEvents = sceneResources.flatMap((scene) => scene.script || []).filter((item) => item.command === 'EVENT_TEXT' || item.command === 'EVENT_CHOICE' || item.command === 'EVENT_TEXT_DRAW'); assert.ok(dialogueEvents.length > 0); for (const item of dialogueEvents) for (const text of item.command === 'EVENT_CHOICE' ? [item.args.trueText, item.args.falseText] : [].concat(item.args.text)) assert.match(String(text), /^!F:[^!]+!/);
});

test('validation rejects a missing GB Studio compiler font mapping sidecar', () => {
  const fixture = makeFixture(); const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); const outputDir = path.join(fixture.root, 'gb-output-missing-font-sidecar'); generateGbStudioProject({ inspection, outputDir }); const sidecar = path.join(outputDir, 'assets', 'fonts', 'pce-vn', fs.readdirSync(path.join(outputDir, 'assets', 'fonts', 'pce-vn')).find((name) => /^page_.+\.json$/i.test(name))); fs.unlinkSync(sidecar); const validation = validateGbStudioProject({ outputDir }); assert.equal(validation.ok, false); assert.ok(validation.errors.some((entry) => entry.message.includes('compiler用font mapping JSONがありません')));
});
test('message voice is automatically replaced by a stable speaker text tone', () => {
  const fixture = makeFixture({ assets: [{ id: 'voice-line', type: 'adpcm', name: 'Voice', source: '', options: {} }], scenes: { version: 2, startScene: 'opening', scenes: [{ id: 'opening', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', speaker: 'チカ', text: '音声つきです。', voiceAssetId: 'voice-line' }] }] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.equal(inspection.requirements.audioSubstitutions.length, 0); assert.equal(inspection.requirements.automaticVoiceSubstitutions.length, 1); assert.equal(inspection.requirements.automaticVoiceSubstitutions[0].frequency, speakerToneFrequency('チカ'));
  const outputDir = path.join(fixture.root, 'gb-output'); generateGbStudioProject({ inspection, outputDir }); const audit = JSON.parse(fs.readFileSync(path.join(outputDir, 'build', 'qa', 'conversion-audit.json'))); assert.deepEqual(audit.automaticVoiceSubstitutions, inspection.requirements.automaticVoiceSubstitutions);
});

test('state, labels, branches, input modes, SpriteText, and shake are emitted without omission', () => {
  const fixture = makeFixture({ scenes: { version: 2, startScene: 'opening', scenes: [{ id: 'opening', commands: [{ type: 'background', assetId: 'bg' }, { type: 'variable', variableName: 'score', operation: 'define', value: 2 }, { type: 'variable', variableName: 'score', operation: 'add', value: 3 }, { type: 'variable', variableName: 'roll', operation: 'random', min: 1, max: 6 }, { type: 'if', variableName: 'score', operator: 'gte', value: 2, targetLabel: 'has_score', elseLabel: 'no_score' }, { type: 'label', name: 'has_score' }, { type: 'switch', variableName: 'score', cases: [{ value: 5, targetLabel: 'route_a' }], defaultLabel: 'no_score' }, { type: 'label', name: 'route_a' }, { type: 'inputcheck', mode: 'async', buttons: ['run'], targetLabel: 'end' }, { type: 'inputcheck', mode: 'cancel' }, { type: 'inputcheck', mode: 'sync', buttons: ['i', 'right'], targetLabel: 'end' }, { type: 'label', name: 'no_score' }, { type: 'goto', targetLabel: 'end' }, { type: 'label', name: 'end' }, { type: 'spritetext', text: '状態OK', x: 8, y: 8 }, { type: 'effect', effect: 'shake', frames: 10, intensity: 2 }, { type: 'message', text: '制御フロー完了。' }] }] } }); const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.equal(inspection.omissions.length, 0); const outputDir = path.join(fixture.root, 'gb-output-control'); generateGbStudioProject({ inspection, outputDir }); const scripts = fs.readdirSync(path.join(outputDir, 'project', 'scenes'), { recursive: true }).filter((name) => String(name).endsWith('.gbsres')).map((name) => fs.readFileSync(path.join(outputDir, 'project', 'scenes', name), 'utf-8')).join('\n'); ['EVENT_SET_VALUE', 'EVENT_VARIABLE_MATH', 'PCE_VN_EVENT_RANDOM', 'EVENT_IF', 'EVENT_SET_INPUT_SCRIPT', 'EVENT_REMOVE_INPUT_SCRIPT', 'EVENT_AWAIT_INPUT', 'EVENT_TEXT_DRAW', 'EVENT_CAMERA_SHAKE'].forEach((command) => assert.match(scripts, new RegExp(command)));
});

test('targetless async input resumes after the following sync gate and clears all input callbacks', () => {
  const fixture = makeFixture({ scenes: { version: 2, startScene: 'entry', scenes: [{ id: 'entry', name: 'Entry', commands: [{ type: 'background', assetId: 'bg' }, { type: 'inputcheck', mode: 'async', buttons: ['run', 'i'], targetLabel: '' }, { type: 'inputcheck', mode: 'async', buttons: ['right'], targetLabel: 'next' }, { type: 'inputcheck', mode: 'sync', buttons: ['left'], targetLabel: 'previous' }, { type: 'jump', sceneId: 'arrival' }, { type: 'label', name: 'next' }, { type: 'jump', sceneId: 'next_scene' }, { type: 'label', name: 'previous' }, { type: 'jump', sceneId: 'previous_scene' }] }, { id: 'arrival', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', text: '開始' }] }, { id: 'next_scene', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', text: '次' }] }, { id: 'previous_scene', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', text: '前' }] }] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); const outputDir = path.join(fixture.root, 'gb-output-input-resume'); generateGbStudioProject({ inspection, outputDir }); const resources = fs.readdirSync(path.join(outputDir, 'project', 'scenes'), { recursive: true }).filter((name) => String(name).endsWith('.gbsres')).map((name) => JSON.parse(fs.readFileSync(path.join(outputDir, 'project', 'scenes', name), 'utf-8'))); const entry = resources.find((resource) => resource.name === 'Entry [GBC]'); assert.ok(entry); const callbacks = entry.script.filter((item) => item.command === 'EVENT_SET_INPUT_SCRIPT'); const startInput = callbacks.find((item) => item.args.input.includes('a') && item.args.input.includes('start')); const nextInput = callbacks.find((item) => item.args.input.includes('right')); const previousInput = callbacks.find((item) => item.args.input.includes('left')); assert.ok(startInput && nextInput && previousInput); for (const callback of callbacks) assert.deepEqual(callback.children.true.find((item) => item.command === 'EVENT_REMOVE_INPUT_SCRIPT').args.input, ['a', 'b', 'start', 'select', 'up', 'down', 'left', 'right']); const startSwitch = startInput.children.true.find((item) => item.command === 'EVENT_SWITCH_SCENE'); assert.equal(startSwitch.args.sceneId, modeSceneId(inspection._model.graph.firstTargets.arrival, 'gbc')); assert.equal(entry.script.some((item) => item.command === 'EVENT_AWAIT_INPUT'), false); assert.equal(entry.script.at(-1).command, 'EVENT_IDLE');
});

test('flat source backgrounds keep exact DMG colors and report shade underuse as an acknowledged warning', () => {
  const fixture = makeFixture({ scenes: { version: 2, startScene: 'opening', scenes: [{ id: 'opening', commands: [{ type: 'message', text: '単色背景です。' }] }] } }); const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.ok(inspection.warnings.some((entry) => entry.code === 'GBVN_DMG_SHADE_UNDERUSE'));
});

test('preflight blocks visual omissions and missing CDDA mapping without confirmation', () => {
  const fixture = makeFixture({ assets: [{ id: 'portrait', type: 'sprite', name: 'Portrait', source: 'assets/images/bg.png', options: { kind: 'sprite' } }, { id: 'cdda', type: 'cdda-track', name: 'CDDA', source: '', options: { track: 3, loop: true } }], scenes: { version: 2, startScene: 'opening', scenes: [{ id: 'opening', commands: [{ type: 'background', assetId: 'bg' }, { type: 'sprite', slot: 0, assetId: 'portrait', visible: true }, { type: 'audio', kind: 'cdda', action: 'play', assetId: 'cdda' }, { type: 'message', text: '停止確認' }] }] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, gbStudio: GB_STUDIO }); const codes = inspection.errors.map((entry) => entry.code); assert.ok(codes.includes('GBVN_VISUAL_OMISSION_REQUIRES_CONFIRMATION')); assert.ok(codes.includes('GBVN_CDDA_MAPPING_REQUIRED'));
});

test('CDDA accepts a validated external 4-channel MOD and stores a portable sidecar copy', () => {
  const fixture = makeFixture({ assets: [{ id: 'cdda', type: 'cdda-track', name: 'CDDA', source: '', options: { track: 3, loop: true } }], scenes: { version: 2, startScene: 'opening', scenes: [{ id: 'opening', commands: [{ type: 'background', assetId: 'bg' }, { type: 'audio', kind: 'cdda', action: 'play', assetId: 'cdda' }, { type: 'message', text: '外部MODです。' }] }] } }); const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-external-mod-')); const modPath = path.join(externalRoot, 'replacement.mod'); fs.writeFileSync(modPath, convertPsgToMod(fixture.assets.assets.find((asset) => asset.id === 'song')).buffer);
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true, cddaMappings: { cdda: { type: 'external-mod', source: modPath } } }, gbStudio: GB_STUDIO }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.equal(inspection.summary.musicTracks, 1); const outputDir = path.join(fixture.root, 'gb-output'); generateGbStudioProject({ inspection, outputDir }); const sidecar = JSON.parse(fs.readFileSync(path.join(fixture.root, 'assets', 'pce-vn-gb-studio-export.json'))); assert.match(sidecar.cddaMappings.cdda.source, /^assets\/music\/gb-studio-export\//); assert.ok(fs.existsSync(path.join(fixture.root, sidecar.cddaMappings.cdda.source))); assert.ok(fs.readdirSync(path.join(outputDir, 'assets', 'music', 'pce-vn')).some((name) => name.endsWith('.mod'))); const manifestText = fs.readFileSync(path.join(outputDir, MANIFEST_FILE), 'utf-8'); assert.equal(manifestText.includes(externalRoot), false);
});

test('generation refuses a non-owned non-empty output folder', () => {
  const fixture = makeFixture(); const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); const outputDir = path.join(fixture.root, 'foreign'); fs.mkdirSync(outputDir); fs.writeFileSync(path.join(outputDir, 'keep.txt'), 'user'); assert.throws(() => generateGbStudioProject({ inspection, outputDir }), (error) => error.code === 'GBVN_OUTPUT_NOT_OWNED'); assert.equal(fs.readFileSync(path.join(outputDir, 'keep.txt'), 'utf-8'), 'user');
});

test('regeneration backs up owned files, rebinds an exact legacy snapshot, and rejects a different source project', () => {
  const first = makeFixture(); const firstInspection = inspectGbStudioExport({ projectDir: first.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); const outputDir = path.join(os.tmpdir(), `pce-vn-owned-output-${crypto.randomBytes(6).toString('hex')}`); generateGbStudioProject({ inspection: firstInspection, outputDir }); const manifestPath = path.join(outputDir, MANIFEST_FILE); const legacyManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); legacyManifest.sourceProject.identity = 'legacy-path-identity'; legacyManifest.exporter.version = '1.1.0'; const stalePlugin = path.join(outputDir, 'plugins', 'pce-vn-dialogue-prepare', 'engine', 'engine.json'); fs.mkdirSync(path.dirname(stalePlugin), { recursive: true }); fs.writeFileSync(stalePlugin, '{}'); legacyManifest.ownedPaths.push({ path: 'plugins/pce-vn-dialogue-prepare/engine/engine.json', size: 2, sha256: crypto.createHash('sha256').update('{}').digest('hex') }); fs.writeFileSync(manifestPath, `${JSON.stringify(legacyManifest, null, 2)}\n`); const regenerated = generateGbStudioProject({ inspection: firstInspection, outputDir }); assert.equal(fs.existsSync(stalePlugin), false); assert.equal(fs.existsSync(path.join(outputDir, 'plugins', 'pce-vn-control', 'plugin.json')), true); assert.ok(regenerated.backupPath); assert.ok(fs.existsSync(path.join(regenerated.backupPath, MANIFEST_FILE))); const reboundManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); assert.notEqual(reboundManifest.sourceProject.identity, 'legacy-path-identity'); const second = makeFixture(); const secondInspection = inspectGbStudioExport({ projectDir: second.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); assert.throws(() => generateGbStudioProject({ inspection: secondInspection, outputDir }), (error) => error.code === 'GBVN_OUTPUT_NOT_OWNED');
});
test('CLI parses repeatable CDDA, external MOD, and audio substitution options', () => { const parsed = cli.parseArgs(['--project', 'p', '--out', 'o', '--gb-studio', 'g', '--cdda-map', 'cd=song', '--cdda-mod', 'intro=music.mod', '--audio-sub', 'voice=tone:660:0.1', '--confirm-visual-omissions', '--ack-warnings']); assert.equal(parsed.cddaMappings.cd, 'song'); assert.deepEqual(parsed.cddaMappings.intro, { type: 'external-mod', source: path.resolve('music.mod') }); assert.deepEqual(parsed.audioSubstitutions.voice, { type: 'tone', frequency: 660, duration: 0.1 }); assert.equal(parsed.visualOmissionsConfirmed, true); });

test('plugin manifest exposes only generic hooks/capabilities', () => { const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-vn-gb-studio-exporter', 'manifest.json'))); assert.equal(EXPORTER_RELEASE_VERSION, '1.3.0'); assert.equal(manifest.version, EXPORTER_RELEASE_VERSION); assert.deepEqual(manifest.supportedCores, ['pc-engine']); assert.ok(manifest.renderer.capabilities.includes('novel-toolbar-action')); ['inspectVnGbStudioExport', 'previewVnGbStudioMusic', 'previewVnGbStudioBackground'].forEach((hook) => assert.ok(manifest.hooks.includes(hook))); });

test('Phase 2 menus preserve 2/3/4 choices, every defaultIndex, long labels, duplicate values, and independent targets', () => {
  const longLabel = 'これは十六文字を確実に超えて全文を欠落なく保持するための選択肢です';
  const fixture = makeFixture({ scenes: { version: 2, startScene: 'menu2', scenes: [
    { id: 'menu2', commands: [{ type: 'background', assetId: 'bg' }, { type: 'choice', variableName: 'route', defaultIndex: 0, choices: [{ label: longLabel, value: 7, targetSceneId: 'menu3' }, { label: '同じ値でも別の遷移先です', value: 7, targetSceneId: 'menu4' }] }] },
    { id: 'menu3', commands: [{ type: 'background', assetId: 'bg' }, { type: 'choice', variableName: 'route', defaultIndex: 1, choices: [{ label: '一番目', value: -3, targetSceneId: 'end' }, { label: '二番目', value: 0, targetSceneId: 'end' }, { label: '三番目', value: 3, targetSceneId: 'end' }] }] },
    { id: 'menu4', commands: [{ type: 'background', assetId: 'bg' }, { type: 'choice', variableName: 'route', defaultIndex: 3, choices: [{ label: '甲', value: 1, targetSceneId: 'end' }, { label: '乙', value: 2, targetSceneId: 'end' }, { label: '丙', value: 3, targetSceneId: 'end' }, { label: '丁', value: 4, targetSceneId: 'end' }] }] },
    { id: 'end', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', text: '終了です。' }] },
  ] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 });
  assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.deepEqual(inspection.summary.choices, { 2: 1, 3: 1, 4: 1 }); assert.deepEqual(inspection.requirements.customEventReferences, ['PCE_VN_EVENT_MENU']); assert.equal(inspection.requirements.generatedPlugins[0].gbsVersion, '4.3.2');
  const outputDir = path.join(fixture.root, 'gb-output-menus'); generateGbStudioProject({ inspection, outputDir });
  const gbcScenes = readGeneratedScenes(outputDir).filter((scene) => scene.name.endsWith('[GBC]')); const menus = gbcScenes.flatMap((scene) => flattenEvents(scene.script).filter((event) => event.command === 'PCE_VN_EVENT_MENU').map((event) => ({ scene, event }))).sort((a, b) => a.event.args.items - b.event.args.items);
  assert.deepEqual(menus.map(({ event }) => event.args.items), [2, 3, 4]);
  const starts = menus.map(({ scene, event }) => { const at = scene.script.findIndex((item) => item.id === event.id); return scene.script.slice(0, at).reverse().find((item) => item.command === 'EVENT_SET_VALUE' && item.args.variable === event.args.variable).args.value.value; });
  assert.deepEqual(starts, [1, 2, 4]);
  const longOption = menus[0].event.args.option1.replace(/^!F:[^!]+!/, ''); assert.equal(longOption.replace(/\n/g, ''), longLabel); assert.ok(longOption.split('\n').every((line) => Array.from(line).length <= 16));
  const menu2Events = flattenEvents(menus[0].scene.script); const variables = JSON.parse(fs.readFileSync(path.join(outputDir, 'project', 'variables.gbsres'), 'utf-8')); const routeId = variables.variables.find((item) => item.name === 'route').id; assert.equal(menu2Events.filter((item) => item.command === 'EVENT_SET_VALUE' && item.args.variable === routeId && item.args.value.value === 7).length, 2); assert.equal(new Set(menu2Events.filter((item) => item.command === 'EVENT_SWITCH_SCENE').map((item) => item.args.sceneId)).size, 2);
  const plugin = fs.readFileSync(path.join(outputDir, 'plugins', 'pce-vn-control', 'events', 'eventPceVnMenu.js'), 'utf-8'); assert.match(plugin, /_choice\(variable, \["\.UI_MENU_SET_START"\]/); assert.match(plugin, /textDraw\(item, 2, rowStarts\[index\], "overlay"\)/); assert.match(plugin, /_menuItem\(1, rowStarts\[index\]/); assert.doesNotMatch(plugin, /helpers\.textMenu/);
  const audit = JSON.parse(fs.readFileSync(path.join(outputDir, 'build', 'qa', 'control-flow-audit.json'), 'utf-8')); assert.equal(audit.status, 'pass'); assert.equal(new Set(audit.commands.map((command) => command.key)).size, audit.summary.sourceCommands); for (const command of audit.commands.filter((entry) => ['branch', 'state', 'text', 'bgm'].includes(entry.processingCategory))) for (const mode of ['gbc', 'dmg']) assert.ok(command.generated[mode].eventIds.length > 0, `${command.key}/${mode}`);

  for (const count of [1, 5]) {
    const invalid = makeFixture({ scenes: { version: 2, startScene: 'bad', scenes: [{ id: 'bad', commands: [{ type: 'choice', choices: Array.from({ length: count }, (_, index) => ({ label: `選択${index}`, value: index, targetSceneId: 'end' })) }] }, { id: 'end', commands: [{ type: 'message', text: 'end' }] }] } });
    const invalidInspection = inspectGbStudioExport({ projectDir: invalid.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO });
    const error = invalidInspection.errors.find((entry) => entry.code === 'GBVN_CHOICE_OPTION_COUNT'); assert.ok(error, `${count}択を拒否する`); assert.equal(error.location, 'bad.commands[0]');
  }
  const overflowing = makeFixture({ scenes: { version: 2, startScene: 'bad', scenes: [{ id: 'bad', commands: [{ type: 'choice', choices: [{ label: 'あ'.repeat(16 * 9), value: 0, targetSceneId: 'end' }, { label: 'い'.repeat(16 * 9), value: 1, targetSceneId: 'end' }] }] }, { id: 'end', commands: [{ type: 'message', text: 'end' }] }] } });
  const overflowInspection = inspectGbStudioExport({ projectDir: overflowing.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); const overflow = overflowInspection.errors.find((entry) => entry.code === 'GBVN_CHOICE_MENU_OVERFLOW'); assert.ok(overflow); assert.equal(overflow.location, 'bad.commands[0]'); assert.equal(overflow.data.totalLines, 18);
});

test('source inventory rejects unknown and normalized-away commands while preserving explicit skipped-source entries', () => {
  const invalid = makeFixture({ scenes: { version: 2, startScene: 'bad', scenes: [{ id: 'bad', commands: [{ type: 'mysteryCommand', value: 1 }, { type: 'choice', choices: [] }] }] } });
  const invalidInspection = inspectGbStudioExport({ projectDir: invalid.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO });
  assert.ok(invalidInspection.errors.some((entry) => entry.code === 'GBVN_UNKNOWN_COMMAND' && entry.location === 'bad.commands[0]'));
  assert.ok(invalidInspection.errors.some((entry) => entry.code === 'GBVN_UNCONSUMED_COMMAND' && entry.location === 'bad.commands[1]'));

  const skipped = makeFixture({ scenes: { version: 2, startScene: 'entry', scenes: [{ id: 'entry', commands: [{ type: 'mysteryCommand', skip: true }, { type: 'background', assetId: 'bg' }, { type: 'message', text: 'skip後も進みます。' }] }] } });
  const inspection = inspectGbStudioExport({ projectDir: skipped.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.equal(inspection.summary.commandConsumption.skipped, 1);
  const outputDir = path.join(skipped.root, 'gb-output-skip'); generateGbStudioProject({ inspection, outputDir }); const audit = JSON.parse(fs.readFileSync(path.join(outputDir, 'build', 'qa', 'control-flow-audit.json'), 'utf-8')); const command = audit.commands.find((entry) => entry.key === 'entry:0'); assert.equal(command.disposition, 'skipped-source'); assert.equal(command.generated.gbc.eventIds.length, 0); assert.equal(command.generated.dmg.eventIds.length, 0);
});

test('signed define/set/add/sub, random edges, and all six comparisons match Phase 2 semantics', () => {
  const operators = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];
  const fixture = makeFixture({ scenes: { version: 2, startScene: 'state', scenes: [{ id: 'state', commands: [
    { type: 'background', assetId: 'bg' },
    { type: 'variable', variableName: 'score', operation: 'define', value: -32768 },
    { type: 'variable', variableName: 'score', operation: 'set', value: -123 },
    { type: 'variable', variableName: 'score', operation: 'add', value: -5 },
    { type: 'variable', variableName: 'score', operation: 'sub', value: -7 },
    { type: 'variable', variableName: 'same', operation: 'random', min: 4, max: 4 },
    { type: 'variable', variableName: 'reverse', operation: 'random', min: 7, max: -2 },
    { type: 'variable', variableName: 'full', operation: 'random', min: -32768, max: 32767 },
    ...operators.map((operator) => ({ type: 'if', variableName: 'score', operator, value: -1, targetLabel: 'done' })),
    { type: 'message', text: 'fallthrough' }, { type: 'label', name: 'done' }, { type: 'message', text: 'done' },
  ] }] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.deepEqual(inspection.requirements.customEventReferences, ['PCE_VN_EVENT_RANDOM']);
  const outputDir = path.join(fixture.root, 'gb-output-signed'); generateGbStudioProject({ inspection, outputDir }); const all = generatedEvents(outputDir).filter(({ scene }) => scene.name.endsWith('[GBC]')).map(({ event }) => event);
  assert.ok(all.some((event) => event.command === 'EVENT_SET_VALUE' && event.args.value?.value === -123));
  assert.ok(all.some((event) => event.command === 'EVENT_VARIABLE_MATH' && event.args.operation === 'add' && event.args.value === -5 && event.args.clamp === false));
  assert.ok(all.some((event) => event.command === 'EVENT_VARIABLE_MATH' && event.args.operation === 'sub' && event.args.value === -7 && event.args.clamp === false));
  const randoms = all.filter((event) => event.command === 'PCE_VN_EVENT_RANDOM').map((event) => [event.args.min, event.args.range]).sort((a, b) => a[0] - b[0]); assert.deepEqual(randoms, [[-32768, 65535], [-2, 10], [4, 1]]);
  assert.deepEqual([...new Set(all.filter((event) => event.command === 'EVENT_IF' && operators.includes(event.args.condition?.type)).map((event) => event.args.condition.type))].sort(), [...operators].sort());
  const dispatcher = readGeneratedScenes(outputDir).find((scene) => scene.name === 'Device Dispatch'); assert.ok(dispatcher.script.some((event) => event.command === 'EVENT_SET_VALUE' && event.args.value.value === -32768));
});

test('control graph records fallthrough, terminal, joins, reachable and unreachable loops', () => {
  const fixture = makeFixture({ scenes: { version: 2, startScene: 'main', scenes: [
    { id: 'main', commands: [{ type: 'background', assetId: 'bg' }, { type: 'variable', variableName: 'v', operation: 'define', value: 0 }, { type: 'if', variableName: 'v', operator: 'eq', value: 1, targetLabel: 'join' }, { type: 'switch', variableName: 'v', cases: [{ value: 2, targetLabel: 'join' }, { value: 3, targetLabel: 'join' }] }, { type: 'message', text: 'defaultなしfallthrough' }, { type: 'goto', targetLabel: 'loop' }, { type: 'label', name: 'loop' }, { type: 'goto', targetLabel: 'loop' }, { type: 'label', name: 'join' }, { type: 'jump', sceneId: 'end' }] },
    { id: 'end', commands: [{ type: 'background', assetId: 'bg' }, { type: 'message', text: '到達' }] },
    { id: 'dead', commands: [{ type: 'label', name: 'dead_loop' }, { type: 'goto', targetLabel: 'dead_loop' }] },
  ] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.ok(inspection.warnings.some((entry) => entry.code === 'GBVN_UNREACHABLE_BLOCK')); assert.ok(inspection.audits.controlFlow.joins.some((join) => join.incoming > 1)); assert.ok(inspection.audits.controlFlow.loops.length >= 2); assert.ok(inspection.summary.unreachableBlocks > 0);
  const outputDir = path.join(fixture.root, 'gb-output-graph'); generateGbStudioProject({ inspection, outputDir }); const audit = JSON.parse(fs.readFileSync(path.join(outputDir, 'build', 'qa', 'control-flow-audit.json'), 'utf-8')); const ifSegment = audit.graph.segments.find((segment) => segment.edges.some((edge) => edge.kind === 'if-true')); const switchSegment = audit.graph.segments.find((segment) => segment.edges.some((edge) => edge.kind === 'switch-case')); assert.ok(ifSegment.edges.some((edge) => edge.kind === 'fallthrough')); assert.ok(switchSegment.edges.some((edge) => edge.kind === 'fallthrough')); assert.ok(audit.graph.segments.some((segment) => segment.terminal && segment.edges.some((edge) => edge.kind === 'goto')));
  const nestedSwitch = generatedEvents(outputDir, (event) => event.command === 'EVENT_IF').find(({ scene, event }) => scene.name.startsWith('main') && event.children?.false?.some((child) => child.command === 'EVENT_IF')); assert.ok(nestedSwitch);
});

test('source consumption, stable event IDs and generated resource hashes are deterministic', () => {
  const fixture = makeFixture(); const sourcePaths = ['project.json', 'assets/pce-assets.json', 'assets/pce-vn-scenes.json', 'assets/images/bg.png']; const before = Object.fromEntries(sourcePaths.map((relative) => [relative, digest(path.join(fixture.root, relative))]));
  const outA = path.join(fixture.root, 'stable-a'); const outB = path.join(fixture.root, 'stable-b'); const inspectionA = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 }); generateGbStudioProject({ inspection: inspectionA, outputDir: outA }); const inspectionB = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 }); generateGbStudioProject({ inspection: inspectionB, outputDir: outB });
  const resourceDigest = (root) => { const files = fs.readdirSync(path.join(root, 'project'), { recursive: true }).filter((name) => String(name).endsWith('.gbsres')).sort(); const hash = crypto.createHash('sha256'); for (const name of files) hash.update(String(name)).update(fs.readFileSync(path.join(root, 'project', name))); return hash.digest('hex'); };
  assert.equal(resourceDigest(outA), resourceDigest(outB)); assert.equal(digest(path.join(outA, 'build', 'qa', 'control-flow-audit.json')), digest(path.join(outB, 'build', 'qa', 'control-flow-audit.json'))); for (const relative of sourcePaths) assert.equal(digest(path.join(fixture.root, relative)), before[relative]);
  const audit = JSON.parse(fs.readFileSync(path.join(outA, 'build', 'qa', 'control-flow-audit.json'), 'utf-8')); assert.equal(audit.summary.sourceCommands, audit.summary.consumedCommands); assert.equal(audit.commands.some((command) => command.disposition === 'pending' || command.disposition === 'error'), false);
});

test('metadata after terminal commands is attached to following labels without false unreachable blocks', () => {
  const fixture = makeFixture({ scenes: { version: 2, startScene: 'entry', scenes: [
    { id: 'entry', commands: [{ type: 'background', assetId: 'bg' }, { type: 'inputcheck', mode: 'async', buttons: ['right'], targetLabel: 'NEXT' }, { type: 'inputcheck', mode: 'sync', buttons: ['left'], targetLabel: 'PREV' }, { type: 'comment', text: 'fallthrough metadata' }, { type: 'jump', sceneId: 'arrival' }, { type: 'comment', text: 'NEXT metadata' }, { type: 'label', name: 'NEXT' }, { type: 'jump', sceneId: 'next' }, { type: 'comment', text: 'PREV metadata' }, { type: 'label', name: 'PREV' }, { type: 'jump', sceneId: 'previous' }] },
    { id: 'arrival', commands: [{ type: 'message', text: 'arrival' }] }, { id: 'next', commands: [{ type: 'message', text: 'next' }] }, { id: 'previous', commands: [{ type: 'message', text: 'previous' }] },
  ] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.equal(inspection.warnings.some((entry) => entry.code === 'GBVN_UNREACHABLE_BLOCK'), false); assert.equal(inspection.summary.unreachableBlocks, 0);
  const base = inspection._model.graph.baseSegments.filter((segment) => segment.sourceSceneId === 'entry'); assert.equal(base.some((segment) => !segment.hasExecutable && segment.commands.every((command) => ['comment', 'cache'].includes(command.type))), false); assert.ok(base.some((segment) => segment.label === 'NEXT' && segment.commands.some((command) => command.type === 'comment'))); assert.ok(base.some((segment) => segment.label === 'PREV' && segment.commands.some((command) => command.type === 'comment')));
});

test('background state specializes shared blocks and a late first background never applies retroactively', () => {
  const fixture = makeFixture({ assets: [{ id: 'bg2', type: 'image', name: 'BG2', source: 'assets/images/bg.png', options: { kind: 'background' } }], scenes: { version: 2, startScene: 'root', scenes: [
    { id: 'root', commands: [{ type: 'background', assetId: 'bg' }, { type: 'choice', choices: [{ label: 'warm', value: 1, targetSceneId: 'warm' }, { label: 'cool', value: 2, targetSceneId: 'cool' }] }] },
    { id: 'warm', commands: [{ type: 'background', assetId: 'bg' }, { type: 'jump', sceneId: 'shared' }] }, { id: 'cool', commands: [{ type: 'background', assetId: 'bg2' }, { type: 'jump', sceneId: 'shared' }] },
    { id: 'shared', commands: [{ type: 'message', text: 'inherited' }] },
  ] } });
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); const shared = inspection._model.graph.segments.filter((segment) => segment.sourceSceneId === 'shared' && segment.reachable); assert.equal(shared.length, 2); assert.deepEqual(shared.map((segment) => segment.effectiveBackgroundKey).sort(), ['bg', 'bg2']); assert.ok(shared.every((segment) => segment.backgroundSource === 'inherited')); assert.equal(new Set(shared.map((segment) => segment.key)).size, 2);
  const outputDir = path.join(fixture.root, 'gb-output-background-product'); generateGbStudioProject({ inspection, outputDir }); const audit = JSON.parse(fs.readFileSync(path.join(outputDir, 'build', 'qa', 'control-flow-audit.json'), 'utf-8')); const audited = audit.graph.segments.filter((segment) => segment.sourceSceneId === 'shared'); assert.equal(audited.length, 2); assert.ok(audited.every((segment) => segment.originBlockKey === 'shared::0' && segment.specializedSceneIds.gbc && segment.specializedSceneIds.dmg));

  const late = makeFixture({ assets: [{ id: 'bg2', type: 'image', name: 'BG2', source: 'assets/images/bg.png', options: { kind: 'background' } }], scenes: { version: 2, startScene: 'late', scenes: [{ id: 'late', commands: [{ type: 'message', text: 'before' }, { type: 'background', assetId: 'bg2' }, { type: 'message', text: 'after' }] }] } }); const lateInspection = inspectGbStudioExport({ projectDir: late.root, settings: { warningsAcknowledged: true }, gbStudio: GB_STUDIO_432 }); assert.equal(lateInspection.ok, true, JSON.stringify(lateInspection.errors)); const lateSegments = lateInspection._model.graph.segments.filter((segment) => segment.sourceSceneId === 'late'); assert.equal(lateSegments.length, 2); assert.equal(lateSegments[0].effectiveBackgroundKey, 'blank'); assert.equal(lateSegments[0].commands.some((command) => command.type === 'background'), false); assert.equal(lateSegments[1].effectiveBackgroundKey, 'bg2');
});

test('PSG period is authoritative for flat notes and manual channel controls are fully audited', () => {
  const asset = { id: 'flat-control', name: 'Flat Control', options: { steps: 32, bpm: 120, speed: 6, loop: true, loopPoint: 8, pattern: [
    { step: 0, channel: 0, note: 'Bb3', period: 480, volume: 12, wave: 2 }, { step: 0, channel: 1, note: 'E♭4', period: 360, volume: 18, wave: 45 }, { step: 1, channel: 2, note: 'A♭4', period: 269, volume: 16, wave: 1 }, { step: 1, channel: 4, note: 'C4', period: 12, volume: 15, noise: true, noiseMode: 'white' },
  ] } };
  const settings = normalizeMusicTrackSettings({ tempoScale: 150, channels: [{ target: 'pulse1', priority: 10 }, { target: 'pulse1', priority: 90, volumeScale: 150, transpose: 2 }, { target: 'wave', instrument: 'auto' }, {}, { target: 'noise', instrument: 'auto' }] }); const result = convertPsgToMod(asset, settings); assert.equal(result.audit.targetBpm, 180); assert.equal(result.audit.status, 'warning'); assert.ok(result.audit.normalizedNotes.some((entry) => entry.source === 'Bb3' && entry.normalized === 'A#3')); assert.ok(result.audit.normalizedNotes.some((entry) => entry.normalized === 'D#4')); assert.ok(result.audit.normalizedNotes.some((entry) => entry.normalized === 'G#4')); assert.ok(result.audit.pitchEvents.some((entry) => entry.sourceChannel === 0 && entry.sourcePeriod === 480)); assert.ok(result.audit.channelConflicts.some((entry) => entry.target === 'pulse1')); assert.ok(result.audit.droppedEvents.some((entry) => entry.reason === 'channel-conflict' && entry.sourceChannel === 0)); assert.ok(result.audit.mappedEvents.some((entry) => entry.sourceChannel === 2 && entry.instrument === 15)); assert.ok(result.audit.mappedEvents.some((entry) => entry.sourceChannel === 4 && entry.instrument >= 16 && entry.instrument <= 31)); assert.equal(result.preview.bpm, result.audit.targetBpm);
  assert.throws(() => convertPsgToMod({ id: 'bad-note', options: { steps: 1, pattern: [{ step: 0, channel: 0, note: 'H9', volume: 10 }] } }), (error) => error.code === 'GBVN_PSG_INVALID_NOTE');
});

test('six active PSG channels are reduced deterministically and preview uses the same normalized event stream', () => {
  const pattern = Array.from({ length: 6 }, (_, channel) => ({ step: 0, channel, note: 'C4', period: 428 + channel, volume: 10 + channel, wave: channel, noise: channel >= 4 })); const asset = { id: 'six', name: 'Six', type: 'psg-song', options: { steps: 8, bpm: 100, loop: true, pattern } }; const converted = convertPsgToMod(asset); assert.equal(converted.audit.channelAssignments.filter((entry) => entry.target !== 'mute').length, 4); assert.equal(converted.audit.droppedEvents.filter((entry) => entry.reason === 'target-channel-capacity').length, 2); assert.equal(converted.audit.status, 'warning');
  const fixture = makeFixture({ assets: [asset] }); const preview = previewVnGbStudioMusic({ projectDir: fixture.root, assets: fixture.assets, assetId: 'six', settings: { tempoScale: 125 }, generation: 7 }); assert.equal(preview.generation, 7); assert.equal(preview.gbPreview.bpm, 125); assert.deepEqual(preview.audit.mappedEvents, convertPsgToMod(asset, { tempoScale: 125 }).audit.mappedEvents); assert.equal(preview.outputHash, preview.audit.outputHash); assert.equal(preview.sourcePreview.rows.length, preview.gbPreview.rows.length);
});

test('background correction preserves dialogue matte and preview hashes match formal export assets', () => {
  const rgba = new Uint8Array([100, 80, 60, 255, 120, 100, 80, 255, 224, 248, 207, 255, 224, 248, 207, 255]); const adjusted = adjustBackgroundImage({ width: 2, height: 2, rgba }, { brightness: 20, saturation: 160, artworkHeight: 1 }); assert.notDeepEqual([...adjusted.rgba.subarray(0, 8)], [...rgba.subarray(0, 8)]); assert.deepEqual([...adjusted.rgba.subarray(8)], [...rgba.subarray(8)]);
  const fixture = makeFixture(); const backgroundSettings = { brightness: 25, saturation: 140, gbcDither: true, dmgDither: false }; const preview = previewVnGbStudioBackground({ projectDir: fixture.root, assets: fixture.assets, assetId: 'bg', fullScreen: false, settings: backgroundSettings, generation: 11 }); assert.equal(preview.generation, 11); assert.equal(preview.audit.gbc.dither, true); assert.equal(preview.audit.dmg.dither, false); assert.equal(preview.audit.artworkHeight, 96); assert.match(preview.images.gbc, /^data:image\/png;base64,/);
  const inspection = inspectGbStudioExport({ projectDir: fixture.root, settings: { warningsAcknowledged: true, backgrounds: { bg: backgroundSettings }, music: { song: { tempoScale: 110 } } }, gbStudio: GB_STUDIO_432 }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); const backgroundAudit = inspection.audits.backgrounds.find((entry) => entry.assetId === 'bg' && entry.fullScreen === false); assert.equal(backgroundAudit.hashes.gbc, preview.hashes.gbc); assert.equal(backgroundAudit.hashes.dmg, preview.hashes.dmg);
  const outputDir = path.join(fixture.root, 'gb-output-adjusted'); generateGbStudioProject({ inspection, outputDir }); const generatedGbc = fs.readdirSync(path.join(outputDir, 'assets', 'backgrounds', 'pce-vn', 'gbc')).find((name) => name.endsWith('.png')); assert.equal(digest(path.join(outputDir, 'assets', 'backgrounds', 'pce-vn', 'gbc', generatedGbc)), preview.hashes.gbc); const sidecar = JSON.parse(fs.readFileSync(path.join(fixture.root, 'assets', 'pce-vn-gb-studio-export.json'), 'utf-8')); assert.deepEqual(sidecar.backgrounds.bg, { brightness: 25, saturation: 140, gbcDither: true, dmgDither: false, focusX: 0.5, focusY: 0.5 }); assert.equal(sidecar.music.song.tempoScale, 110); const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, MANIFEST_FILE), 'utf-8')); assert.equal(manifest.conversion.backgroundOutputs.find((entry) => entry.assetId === 'bg').hashes.gbc, preview.hashes.gbc); assert.equal(manifest.conversion.backgroundAuditHash.length, 64);
});

test('sidecar v1 normalizes additive music and image settings without changing format version', () => {
  const sidecar = normalizeSidecar({ version: 99, backgrounds: { bg: { brightness: -999, saturation: 999, gbcDither: 1, dmgDither: 0, focusX: 2 } }, music: { song: { tempoScale: 999, channels: [{ target: 'wave', instrument: 99, volumeScale: -1, transpose: 99, priority: 101 }] } } }); assert.equal(sidecar.version, 1); assert.deepEqual(sidecar.backgrounds.bg, { brightness: -100, saturation: 200, gbcDither: true, dmgDither: false, focusX: 1, focusY: 0.5 }); assert.equal(sidecar.music.song.tempoScale, 200); assert.deepEqual(sidecar.music.song.channels[0], { target: 'wave', instrument: 31, volumeScale: 0, transpose: 24, priority: 100 }); assert.equal(Object.keys(sidecar.music.song.channels).length, 6);
});

test('preview hooks reject project-external assets, invalid IDs, and oversized PNG dimensions', () => {
  const fixture = makeFixture(); assert.throws(() => previewVnGbStudioBackground({ projectDir: fixture.root, assets: fixture.assets, assetId: '../bg' }), (error) => error.code === 'GBVN_PREVIEW_ASSET_INVALID');
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-vn-gb-outside-')); const outside = path.join(outsideRoot, 'outside.png'); fs.writeFileSync(outside, fixturePng()); const externalAssets = { version: 2, assets: [{ id: 'outside', type: 'image', name: 'Outside', source: outside, options: { kind: 'background' } }] }; assert.throws(() => previewVnGbStudioBackground({ projectDir: fixture.root, assets: externalAssets, assetId: 'outside' }), (error) => ['GBVN_PREVIEW_PATH_OUTSIDE_PROJECT', 'GBVN_PREVIEW_ASSET_INVALID'].includes(error.code));
  const hugePath = path.join(fixture.root, 'assets', 'images', 'huge.png'); const header = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(header); header.writeUInt32BE(5000, 16); header.writeUInt32BE(5000, 20); fs.writeFileSync(hugePath, header); const hugeAssets = { version: 2, assets: [{ id: 'huge', type: 'image', name: 'Huge', source: 'assets/images/huge.png', options: { kind: 'background' } }] }; assert.throws(() => previewVnGbStudioBackground({ projectDir: fixture.root, assets: hugeAssets, assetId: 'huge' }), (error) => error.code === 'GBVN_PREVIEW_DATA_TOO_LARGE');
});

test('export modal contains debounced generation-safe BGM and image adjustment workflows', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'pce-vn-gb-studio-exporter', 'renderer.js'), 'utf-8'); ['BGM調整', '画像調整', 'previewVnGbStudioMusic', 'previewVnGbStudioBackground', 'Source A', 'GB近似 B', 'brightness', 'saturation', 'gbcDither', 'dmgDither'].forEach((token) => assert.match(renderer, new RegExp(token))); assert.match(renderer, /setTimeout\(async \(\) =>/); assert.match(renderer, /generation !== epochs\.music/); assert.match(renderer, /generation !== epochs\.background/); assert.match(renderer, /if \(state\.gbStudioExecutable\) void inspect\(\)/); assert.match(renderer, /saveProjectConfig\(\{ pluginSettings:/);
});

test('000_百物語 has no metadata-only unreachable warning and inherits all four branch backgrounds', { skip: !fs.existsSync(path.join(__dirname, '..', 'data', 'projects', 'ホラーストーリー', '000_百物語', 'project.json')) }, () => {
  const projectDir = path.join(__dirname, '..', 'data', 'projects', 'ホラーストーリー', '000_百物語'); const inspection = inspectGbStudioExport({ projectDir, settings: { warningsAcknowledged: true, visualOmissionsConfirmed: true }, gbStudio: GB_STUDIO_432 }); assert.equal(inspection.ok, true, JSON.stringify(inspection.errors)); assert.equal(inspection.warnings.some((entry) => entry.code === 'GBVN_UNREACHABLE_BLOCK'), false); const expected = { scene_tale_isamu_a: 'still_tale_kouichi_01_candlelit_circle', scene_tale_isamu_b: 'still_tale_kouichi_01_candlelit_circle', scene_search_a: 'still_vanish_02_group_waits', scene_search_b: 'still_vanish_02_group_waits' }; for (const [sceneId, background] of Object.entries(expected)) { const variants = inspection._model.graph.segments.filter((segment) => segment.sourceSceneId === sceneId && segment.reachable); assert.ok(variants.length > 0, sceneId); assert.ok(variants.every((segment) => segment.effectiveBackgroundKey === background && segment.backgroundSource === 'inherited'), sceneId); }
  const flatCount = inspection.audits.music.reduce((sum, audit) => sum + audit.normalizedNotes.filter((entry) => /b|♭/.test(entry.source)).length, 0); assert.equal(flatCount, 11); assert.equal(inspection.audits.music.some((audit) => audit.droppedEvents.some((entry) => entry.reason === 'invalid-note')), false);
});
