'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAssetSource } = require('./pce-asset-manager');
const { paginateDialogue, createFontPages } = require('./pce-vn-gb-studio-font');
const { encodeIndexedPng, encodeRgbaPng, makeContactSheet, prepareBackground, quantizeDmg, quantizeGbc, readRgbaPng, DMG_COLORS } = require('./pce-vn-gb-studio-image');
const { convertPsgToMod } = require('./pce-vn-gb-studio-music');

const DIALOGUE_FRAME_EVENT = 'EVENT_SET_DIALOGUE_FRAME';
const ALL_INPUTS = ['a', 'b', 'start', 'select', 'up', 'down', 'left', 'right'];

function idFor(kind, key) {
  const hex = crypto.createHash('sha256').update(`pce-vn-gb-studio-exporter\0${kind}\0${key}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function slug(value, fallback = 'item') { return String(value || fallback).normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || fallback; }
function json(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf-8'); }
function event(command, args = {}, children, key = `${command}:${JSON.stringify(args)}`) { const output = { id: idFor('event', key), command, args }; if (children) output.children = children; return output; }
function number(value) { return { type: 'number', value: Number(value) || 0 }; }

function targetlessAsyncContinuation(commands, startIndex) {
  for (let index = startIndex + 1; index < commands.length; index += 1) {
    const command = commands[index];
    if (!command || command.type === 'comment' || command.type === 'cache') continue;
    if (command.type === 'inputcheck') {
      if (command.mode === 'async') continue;
      if (command.mode === 'sync') return { kind: 'sync', gateIndex: index, resumeIndex: index + 1 };
      return null;
    }
    if (command.type === 'wait' && index === startIndex + 1) return { kind: 'wait', gateIndex: index, resumeIndex: index + 1 };
    if (['audio', 'variable', 'spritetext', 'effect'].includes(command.type)) continue;
    return null;
  }
  return null;
}

function splitScenes(sceneDoc) {
  const segments = []; const firstTargets = {}; const labelTargets = {};
  for (const scene of sceneDoc.scenes || []) {
    let local = []; let pending = []; let background = null; let segmentIndex = 0;
    const flush = (label = '') => {
      if (!background && !pending.length && !local.length && !label) return;
      const key = `${scene.id}::${segmentIndex++}`; const segment = { key, sourceSceneId: scene.id, sourceName: scene.name || scene.id, sourceIndex: segments.length, label, fullScreen: Boolean(scene.fullScreenBg), background, commands: [...pending, ...local], nextKey: '', transition: background?.transition || 'cut', fadeFrames: background?.fadeInFrames || 0 };
      pending = []; local = []; segments.push(segment); if (!firstTargets[scene.id]) firstTargets[scene.id] = key; if (label) labelTargets[`${scene.id}:${label}`] = key; return segment;
    };
    for (const command of scene.commands || []) {
      if (command.type === 'background') {
        if (!background) { background = command; local.push(command); }
        else { flush(); background = command; local.push(command); }
      } else if (command.type === 'label') {
        flush(); const key = `${scene.id}::${segmentIndex++}`; const segment = { key, sourceSceneId: scene.id, sourceName: scene.name || scene.id, sourceIndex: segments.length, label: command.name, fullScreen: Boolean(scene.fullScreenBg), background, commands: [], nextKey: '', transition: 'cut', fadeFrames: 0 }; segments.push(segment); if (!firstTargets[scene.id]) firstTargets[scene.id] = key; labelTargets[`${scene.id}:${command.name}`] = key;
      } else if (!background) pending.push(command); else local.push(command);
    }
    flush();
    if (!firstTargets[scene.id]) { const key = `${scene.id}::0`; segments.push({ key, sourceSceneId: scene.id, sourceName: scene.name || scene.id, sourceIndex: segments.length, label: '', fullScreen: Boolean(scene.fullScreenBg), background: null, commands: [], nextKey: '', transition: 'cut', fadeFrames: 0 }); firstTargets[scene.id] = key; }
    const own = segments.filter((segment) => segment.sourceSceneId === scene.id); own.forEach((segment, index) => { segment.nextKey = own[index + 1]?.key || (scene.nextSceneId ? firstTargets[scene.nextSceneId] || `@scene:${scene.nextSceneId}` : ''); });
  }
  segments.forEach((segment) => { if (segment.nextKey.startsWith('@scene:')) segment.nextKey = firstTargets[segment.nextKey.slice(7)] || ''; });
  return { segments, firstTargets, labelTargets };
}

function collectVariables(sceneDoc) {
  const names = []; const seen = new Set();
  const add = (name) => { const value = String(name || '').trim(); if (value && !seen.has(value)) { seen.add(value); names.push(value); } };
  for (const scene of sceneDoc.scenes || []) for (const command of scene.commands || []) { add(command.variableName); if (command.type === 'choice' && !command.variableName) add(`choice_${scene.id}`); }
  return { names, ids: Object.fromEntries(names.map((name, index) => [name, String(index)])) };
}

function makeTextUnits(graph) {
  const units = [];
  graph.segments.forEach((segment) => segment.commands.forEach((command, commandIndex) => {
    if (command.type === 'message') {
      command.gbPages = paginateDialogue(command).map((page, pageIndex) => { const id = `${segment.key}:message:${commandIndex}:${pageIndex}`; units.push({ id, text: page.text }); return { ...page, unitId: id }; });
    } else if (command.type === 'choice') { const id = `${segment.key}:choice:${commandIndex}`; command.gbUnitId = id; units.push({ id, text: (command.choices || []).map((choice) => choice.label).join('\n') }); }
    else if (command.type === 'spritetext' && command.text) { const id = `${segment.key}:spritetext:${commandIndex}`; command.gbUnitId = id; units.push({ id, text: command.text }); }
  }));
  return units;
}

function buildConversionModel({ projectDir, project, sceneDoc, assetDoc, settings, gbStudio }) {
  const graph = splitScenes(sceneDoc); const variables = collectVariables(sceneDoc); const textUnits = makeTextUnits(graph); const font = createFontPages(textUnits, { projectDir, font: settings.font }); const assetsById = new Map((assetDoc.assets || []).map((asset) => [asset.id, asset]));
  const backgroundVariants = []; const seenBackgrounds = new Set();
  graph.segments.forEach((segment) => { const assetId = segment.background?.assetId || ''; const key = `${assetId || 'blank'}:${segment.fullScreen ? 'fullscreen' : 'dialogue'}`; segment.backgroundVariantKey = key; if (!seenBackgrounds.has(key)) { seenBackgrounds.add(key); backgroundVariants.push({ key, assetId, fullScreen: segment.fullScreen }); } });
  const musicAssetIds = new Set(); const externalMusicById = new Map();
  for (const segment of graph.segments) for (const command of segment.commands) if (command.type === 'audio' && command.action === 'play') {
    if (command.kind === 'psg' && assetsById.get(command.assetId)?.type === 'psg-song') musicAssetIds.add(command.assetId);
    if (command.kind === 'cdda') { const mapping = settings.cddaMappings?.[command.assetId]; if (typeof mapping === 'string' || mapping?.type === 'psg-song' || mapping?.targetAssetId) musicAssetIds.add(typeof mapping === 'string' ? mapping : mapping.targetAssetId); else if (mapping?.type === 'external-mod' && mapping.source) { const id = externalMusicAssetId(command.assetId); const sourcePath = path.isAbsolute(mapping.source) ? path.resolve(mapping.source) : path.resolve(projectDir, mapping.source); externalMusicById.set(id, { id, sourceCddaAssetId: command.assetId, name: mapping.name || `${assetsById.get(command.assetId)?.name || command.assetId} (External MOD)`, sourcePath }); } }
  }
  const music = [...musicAssetIds].filter((id) => assetsById.get(id)?.type === 'psg-song').map((id) => assetsById.get(id));
  return { projectDir, project, sceneDoc, assetDoc, assetsById, settings, gbStudio, graph, variables, textUnits, font, backgroundVariants, music, externalMusic: [...externalMusicById.values()] };
}

function transformBackgrounds(model) {
  const output = []; const audits = [];
  for (const variant of model.backgroundVariants) {
    let prepared;
    if (!variant.assetId) { const rgba = new Uint8Array(160 * 144 * 4); for (let i = 0; i < 160 * 144; i += 1) rgba.set([224, 248, 207, 255], i * 4); prepared = { width: 160, height: 144, rgba }; }
    else {
      const asset = model.assetsById.get(variant.assetId); const source = asset && resolveAssetSource(model.projectDir, asset).absPath; if (!source || !fs.existsSync(source)) throw new Error(`背景素材が見つかりません: ${variant.assetId}`); if (path.extname(source).toLowerCase() !== '.png') { const error = new Error(`Phase 1の背景入力はPNGのみです: ${variant.assetId}`); error.code = 'GBVN_UNRESOLVED_ASSET'; throw error; }
      prepared = prepareBackground(readRgbaPng(fs.readFileSync(source)), { fullScreen: variant.fullScreen, focusX: model.settings.backgrounds?.[variant.assetId]?.focusX, focusY: model.settings.backgrounds?.[variant.assetId]?.focusY });
    }
    const gbc = quantizeGbc(prepared, { maxPalettes: 7 }); const dmg = quantizeDmg(prepared, { fullScreen: variant.fullScreen, tileLimit: 192 });
    output.push({ ...variant, prepared, gbc, dmg }); audits.push({ key: variant.key, assetId: variant.assetId, fullScreen: variant.fullScreen, gbc: gbc.audit, dmg: dmg.audit });
  }
  return { output, audits };
}

function validateExternalMod(buffer, label = 'External MOD') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1084) throw new Error(`${label}: MOD fileが短すぎます`); const signature = buffer.subarray(1080, 1084).toString('ascii'); if (!['M.K.', 'M!K!', '4CHN', 'FLT4'].includes(signature)) throw new Error(`${label}: GB Studio hUGE用4ch ProTracker MOD signatureではありません: ${signature}`); const songLength = buffer[950]; if (songLength < 1 || songLength > 128) throw new Error(`${label}: MOD song lengthが不正です: ${songLength}`); return { signature, songLength, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function buildMusic(model) { const tracks = model.music.map((asset) => ({ asset, ...convertPsgToMod(asset) })); for (const external of model.externalMusic || []) { const buffer = fs.readFileSync(external.sourcePath); const metadata = validateExternalMod(buffer, external.name); tracks.push({ asset: { id: external.id, name: external.name }, buffer, audit: { assetId: external.id, sourceCddaAssetId: external.sourceCddaAssetId, sourceType: 'external-mod', sourceHash: metadata.sha256, outputHash: metadata.sha256, sourceBpm: null, sourceSteps: null, sourceLoopPoint: null, mappedEvents: [], droppedEvents: [], transposedEvents: [], controlConflicts: [], timingErrorRows: 0, output: metadata } }); } return { tracks, audits: tracks.map((track) => track.audit) }; }

function modeSceneId(segmentKey, mode) { return idFor('scene', `${mode}:${segmentKey}`); }
function backgroundId(variantKey, mode) { return idFor('background', `${mode}:${variantKey}`); }
function fontId(pageIndex) { return idFor('font', `page:${pageIndex}`); }
function musicId(assetId) { return idFor('music', assetId); }
function externalMusicAssetId(cddaAssetId) { return `external-mod:${cddaAssetId}`; }

function switchScene(targetKey, mode, fadeSpeed = '2', key = targetKey) { return event('EVENT_SWITCH_SCENE', { sceneId: modeSceneId(targetKey, mode), x: number(0), y: number(0), direction: '', fadeSpeed: String(fadeSpeed) }, undefined, `switch:${mode}:${key}`); }
function inputNames(buttons) { const result = []; for (const button of buttons || []) { const mapped = { i: 'a', ii: 'b', run: 'start', select: 'select', up: 'up', down: 'down', left: 'left', right: 'right' }[button]; if (mapped && !result.includes(mapped)) result.push(mapped); } return result.length ? result : ['a']; }

function condition(variableId, operator, value) { return { type: ({ eq: 'eq', ne: 'ne', lt: 'lt', lte: 'lte', gt: 'gt', gte: 'gte' })[operator] || 'eq', valueA: { type: 'variable', value: variableId }, valueB: { type: 'number', value: Number(value) || 0 } }; }

function mappedMusicAsset(command, model) {
  if (command.kind === 'psg' && model.assetsById.get(command.assetId)?.type === 'psg-song') return command.assetId;
  if (command.kind === 'cdda') { const mapping = model.settings.cddaMappings?.[command.assetId]; if (mapping?.type === 'external-mod') return externalMusicAssetId(command.assetId); return typeof mapping === 'string' ? mapping : mapping?.targetAssetId || ''; }
  return '';
}

function speakerToneFrequency(speaker) {
  const identity = String(speaker || 'narration').normalize('NFKC');
  return 160 + (crypto.createHash('sha256').update(identity).digest().readUInt16BE(0) % 241);
}

function soundSubstitution(assetId, model) { const mapping = model.settings.audioSubstitutions?.[assetId]; return typeof mapping === 'string' ? { type: mapping } : mapping || null; }
function soundEvent(mapping, key) { if (!mapping || mapping.type === 'omit') return null; return event('EVENT_SOUND_PLAY_EFFECT', { type: 'tone', priority: 'high', duration: Math.max(0.01, Number(mapping.duration) || 0.08), wait: Boolean(mapping.wait), pitch: 5, frequency: Math.max(40, Math.min(5000, Number(mapping.frequency) || 440)), effect: 0 }, undefined, `sound:${key}`); }

function dialogueEvents(command, model, key) {
  const output = [];
  const textFrequency = speakerToneFrequency(command.speaker);
  for (const [pageIndex, page] of (command.gbPages || []).entries()) {
    const pageNumber = model.font.assignments[page.unitId]; const activeFont = fontId(pageNumber); output.push(event('EVENT_SET_FONT', { fontId: activeFont }, undefined, `${key}:font:${pageIndex}`)); output.push(event(DIALOGUE_FRAME_EVENT, { tilesetId: '' }, undefined, `${key}:frame:${pageIndex}`));
    output.push(event('EVENT_TEXT_SET_SOUND_EFFECT', { type: 'tone', frequency: textFrequency, duration: 0.015 }, undefined, `${key}:text-sound:${pageIndex}`));
    output.push(event('EVENT_TEXT', { text: `!F:${activeFont}!${page.text}`, avatarId: '', minHeight: 6, maxHeight: 6, position: 'bottom', showFrame: true, clearPrevious: true, textX: 1, textY: page.textY, textHeight: 4, speedIn: -3, speedOut: -3, closeWhen: 'key', closeButton: 'a', closeDelayUnits: 'frames', closeDelayFrames: 0 }, undefined, `${key}:text:${pageIndex}`));
  }
  return output;
}

function choiceEvents(command, segment, mode, model, key) {
  const choices = command.choices || []; const variableName = command.variableName || `choice_${segment.sourceSceneId}`; const variable = model.variables.ids[variableName]; const page = model.font.assignments[command.gbUnitId]; const activeFont = fontId(page); const firstTarget = model.graph.firstTargets[choices[0]?.targetSceneId]; const secondTarget = model.graph.firstTargets[choices[1]?.targetSceneId];
  const branch = (choice, target, suffix) => [event('EVENT_SET_VALUE', { variable, value: number(choice.value) }, undefined, `${key}:set:${suffix}`), switchScene(target, mode, '2', `${key}:target:${suffix}`)];
  return [event('EVENT_SET_FONT', { fontId: activeFont }, undefined, `${key}:font`), event(DIALOGUE_FRAME_EVENT, { tilesetId: '' }, undefined, `${key}:frame`), event('EVENT_CHOICE', { variable, trueText: `!F:${activeFont}!${choices[0].label}`, falseText: `!F:${activeFont}!${choices[1].label}` }, undefined, `${key}:choice`), event('EVENT_IF', { condition: condition(variable, 'eq', 1), __collapseElse: false }, { true: branch(choices[0], firstTarget, 'true'), false: branch(choices[1], secondTarget, 'false') }, `${key}:if`)];
}

function variableEvent(command, variable, key) {
  if (command.operation === 'add' || command.operation === 'sub') return event('EVENT_VARIABLE_MATH', { vectorX: variable, operation: command.operation, other: 'val', value: Math.abs(Number(command.value) || 0), minValue: command.min, maxValue: command.max, clamp: true }, undefined, key);
  if (command.operation === 'random') return event('EVENT_VARIABLE_MATH', { vectorX: variable, operation: 'set', other: 'rnd', minValue: command.min, maxValue: command.max, clamp: false }, undefined, key);
  return event('EVENT_SET_VALUE', { variable, value: number(command.value) }, undefined, key);
}

function nestedSwitch(command, segment, mode, model, key, index = 0) {
  const branch = command.cases[index]; const variable = model.variables.ids[command.variableName]; const target = model.graph.labelTargets[`${segment.sourceSceneId}:${branch.targetLabel}`]; const defaultTarget = model.graph.labelTargets[`${segment.sourceSceneId}:${command.defaultLabel}`];
  const falseEvents = index + 1 < command.cases.length ? [nestedSwitch(command, segment, mode, model, key, index + 1)] : (defaultTarget ? [switchScene(defaultTarget, mode, '2', `${key}:default`)] : []);
  return event('EVENT_IF', { condition: condition(variable, 'eq', branch.value), __collapseElse: false }, { true: [switchScene(target, mode, '2', `${key}:case:${index}`)], false: falseEvents }, `${key}:case-if:${index}`);
}

function convertCommand(command, segment, mode, model, key) {
  if (command.type === 'background' || command.type === 'comment' || command.type === 'cache' || command.type === 'label') return [];
  if (command.type === 'message') return dialogueEvents(command, model, key);
  if (command.type === 'wait') return [event('EVENT_WAIT', { units: 'frames', frames: number(command.frames), time: number((Number(command.frames) || 0) / 60) }, undefined, key)];
  if (command.type === 'jump') return [switchScene(model.graph.firstTargets[command.sceneId], mode, '2', key)];
  if (command.type === 'goto') return [switchScene(model.graph.labelTargets[`${segment.sourceSceneId}:${command.targetLabel}`], mode, '2', key)];
  if (command.type === 'choice') return choiceEvents(command, segment, mode, model, key);
  if (command.type === 'variable') return [variableEvent(command, model.variables.ids[command.variableName], key)];
  if (command.type === 'if') { const variable = model.variables.ids[command.variableName]; const trueTarget = model.graph.labelTargets[`${segment.sourceSceneId}:${command.targetLabel}`]; const falseTarget = model.graph.labelTargets[`${segment.sourceSceneId}:${command.elseLabel}`]; return [event('EVENT_IF', { condition: condition(variable, command.operator, command.value), __collapseElse: false }, { true: trueTarget ? [switchScene(trueTarget, mode, '2', `${key}:true`)] : [], false: falseTarget ? [switchScene(falseTarget, mode, '2', `${key}:false`)] : [] }, key)]; }
  if (command.type === 'switch') return [nestedSwitch(command, segment, mode, model, key)];
  if (command.type === 'inputcheck') {
    const inputs = inputNames(command.buttons);
    if (command.mode === 'sync') { const target = model.graph.labelTargets[`${segment.sourceSceneId}:${command.targetLabel}`]; return [event('EVENT_AWAIT_INPUT', { input: inputs }, undefined, key), event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:remove-all`), ...(target ? [switchScene(target, mode, '2', `${key}:target`)] : [])]; }
    if (command.mode === 'cancel') return [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, key)];
    const target = model.graph.labelTargets[`${segment.sourceSceneId}:${command.targetLabel}`]; const children = target ? [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:remove-all`), switchScene(target, mode, '2', `${key}:target`)] : [];
    return [event('EVENT_SET_INPUT_SCRIPT', { input: inputs, override: true }, { true: children }, key)];
  }
  if (command.type === 'spritetext') {
    if (!command.text) return []; const page = model.font.assignments[command.gbUnitId]; const activeFont = fontId(page); return [event('EVENT_SET_FONT', { fontId: activeFont }, undefined, `${key}:font`), event('EVENT_TEXT_DRAW', { text: `!F:${activeFont}!${command.text}`, x: Math.max(0, Math.min(19, Math.floor((Number(command.x) || 0) / 12.8))), y: Math.max(0, Math.min(17, Math.floor((Number(command.y) || 0) / 12.45))), location: 'background' }, undefined, key)];
  }
  if (command.type === 'audio') {
    if (command.action === 'stop') return [event('EVENT_MUSIC_STOP', {}, undefined, key)];
    const target = mappedMusicAsset(command, model); if (target) return [event('EVENT_MUSIC_PLAY', { musicId: musicId(target) }, undefined, key)];
    const sound = soundEvent(soundSubstitution(command.assetId, model), key); return sound ? [sound] : [];
  }
  if (command.type === 'effect' && command.effect === 'shake') return [event('EVENT_CAMERA_SHAKE', { units: 'frames', frames: command.frames, time: (Number(command.frames) || 0) / 60, shakeDirection: 'diagonal', magnitude: number(command.intensity) }, undefined, key)];
  return [];
}

function convertRange(commands, start, segment, mode, model, keyPrefix) {
  const output = [];
  for (let index = start; index < commands.length; index += 1) {
    const command = commands[index]; const key = `${keyPrefix}:${index}`;
    if (command.type === 'inputcheck' && command.mode === 'async' && !command.targetLabel) {
      const continuation = targetlessAsyncContinuation(commands, index);
      if (continuation?.kind === 'wait') {
        const wait = commands[continuation.gateIndex]; let cancel = continuation.resumeIndex; if (commands[cancel]?.type !== 'inputcheck' || commands[cancel].mode !== 'cancel') cancel -= 1; const tail = convertRange(commands, cancel + 1, segment, mode, model, `${key}:tail`); const inputs = inputNames(command.buttons); const cleanup = event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:cleanup-all`); const child = [event('EVENT_TIMER_DISABLE', { timer: 1 }, undefined, `${key}:disable`), cleanup, ...tail]; output.push(event('EVENT_SET_INPUT_SCRIPT', { input: inputs, override: true }, { true: child }, `${key}:input`)); output.push(event('EVENT_SET_TIMER_SCRIPT', { timer: 1, units: 'frames', frames: wait.frames, duration: (Number(wait.frames) || 0) / 60 }, { true: [cleanup, ...tail] }, `${key}:timer`)); return output;
      }
      if (continuation?.kind === 'sync') {
        const tail = convertRange(commands, continuation.resumeIndex, segment, mode, model, `${key}:resume`); const inputs = inputNames(command.buttons); const child = [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:cleanup-all`), ...tail]; output.push(event('EVENT_SET_INPUT_SCRIPT', { input: inputs, override: true }, { true: child }, `${key}:input`));
        for (let cursor = index + 1; cursor < continuation.gateIndex; cursor += 1) output.push(...convertCommand(commands[cursor], segment, mode, model, `${key}:gate:${cursor}`));
        const gate = commands[continuation.gateIndex]; const gateInputs = inputNames(gate.buttons); const gateTarget = model.graph.labelTargets[`${segment.sourceSceneId}:${gate.targetLabel}`]; const gateTail = gateTarget ? [switchScene(gateTarget, mode, '2', `${key}:gate:target`)] : convertRange(commands, continuation.resumeIndex, segment, mode, model, `${key}:gate:resume`); const gateChild = [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:gate:cleanup-all`), ...gateTail]; output.push(event('EVENT_SET_INPUT_SCRIPT', { input: gateInputs, override: true }, { true: gateChild }, `${key}:gate:input`)); output.push(event('EVENT_IDLE', {}, undefined, `${key}:idle`)); return output;
      }
    }
    output.push(...convertCommand(command, segment, mode, model, key));
  }
  return output;
}

function sceneScript(segment, mode, model) {
  const output = [event('EVENT_ACTOR_DEACTIVATE', { actorId: 'player' }, undefined, `${mode}:${segment.key}:deactivate`), event('EVENT_TEXT_SET_ANIMATION_SPEED', { speedIn: -3, speedOut: -3, speed: 3, allowFastForward: true }, undefined, `${mode}:${segment.key}:speed`), ...convertRange(segment.commands, 0, segment, mode, model, `${mode}:${segment.key}`)];
  const terminal = output.at(-1)?.command === 'EVENT_SWITCH_SCENE' || output.at(-1)?.command === 'EVENT_IF' || output.at(-1)?.command === 'EVENT_SET_TIMER_SCRIPT' || output.at(-1)?.command === 'EVENT_IDLE';
  if (segment.nextKey && !terminal) { const target = model.graph.segments.find((item) => item.key === segment.nextKey); const speed = target?.transition === 'fade' ? Math.max(1, Math.min(5, Math.round((target.fadeFrames || 30) / 15))) : 0; output.push(switchScene(segment.nextKey, mode, String(speed), `${mode}:${segment.key}:next`)); }
  return output;
}

function makeSceneResource(segment, mode, model, index) { return { _resourceType: 'scene', id: modeSceneId(segment.key, mode), _index: index, type: mode === 'gbc' ? 'TOPDOWN' : 'ADVENTURE', name: `${segment.sourceName}${segment.label ? ` / ${segment.label}` : ''} [${mode.toUpperCase()}]`, symbol: `scene_${slug(`${segment.sourceSceneId}_${segment.label || segment.key}_${mode}`)}`, x: mode === 'gbc' ? 240 + (index % 8) * 240 : 240 + (index % 8) * 240, y: mode === 'gbc' ? Math.floor(index / 8) * 200 : 1200 + Math.floor(index / 8) * 200, width: 20, height: 18, backgroundId: backgroundId(segment.backgroundVariantKey, mode), tilesetId: '', colorModeOverride: mode === 'gbc' ? 'color' : 'mixed', paletteIds: [], spritePaletteIds: [], autoFadeSpeed: 2, script: sceneScript(segment, mode, model), playerHit1Script: [], playerHit2Script: [], playerHit3Script: [], collisions: '' };
}

function paletteResource(id, name, colors) { return { _resourceType: 'palette', id, name, colors, defaultName: name, defaultColors: colors }; }

function makeUiPng(kind) {
  const width = kind === 'frame' ? 24 : 8; const height = kind === 'frame' ? 24 : 8; const indices = new Uint8Array(width * height);
  if (kind === 'frame') for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) indices[y * width + x] = (x === 0 || y === 0 || x === width - 1 || y === height - 1) ? 3 : 0;
  else for (let y = 1; y < 7; y += 1) for (let x = 0; x <= Math.min(y - 1, 4); x += 1) indices[y * width + x] = 3;
  return encodeIndexedPng({ width, height, indices, palette: DMG_COLORS });
}

function makeStaticSprite(mode) {
  const indices = new Uint8Array(16 * 16); const png = encodeIndexedPng({ width: 16, height: 16, indices, palette: DMG_COLORS, alphaTable: [0, 255, 255, 255] });
  const animations = Array.from({ length: 8 }, (_, animationIndex) => ({ id: idFor('animation', `static:${mode}:${animationIndex}`), frames: [{ id: idFor('frame', `static:${mode}:${animationIndex}`), tiles: animationIndex === 0 ? [{ id: idFor('tile', `static:${mode}:0`), x: 0, y: 0, sliceX: 0, sliceY: 0, flipX: false, flipY: false, palette: 0, paletteIndex: 0, objPalette: 'OBP0', priority: false }, { id: idFor('tile', `static:${mode}:1`), x: 8, y: 0, sliceX: 8, sliceY: 0, flipX: false, flipY: false, palette: 0, paletteIndex: 0, objPalette: 'OBP0', priority: false }] : [] }] }));
  return { png, resource: { _resourceType: 'sprite', id: idFor('sprite', `static:${mode}`), name: `Static ${mode.toUpperCase()}`, symbol: `sprite_static_${mode}`, states: [{ id: idFor('state', `static:${mode}`), name: '', animationType: 'fixed', flipLeft: false, animations }], numTiles: 2, canvasOriginX: 0, canvasOriginY: 0, canvasWidth: 16, canvasHeight: 16, boundsX: 0, boundsY: -8, boundsWidth: 16, boundsHeight: 16, animSpeed: 15, filename: `static_${mode}.png`, width: 16, height: 16 }, id: idFor('sprite', `static:${mode}`) };
}

function makeSettings(model, staticSprites, startSceneId) {
  const defaultFontId = fontId(0); const player = { TOPDOWN: staticSprites.gbc, PLATFORM: staticSprites.dmg, ADVENTURE: staticSprites.dmg, SHMUP: staticSprites.dmg, POINTNCLICK: staticSprites.dmg, LOGO: staticSprites.dmg };
  return { _resourceType: 'settings', startSceneId, startX: 0, startY: 0, startMoveSpeed: 1, startAnimSpeed: 15, startDirection: 'down', showCollisionExtraTiles: false, showCollisionTileValues: false, collisionLayerOpacity: 50, sgbEnabled: false, customHead: '', defaultBackgroundPaletteIds: ['default-bg-1', 'default-bg-2', 'default-bg-3', 'default-bg-4', 'default-bg-5', 'default-bg-6', 'dmg', 'default-ui'], defaultSpritePaletteIds: Array(8).fill('default-sprite'), defaultSpritePaletteId: 'default-sprite', defaultUIPaletteId: 'default-ui', playerPaletteId: '', defaultMonoBGP: [0, 1, 2, 3], defaultMonoOBP0: [0, 1, 3], defaultMonoOBP1: [0, 2, 3], defaultFontId, defaultCharacterEncoding: '', defaultPlayerSprites: player, musicDriver: 'huge', cartType: 'mbc5', batterylessEnabled: false, customColorsWhite: 'E0F8CF', customColorsLight: '86C06C', customColorsDark: '306850', customColorsBlack: '071821', customControlsUp: ['ArrowUp', 'w'], customControlsDown: ['ArrowDown', 's'], customControlsLeft: ['ArrowLeft', 'a'], customControlsRight: ['ArrowRight', 'd'], customControlsA: ['Alt', 'z', 'j'], customControlsB: ['Control', 'k', 'x'], customControlsStart: ['Enter'], customControlsSelect: ['Shift'], colorMode: 'mixed', colorCorrection: 'default', generateDebugFilesEnabled: true, compilerPreset: 3000, scriptEventPresets: {}, scriptEventDefaultPresets: {}, runSceneSelectionOnly: false, spriteMode: '8x16', openBuildFolderOnExport: false, showRomUsageAfterBuild: true, romFilename: slug(model.project.romName || model.project.title || model.project.name || 'pce_vn_gb'), defaultSceneTypeId: 'ADVENTURE', disabledSceneTypeIds: [], autoTileFlipEnabled: true, webTemplate: '' };
}

function buildGbStudioFiles(model, backgrounds, music) {
  const files = new Map(); const projectName = String(model.project.title || model.project.name || 'PCE VN GB Studio'); const romName = slug(model.project.romName || projectName, 'pce_vn_gb'); const descriptor = `${romName}.gbsproj`; const staticGbc = makeStaticSprite('gbc'); const staticDmg = makeStaticSprite('dmg');
  files.set(descriptor, json({ _resourceType: 'project', name: projectName, author: String(model.project.author || ''), notes: 'Generated by pce-vn-gb-studio-exporter. Generator-owned project.', _version: '4.2.0', _release: '10' }));
  files.set('assets/sprites/static_gbc.png', staticGbc.png); files.set('assets/sprites/static_gbc.png.gbsres', json(staticGbc.resource)); files.set('assets/sprites/static_dmg.png', staticDmg.png); files.set('assets/sprites/static_dmg.png.gbsres', json(staticDmg.resource)); files.set('assets/ui/frame.png', makeUiPng('frame')); files.set('assets/ui/cursor.png', makeUiPng('cursor'));
  const paletteSpecs = [
    ['default-bg-1', 'Default BG 1', ['F8E8C8', 'D89048', 'A82820', '301850']], ['default-bg-2', 'Default BG 2', ['E0F8CF', '86C06C', '306850', '071821']], ['default-bg-3', 'Default BG 3', ['F8F8D8', 'D8B078', '786078', '181830']], ['default-bg-4', 'Default BG 4', ['F8E8E8', 'E89898', '885068', '281830']], ['default-bg-5', 'Default BG 5', ['E8F8F8', '88C8D8', '407088', '102038']], ['default-bg-6', 'Default BG 6', ['F8F0D0', 'B8C878', '587048', '182820']], ['dmg', 'DMG', ['E0F8CF', '86C06C', '306850', '071821']], ['default-ui', 'Default UI', ['E0F8CF', '86C06C', '306850', '071821']], ['default-sprite', 'Default Sprite', ['E0F8CF', '86C06C', '306850', '071821']]
  ];
  paletteSpecs.forEach(([id, name, colors]) => files.set(`project/palettes/${id}.gbsres`, json(paletteResource(id, name, colors))));
  model.font.pages.forEach((page) => { const filename = `pce-vn/page_${String(page.index + 1).padStart(2, '0')}.png`; const name = `PCE VN Font ${page.index + 1}`; files.set(`assets/fonts/${filename}`, page.png); files.set(`assets/fonts/${filename.replace(/\.png$/i, '.json')}`, json({ name, mapping: page.mapping })); files.set(`assets/fonts/${filename}.gbsres`, json({ _resourceType: 'font', id: fontId(page.index), name, symbol: `font_pce_vn_${page.index + 1}`, width: 128, height: 112, mapping: page.mapping, filename })); });
  for (const transformed of backgrounds.output) for (const mode of ['gbc', 'dmg']) { const safe = slug(transformed.key, 'background'); const filename = `pce-vn/${mode}/${safe}.png`; const converted = mode === 'gbc' ? transformed.gbc : transformed.dmg; files.set(`assets/backgrounds/${filename}`, encodeRgbaPng(converted.image)); files.set(`assets/backgrounds/${filename}.gbsres`, json({ _resourceType: 'background', id: backgroundId(transformed.key, mode), name: `${transformed.assetId || 'Blank'} ${mode.toUpperCase()}`, symbol: `background_${slug(`${transformed.key}_${mode}`)}`, tileColors: '', filename, width: 20, height: 18, imageWidth: 160, imageHeight: 144, autoColor: true })); }
  const dispatchKey = 'dispatcher-blank'; const blank = new Uint8Array(160 * 144 * 4); for (let i = 0; i < 160 * 144; i += 1) blank.set([224, 248, 207, 255], i * 4); files.set('assets/backgrounds/pce-vn/dispatcher.png', encodeRgbaPng({ width: 160, height: 144, rgba: blank })); files.set('assets/backgrounds/pce-vn/dispatcher.png.gbsres', json({ _resourceType: 'background', id: backgroundId(dispatchKey, 'mixed'), name: 'Device Dispatcher', symbol: 'background_device_dispatcher', tileColors: '', filename: 'pce-vn/dispatcher.png', width: 20, height: 18, imageWidth: 160, imageHeight: 144, autoColor: true }));
  for (const track of music.tracks) { const filename = `pce-vn/${slug(track.asset.id)}.mod`; files.set(`assets/music/${filename}`, track.buffer); files.set(`assets/music/${filename}.gbsres`, json({ _resourceType: 'music', id: musicId(track.asset.id), name: track.asset.name || track.asset.id, symbol: `music_${slug(track.asset.id)}`, settings: {}, filename, type: 'mod' })); }
  const startKey = model.graph.firstTargets[model.sceneDoc.startScene]; const dispatcherId = idFor('scene', 'device-dispatcher'); const dispatcher = { _resourceType: 'scene', id: dispatcherId, _index: 0, type: 'ADVENTURE', name: 'Device Dispatch', symbol: 'scene_device_dispatch', x: -240, y: 0, width: 20, height: 18, backgroundId: backgroundId(dispatchKey, 'mixed'), tilesetId: '', colorModeOverride: 'mixed', paletteIds: [], spritePaletteIds: [], autoFadeSpeed: 2, script: [event('EVENT_ACTOR_DEACTIVATE', { actorId: 'player' }, undefined, 'dispatcher:deactivate'), event('EVENT_IF_COLOR_SUPPORTED', { __collapseElse: false }, { true: [switchScene(startKey, 'gbc', '2', 'dispatcher:gbc')], false: [switchScene(startKey, 'dmg', '2', 'dispatcher:dmg')] }, 'dispatcher:if-color')], playerHit1Script: [], playerHit2Script: [], playerHit3Script: [], collisions: '' };
  files.set('project/scenes/device_dispatch/scene.gbsres', json(dispatcher)); let sceneIndex = 1;
  for (const mode of ['gbc', 'dmg']) for (const segment of model.graph.segments) { const folder = `${slug(segment.sourceSceneId)}_${String(segment.sourceIndex).padStart(3, '0')}_${mode}`; files.set(`project/scenes/${folder}/scene.gbsres`, json(makeSceneResource(segment, mode, model, sceneIndex++))); }
  files.set('project/settings.gbsres', json(makeSettings(model, { gbc: staticGbc.id, dmg: staticDmg.id }, dispatcherId))); files.set('project/variables.gbsres', json({ _resourceType: 'variables', variables: model.variables.names.map((name) => ({ id: model.variables.ids[name], name, symbol: `var_${slug(name)}` })), constants: [] }));
  const gbcSheet = makeContactSheet(backgrounds.output.map((entry) => ({ image: entry.gbc.image }))); const dmgSheet = makeContactSheet(backgrounds.output.map((entry) => ({ image: entry.dmg.image }))); files.set('build/qa/backgrounds-gbc.png', encodeRgbaPng(gbcSheet)); files.set('build/qa/backgrounds-dmg.png', encodeRgbaPng(dmgSheet)); files.set('build/qa/background-audit.json', json({ format: 'pce-vn-gb-studio-background-audit', version: 1, reservedUiPalette: 7, backgrounds: backgrounds.audits })); files.set('build/qa/music-audit.json', json({ format: 'pce-vn-gb-studio-music-audit', version: 1, tracks: music.audits }));
  const voicedMessages = []; for (const scene of model.sceneDoc.scenes || []) for (const [commandIndex, command] of (scene.commands || []).entries()) if (command.type === 'message' && command.voiceAssetId) voicedMessages.push({ sceneId: scene.id, commandIndex, voiceAssetId: command.voiceAssetId, speaker: String(command.speaker || ''), frequency: speakerToneFrequency(command.speaker), substitution: 'text-tone' });
  files.set('build/qa/conversion-audit.json', json({ format: 'pce-vn-gb-studio-conversion-audit', version: 1, cddaMappings: model.settings.cddaMappings || {}, manualAudioSubstitutions: model.settings.audioSubstitutions || {}, automaticVoiceSubstitutions: voicedMessages }));
  files.set('LICENSES/Misaki-Font.txt', fs.readFileSync(path.join(__dirname, 'third_party', 'misaki-font', 'LICENSE.txt')));
  files.set('README.md', Buffer.from(`# ${projectName}\n\nこのGB Studio ${model.gbStudio?.version || '4.3.2'}プロジェクトはpce-vn-gb-studio-exporterが生成しました。Color + Monochromeの単一ROMとして、起動時にGBC/DMG scene graphを選択します。\n\n- 生成物はexporter管理です。任意の既存GB Studioプロジェクトへのmergeには対応しません。\n- 背景監査: build/qa/background-audit.json\n- BGM監査: build/qa/music-audit.json\n- ダイアログ直前にGB Studio標準eventが既定frame tileを再転送します。\n`, 'utf-8'));
  return { files, descriptor, romName, stats: { scenes: model.graph.segments.length * 2 + 1, sourceScenes: model.sceneDoc.scenes.length, backgrounds: backgrounds.output.length * 2 + 1, fontPages: model.font.pages.length, music: music.tracks.length, variables: model.variables.names.length } };
}

module.exports = { DIALOGUE_FRAME_EVENT, backgroundId, buildConversionModel, buildGbStudioFiles, buildMusic, externalMusicAssetId, fontId, idFor, modeSceneId, slug, speakerToneFrequency, splitScenes, targetlessAsyncContinuation, transformBackgrounds, validateExternalMod };
