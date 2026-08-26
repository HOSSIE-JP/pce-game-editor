'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAssetSource } = require('./pce-asset-manager');
const { paginateDialogue, createFontPages } = require('./pce-vn-gb-studio-font');
const { adjustBackgroundImage, encodeIndexedPng, encodeRgbaPng, makeContactSheet, prepareBackground, quantizeDmg, quantizeGbc, readRgbaPng, DMG_COLORS } = require('./pce-vn-gb-studio-image');
const { convertPsgToMod } = require('./pce-vn-gb-studio-music');

const DIALOGUE_FRAME_EVENT = 'EVENT_SET_DIALOGUE_FRAME';
const PCE_VN_EVENT_MENU = 'PCE_VN_EVENT_MENU';
const PCE_VN_EVENT_RANDOM = 'PCE_VN_EVENT_RANDOM';
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

const METADATA_ONLY_COMMANDS = new Set(['comment', 'cache', 'label']);
function isExecutableCommand(command) { return Boolean(command && !METADATA_ONLY_COMMANDS.has(command.type)); }
function blockBackgroundKey(background) { return String(background?.assetId || 'blank'); }
function specializedBlockKey(originBlockKey, backgroundKey) { return `${originBlockKey}::bg_${crypto.createHash('sha256').update(String(backgroundKey || 'blank')).digest('hex').slice(0, 10)}`; }

function splitScenes(sceneDoc) {
  const segments = []; const firstTargets = {}; const labelTargets = {};
  for (const scene of sceneDoc.scenes || []) {
    let commands = []; let pendingPrefix = []; let segmentIndex = 0; const sceneSegments = [];
    const flush = () => {
      if (!commands.length) return null;
      const labels = commands.filter((command) => command?.type === 'label').map((command) => command.name).filter(Boolean);
      const background = commands.find((command) => command?.type === 'background') || null;
      const key = `${scene.id}::${segmentIndex++}`;
      const segment = { key, originBlockKey: key, sourceSceneId: scene.id, sourceName: scene.name || scene.id, sourceIndex: segments.length, originSourceIndex: segments.length, label: labels[0] || '', labels, fullScreen: Boolean(scene.fullScreenBg), background, commands, nextKey: '', transition: background?.transition || 'cut', fadeFrames: background?.fadeInFrames || 0, fallthrough: true, terminal: false, edges: [], reachable: false, hasExecutable: commands.some(isExecutableCommand) };
      commands = []; segments.push(segment); sceneSegments.push(segment); if (!firstTargets[scene.id]) firstTargets[scene.id] = key; labels.forEach((name) => { labelTargets[`${scene.id}:${name}`] = key; }); return segment;
    };
    const materializePrefix = () => { if (pendingPrefix.length) { commands.push(...pendingPrefix); pendingPrefix = []; } };
    for (const command of scene.commands || []) {
      if (command?.skip === true || command?.skipped === true || command?.debugSkip === true) continue;
      if (command?.type === 'comment' || command?.type === 'cache') { pendingPrefix.push(command); continue; }
      if (command?.type === 'label') {
        if (commands.some(isExecutableCommand)) flush();
        pendingPrefix.push(command); continue;
      }
      if (command?.type === 'background' && commands.some(isExecutableCommand)) flush();
      materializePrefix(); commands.push(command);
      if (['if', 'switch', 'jump', 'goto', 'choice'].includes(command?.type)) flush();
    }
    if (pendingPrefix.length) {
      if (pendingPrefix.some((command) => command?.type === 'label') || !sceneSegments.length || commands.length) materializePrefix();
      else { sceneSegments.at(-1).commands.push(...pendingPrefix); pendingPrefix = []; }
    }
    flush();
    if (!firstTargets[scene.id]) { const key = `${scene.id}::0`; const segment = { key, originBlockKey: key, sourceSceneId: scene.id, sourceName: scene.name || scene.id, sourceIndex: segments.length, originSourceIndex: segments.length, label: '', labels: [], fullScreen: Boolean(scene.fullScreenBg), background: null, commands: [], nextKey: '', transition: 'cut', fadeFrames: 0, fallthrough: true, terminal: false, edges: [], reachable: false, hasExecutable: false }; segments.push(segment); sceneSegments.push(segment); firstTargets[scene.id] = key; }
  }
  for (const scene of sceneDoc.scenes || []) {
    const own = segments.filter((segment) => segment.sourceSceneId === scene.id);
    own.forEach((segment, index) => { segment.nextKey = own[index + 1]?.key || (scene.nextSceneId ? firstTargets[scene.nextSceneId] || '' : ''); });
  }
  return specializeBackgroundStates(analyzeControlFlow({ segments, firstTargets, labelTargets }, sceneDoc), sceneDoc);
}

function analyzeControlFlow(graph, sceneDoc) {
  const byKey = new Map(graph.segments.map((segment) => [segment.key, segment])); const incoming = new Map(graph.segments.map((segment) => [segment.key, 0]));
  const addEdge = (segment, target, kind) => { if (!target || !byKey.has(target)) return; if (!segment.edges.some((edge) => edge.target === target && edge.kind === kind)) segment.edges.push({ target, kind }); };
  for (const segment of graph.segments) {
    segment.edges = [];
    const command = [...segment.commands].reverse().find((item) => item && !['background', 'label', 'comment', 'cache'].includes(item.type));
    segment.fallthrough = true; segment.terminal = false;
    if (command?.type === 'jump') { addEdge(segment, graph.firstTargets[command.sceneId], 'jump'); segment.fallthrough = false; }
    else if (command?.type === 'goto') { addEdge(segment, graph.labelTargets[`${segment.sourceSceneId}:${command.targetLabel}`], 'goto'); segment.fallthrough = false; }
    else if (command?.type === 'choice') { for (const choice of command.choices || []) addEdge(segment, graph.firstTargets[choice.targetSceneId], 'choice'); segment.fallthrough = false; }
    else if (command?.type === 'if') {
      addEdge(segment, graph.labelTargets[`${segment.sourceSceneId}:${command.targetLabel}`], 'if-true');
      if (command.elseLabel) { addEdge(segment, graph.labelTargets[`${segment.sourceSceneId}:${command.elseLabel}`], 'if-false'); segment.fallthrough = false; }
    } else if (command?.type === 'switch') {
      for (const branch of command.cases || []) addEdge(segment, graph.labelTargets[`${segment.sourceSceneId}:${branch.targetLabel}`], 'switch-case');
      if (command.defaultLabel) { addEdge(segment, graph.labelTargets[`${segment.sourceSceneId}:${command.defaultLabel}`], 'switch-default'); segment.fallthrough = false; }
    }
    for (const item of segment.commands) if (item?.type === 'inputcheck' && item.targetLabel) addEdge(segment, graph.labelTargets[`${segment.sourceSceneId}:${item.targetLabel}`], `input-${item.mode}`);
    if (segment.fallthrough && segment.nextKey) addEdge(segment, segment.nextKey, 'fallthrough');
    segment.terminal = !segment.fallthrough || (!segment.nextKey && segment.edges.length === 0);
    for (const edge of segment.edges) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  }
  const startKey = graph.firstTargets[sceneDoc.startScene]; const pending = startKey ? [startKey] : []; const reachable = new Set();
  while (pending.length) { const key = pending.shift(); if (reachable.has(key)) continue; reachable.add(key); for (const edge of byKey.get(key)?.edges || []) if (!reachable.has(edge.target)) pending.push(edge.target); }
  graph.segments.forEach((segment) => { segment.reachable = reachable.has(segment.key); });
  const loops = []; const visiting = new Set(); const visited = new Set();
  const walk = (key, trail) => { if (visiting.has(key)) { const at = trail.indexOf(key); loops.push(trail.slice(at).concat(key)); return; } if (visited.has(key)) return; visiting.add(key); const nextTrail = [...trail, key]; for (const edge of byKey.get(key)?.edges || []) walk(edge.target, nextTrail); visiting.delete(key); visited.add(key); };
  if (startKey) walk(startKey, []);
  const joins = graph.segments.filter((segment) => (incoming.get(segment.key) || 0) > 1).map((segment) => ({ key: segment.key, incoming: incoming.get(segment.key) }));
  for (const segment of graph.segments) if (!visited.has(segment.key)) walk(segment.key, []);
  return { ...graph, startKey, reachable: [...reachable], unreachable: graph.segments.filter((segment) => !segment.reachable && segment.hasExecutable).map((segment) => segment.key), unreachableAll: graph.segments.filter((segment) => !segment.reachable).map((segment) => segment.key), joins, loops, incoming: Object.fromEntries(incoming) };
}

function specializeBackgroundStates(baseGraph, sceneDoc) {
  const baseByKey = new Map(baseGraph.segments.map((segment) => [segment.key, segment])); const specialized = []; const byPair = new Map(); const processed = new Set();
  const ensure = (originBlockKey, incomingBackgroundKey, reachable, fallbackRoot = false) => {
    const base = baseByKey.get(originBlockKey); if (!base) return null;
    const incoming = String(incomingBackgroundKey || 'blank'); const effective = base.background ? blockBackgroundKey(base.background) : incoming; const identity = base.background ? effective : incoming; const pair = `${originBlockKey}\0${identity}`;
    if (byPair.has(pair)) { const existing = byPair.get(pair); if (!existing.entryBackgroundKeys.includes(incoming)) existing.entryBackgroundKeys.push(incoming); if (reachable) existing.reachable = true; return existing; }
    const key = specializedBlockKey(originBlockKey, identity); const inherited = effective === 'blank' ? null : { type: 'background', assetId: effective, inherited: true };
    const backgroundSource = base.background ? 'explicit' : (fallbackRoot ? 'unreachable-fallback' : (effective === 'blank' ? 'blank' : 'inherited'));
    const segment = { ...base, key, originBlockKey, sourceIndex: specialized.length, entryBackgroundKey: incoming, entryBackgroundKeys: [incoming], effectiveBackgroundKey: effective, backgroundSource, background: base.background || inherited, transition: base.background?.transition || 'cut', fadeFrames: base.background?.fadeInFrames || 0, edges: [], nextKey: '', targetMap: {}, reachable: Boolean(reachable) };
    byPair.set(pair, segment); specialized.push(segment); return segment;
  };
  const traverse = (seeds, reachable) => {
    const queue = [...seeds];
    while (queue.length) {
      const item = queue.shift(); const segment = ensure(item.originBlockKey, item.incomingBackgroundKey, reachable, item.fallbackRoot); if (!segment) continue;
      const processKey = `${segment.key}\0${reachable ? 'r' : 'u'}`; if (processed.has(processKey)) continue; processed.add(processKey);
      const base = baseByKey.get(segment.originBlockKey); const effective = segment.effectiveBackgroundKey;
      for (const edge of base.edges || []) {
        const target = ensure(edge.target, effective, reachable, false); if (!target) continue;
        segment.targetMap[edge.target] = target.key; if (!segment.edges.some((candidate) => candidate.target === target.key && candidate.kind === edge.kind)) segment.edges.push({ target: target.key, kind: edge.kind, originTarget: edge.target });
        queue.push({ originBlockKey: edge.target, incomingBackgroundKey: effective, fallbackRoot: false });
      }
      if (base.nextKey && base.fallthrough) segment.nextKey = segment.targetMap[base.nextKey] || '';
    }
  };
  if (baseGraph.startKey) traverse([{ originBlockKey: baseGraph.startKey, incomingBackgroundKey: 'blank', fallbackRoot: false }], true);
  const lexicalBackground = new Map();
  for (const scene of sceneDoc.scenes || []) { let current = 'blank'; for (const segment of baseGraph.segments.filter((entry) => entry.sourceSceneId === scene.id)) { lexicalBackground.set(segment.key, current); if (segment.background) current = blockBackgroundKey(segment.background); } }
  for (const key of baseGraph.unreachable) if (!specialized.some((segment) => segment.originBlockKey === key)) traverse([{ originBlockKey: key, incomingBackgroundKey: lexicalBackground.get(key) || 'blank', fallbackRoot: true }], false);
  specialized.forEach((segment, index) => { segment.sourceIndex = index; });
  const incoming = new Map(specialized.map((segment) => [segment.key, 0])); specialized.forEach((segment) => segment.edges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)));
  const visiting = new Set(); const visited = new Set(); const loops = [];
  const specializedByKey = new Map(specialized.map((segment) => [segment.key, segment]));
  const walk = (key, trail) => { if (visiting.has(key)) { const at = trail.indexOf(key); loops.push(trail.slice(at).concat(key)); return; } if (visited.has(key)) return; visiting.add(key); const nextTrail = [...trail, key]; for (const edge of specializedByKey.get(key)?.edges || []) walk(edge.target, nextTrail); visiting.delete(key); visited.add(key); };
  const start = specialized.find((segment) => segment.originBlockKey === baseGraph.startKey && segment.reachable); if (start) walk(start.key, []); specialized.forEach((segment) => { if (!visited.has(segment.key)) walk(segment.key, []); });
  const firstTargets = {}; for (const [sceneId, origin] of Object.entries(baseGraph.firstTargets)) { const match = specialized.find((segment) => segment.originBlockKey === origin && segment.reachable) || specialized.find((segment) => segment.originBlockKey === origin); if (match) firstTargets[sceneId] = match.key; }
  const labelTargets = {}; for (const [label, origin] of Object.entries(baseGraph.labelTargets)) { const match = specialized.find((segment) => segment.originBlockKey === origin && segment.reachable) || specialized.find((segment) => segment.originBlockKey === origin); if (match) labelTargets[label] = match.key; }
  return { segments: specialized, firstTargets, labelTargets, baseSegments: baseGraph.segments, baseFirstTargets: baseGraph.firstTargets, baseLabelTargets: baseGraph.labelTargets, startKey: start?.key || '', reachable: specialized.filter((segment) => segment.reachable).map((segment) => segment.key), unreachable: baseGraph.unreachable, unreachableSpecialized: specialized.filter((segment) => !segment.reachable).map((segment) => segment.key), joins: specialized.filter((segment) => (incoming.get(segment.key) || 0) > 1).map((segment) => ({ key: segment.key, originBlockKey: segment.originBlockKey, incoming: incoming.get(segment.key) })), loops, incoming: Object.fromEntries(incoming) };
}

function collectVariables(sceneDoc) {
  const names = []; const seen = new Set(); const defined = new Set(); const initialValues = {};
  const add = (name) => { const value = String(name || '').trim(); if (value && !seen.has(value)) { seen.add(value); names.push(value); } };
  let hasChoice = false;
  for (const scene of sceneDoc.scenes || []) for (const command of scene.commands || []) {
    if (command?.skip) continue; add(command.variableName); if (command.type === 'choice') hasChoice = true;
    if (command.type === 'variable' && command.operation === 'define' && command.variableName && !defined.has(command.variableName)) { defined.add(command.variableName); initialValues[command.variableName] = Number(command.value) || 0; }
  }
  const choiceScratchName = hasChoice ? '__pce_vn_choice_result' : ''; if (choiceScratchName) add(choiceScratchName);
  if (names.length > 512) { const error = new Error(`GB Studio variable上限512を超えています: ${names.length}`); error.code = 'GBVN_VARIABLE_LIMIT'; throw error; }
  const ids = Object.fromEntries(names.map((name, index) => [name, String(index)]));
  return { names, ids, initialValues: Object.fromEntries(names.map((name) => [name, initialValues[name] || 0])), choiceScratchName, choiceScratchId: choiceScratchName ? ids[choiceScratchName] : '' };
}

function wrapChoiceLabel(value, width = 16) {
  const chars = Array.from(String(value || '').normalize('NFC')); const lines = []; const breaks = new Set(Array.from(' 　、。，．！？!?）」』】〕〉》・：；:;'));
  while (chars.length > width) {
    let take = width; for (let index = width - 1; index >= Math.ceil(width / 2); index -= 1) if (breaks.has(chars[index])) { take = index + 1; break; }
    lines.push(chars.splice(0, take).join(''));
  }
  lines.push(chars.join('')); return lines.join('\n');
}

function makeTextUnits(graph) {
  const units = []; const seenObjects = new WeakSet(); const seenKeys = new Set();
  graph.segments.forEach((segment) => segment.commands.forEach((command, commandIndex) => {
    const sourceKey = command?._gbvnSource?.key || `${segment.originBlockKey || segment.key}:${commandIndex}`;
    if ((command && seenObjects.has(command)) || seenKeys.has(sourceKey)) return;
    if (command) seenObjects.add(command); seenKeys.add(sourceKey);
    if (command.type === 'message') {
      command.gbPages = paginateDialogue(command).map((page, pageIndex) => { const id = `${sourceKey}:message:${pageIndex}`; units.push({ id, text: page.text }); return { ...page, unitId: id }; });
    } else if (command.type === 'choice') { const id = `${sourceKey}:choice`; command.gbUnitId = id; command.gbWrappedChoices = (command.choices || []).map((choice) => wrapChoiceLabel(choice.label)); units.push({ id, text: command.gbWrappedChoices.join('\n') }); }
    else if (command.type === 'spritetext' && command.text) { const id = `${sourceKey}:spritetext`; command.gbUnitId = id; units.push({ id, text: command.text }); }
  }));
  return units;
}

function buildConversionModel({ projectDir, project, rawDoc, sceneDoc, assetDoc, settings, gbStudio, sourceInventory }) {
  const graph = splitScenes(sceneDoc); const variables = collectVariables(sceneDoc); const textUnits = makeTextUnits(graph); const font = createFontPages(textUnits, { projectDir, font: settings.font }); const assetsById = new Map((assetDoc.assets || []).map((asset) => [asset.id, asset]));
  for (const segment of graph.segments) for (const command of segment.commands) if (command?._gbvnSource) { const entry = sourceInventory?.byKey?.get(command._gbvnSource.key); if (entry) { entry.reachable = Boolean(entry.reachable || segment.reachable); entry.segmentKeys = entry.segmentKeys || []; if (!entry.segmentKeys.includes(segment.key)) entry.segmentKeys.push(segment.key); entry.segmentKey = entry.segmentKeys[0]; if (['background', 'label', 'comment', 'cache'].includes(command.type)) entry.disposition = 'generated-metadata'; } }
  const backgroundVariants = []; const seenBackgrounds = new Set();
  graph.segments.forEach((segment) => { const assetId = segment.effectiveBackgroundKey === 'blank' ? '' : segment.effectiveBackgroundKey; const key = `${assetId || 'blank'}:${segment.fullScreen ? 'fullscreen' : 'dialogue'}`; segment.backgroundVariantKey = key; if (!seenBackgrounds.has(key)) { seenBackgrounds.add(key); backgroundVariants.push({ key, assetId, fullScreen: segment.fullScreen }); } });
  const musicAssetIds = new Set(); const externalMusicById = new Map();
  for (const segment of graph.segments) for (const command of segment.commands) if (command.type === 'audio' && command.action === 'play') {
    if (command.kind === 'psg' && assetsById.get(command.assetId)?.type === 'psg-song') musicAssetIds.add(command.assetId);
    if (command.kind === 'cdda') { const mapping = settings.cddaMappings?.[command.assetId]; if (typeof mapping === 'string' || mapping?.type === 'psg-song' || mapping?.targetAssetId) musicAssetIds.add(typeof mapping === 'string' ? mapping : mapping.targetAssetId); else if (mapping?.type === 'external-mod' && mapping.source) { const id = externalMusicAssetId(command.assetId); const sourcePath = path.isAbsolute(mapping.source) ? path.resolve(mapping.source) : path.resolve(projectDir, mapping.source); externalMusicById.set(id, { id, sourceCddaAssetId: command.assetId, name: mapping.name || `${assetsById.get(command.assetId)?.name || command.assetId} (External MOD)`, sourcePath }); } }
  }
  const music = [...musicAssetIds].filter((id) => assetsById.get(id)?.type === 'psg-song').map((id) => assetsById.get(id));
  return { projectDir, project, rawDoc, sceneDoc, assetDoc, assetsById, settings, gbStudio, graph, variables, textUnits, font, backgroundVariants, music, externalMusic: [...externalMusicById.values()], sourceInventory };
}

function pngHash(image) { return crypto.createHash('sha256').update(encodeRgbaPng(image)).digest('hex'); }

function transformBackgroundVariant(model, variant) {
  let sourceImage; let sourceHash;
  const adjustment = model.settings.backgrounds?.[variant.assetId] || {};
  if (!variant.assetId) {
    const rgba = new Uint8Array(160 * 144 * 4); for (let i = 0; i < 160 * 144; i += 1) rgba.set([224, 248, 207, 255], i * 4); sourceImage = { width: 160, height: 144, rgba }; sourceHash = pngHash(sourceImage);
  } else {
    const asset = model.assetsById.get(variant.assetId); const source = asset && resolveAssetSource(model.projectDir, asset).absPath; if (!source || !fs.existsSync(source)) throw new Error(`背景素材が見つかりません: ${variant.assetId}`); if (path.extname(source).toLowerCase() !== '.png') { const error = new Error(`背景入力はPNGのみです: ${variant.assetId}`); error.code = 'GBVN_UNRESOLVED_ASSET'; throw error; }
    const sourceBuffer = fs.readFileSync(source); sourceImage = readRgbaPng(sourceBuffer); sourceHash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
  }
  const preparedBase = variant.assetId ? prepareBackground(sourceImage, { fullScreen: variant.fullScreen, focusX: adjustment.focusX, focusY: adjustment.focusY }) : sourceImage;
  const artworkHeight = variant.fullScreen ? 144 : 96;
  const prepared = adjustBackgroundImage(preparedBase, { brightness: adjustment.brightness, saturation: adjustment.saturation, artworkHeight });
  const gbc = quantizeGbc(prepared, { maxPalettes: 7, dither: Boolean(adjustment.gbcDither), ditherHeight: artworkHeight });
  const dmg = quantizeDmg(prepared, { fullScreen: variant.fullScreen, analysisHeight: artworkHeight, tileLimit: 192, dither: Boolean(adjustment.dmgDither) });
  const hashes = { source: sourceHash, prepared: pngHash(prepared), gbc: pngHash(gbc.image), dmg: pngHash(dmg.image) };
  const normalizedSettings = { brightness: Math.max(-100, Math.min(100, Number(adjustment.brightness) || 0)), saturation: Math.max(0, Math.min(200, Number.isFinite(Number(adjustment.saturation)) ? Number(adjustment.saturation) : 100)), gbcDither: Boolean(adjustment.gbcDither), dmgDither: Boolean(adjustment.dmgDither), focusX: Number.isFinite(Number(adjustment.focusX)) ? Math.max(0, Math.min(1, Number(adjustment.focusX))) : 0.5, focusY: Number.isFinite(Number(adjustment.focusY)) ? Math.max(0, Math.min(1, Number(adjustment.focusY))) : 0.5 };
  return { ...variant, sourceImage, prepared, gbc, dmg, settings: normalizedSettings, hashes, audit: { key: variant.key, assetId: variant.assetId, fullScreen: variant.fullScreen, artworkHeight, settings: normalizedSettings, hashes, gbc: gbc.audit, dmg: dmg.audit } };
}

function transformBackgrounds(model) {
  const output = model.backgroundVariants.map((variant) => transformBackgroundVariant(model, variant));
  return { output, audits: output.map((entry) => entry.audit) };
}

function validateExternalMod(buffer, label = 'External MOD') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1084) throw new Error(`${label}: MOD fileが短すぎます`); const signature = buffer.subarray(1080, 1084).toString('ascii'); if (!['M.K.', 'M!K!', '4CHN', 'FLT4'].includes(signature)) throw new Error(`${label}: GB Studio hUGE用4ch ProTracker MOD signatureではありません: ${signature}`); const songLength = buffer[950]; if (songLength < 1 || songLength > 128) throw new Error(`${label}: MOD song lengthが不正です: ${songLength}`); return { signature, songLength, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

function buildMusic(model) { const tracks = model.music.map((asset) => ({ asset, ...convertPsgToMod(asset, model.settings.music?.[asset.id]) })); for (const external of model.externalMusic || []) { const buffer = fs.readFileSync(external.sourcePath); const metadata = validateExternalMod(buffer, external.name); tracks.push({ asset: { id: external.id, name: external.name }, buffer, audit: { assetId: external.id, sourceCddaAssetId: external.sourceCddaAssetId, sourceType: 'external-mod', status: 'exact', settings: null, sourceHash: metadata.sha256, outputHash: metadata.sha256, sourceBpm: null, sourceSteps: null, sourceLoopPoint: null, mappedEvents: [], droppedEvents: [], transposedEvents: [], controlConflicts: [], timingErrorRows: 0, output: metadata } }); } return { tracks, audits: tracks.map((track) => track.audit) }; }

function modeSceneId(segmentKey, mode) { return idFor('scene', `${mode}:${segmentKey}`); }
function backgroundId(variantKey, mode) { return idFor('background', `${mode}:${variantKey}`); }
function fontId(pageIndex) { return idFor('font', `page:${pageIndex}`); }
function musicId(assetId) { return idFor('music', assetId); }
function externalMusicAssetId(cddaAssetId) { return `external-mod:${cddaAssetId}`; }

function switchScene(targetKey, mode, fadeSpeed = '2', key = targetKey) { return event('EVENT_SWITCH_SCENE', { sceneId: modeSceneId(targetKey, mode), x: number(0), y: number(0), direction: '', fadeSpeed: String(fadeSpeed) }, undefined, `switch:${mode}:${key}`); }
function resolveOriginTarget(segment, originTarget, model) {
  if (!originTarget) return '';
  const direct = segment.targetMap?.[originTarget]; if (direct) return direct;
  const exact = model.graph.segments.find((candidate) => candidate.originBlockKey === originTarget && candidate.entryBackgroundKeys?.includes(segment.effectiveBackgroundKey));
  return exact?.key || model.graph.segments.find((candidate) => candidate.originBlockKey === originTarget)?.key || '';
}
function sceneTarget(segment, sceneId, model) { return resolveOriginTarget(segment, model.graph.baseFirstTargets?.[sceneId], model); }
function labelTarget(segment, label, model) { return label ? resolveOriginTarget(segment, model.graph.baseLabelTargets?.[`${segment.sourceSceneId}:${label}`], model) : ''; }
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
  const choices = command.choices || []; const scratch = model.variables.choiceScratchId; const sourceVariable = command.variableName ? model.variables.ids[command.variableName] : ''; const page = model.font.assignments[command.gbUnitId]; const activeFont = fontId(page);
  const branch = (choice, index) => [...(sourceVariable ? [event('EVENT_SET_VALUE', { variable: sourceVariable, value: number(choice.value) }, undefined, `${key}:set:${index}`)] : []), switchScene(sceneTarget(segment, choice.targetSceneId, model), mode, '2', `${key}:target:${index}`)];
  const selectBranch = (index = 0) => {
    if (index >= choices.length - 1) return branch(choices[index], index);
    return [event('EVENT_IF', { condition: condition(scratch, 'eq', index + 1), __collapseElse: false }, { true: branch(choices[index], index), false: selectBranch(index + 1) }, `${key}:if:${index}`)];
  };
  const args = { variable: scratch, items: choices.length };
  (command.gbWrappedChoices || choices.map((choice) => choice.label)).forEach((label, index) => { args[`option${index + 1}`] = `!F:${activeFont}!${label}`; });
  return [event('EVENT_SET_FONT', { fontId: activeFont }, undefined, `${key}:font`), event(DIALOGUE_FRAME_EVENT, { tilesetId: '' }, undefined, `${key}:frame`), event('EVENT_SET_VALUE', { variable: scratch, value: number((Number(command.defaultIndex) || 0) + 1) }, undefined, `${key}:default`), event(PCE_VN_EVENT_MENU, args, undefined, `${key}:menu`), ...selectBranch()];
}

function variableEvent(command, variable, key) {
  if (command.operation === 'add' || command.operation === 'sub') {
    const value = Number(command.value) || 0; const delta = command.operation === 'add' ? value : -value; const math = event('EVENT_VARIABLE_MATH', { vectorX: variable, operation: command.operation, other: 'val', value, minValue: -32768, maxValue: 32767, clamp: false }, undefined, `${key}:math`);
    if (!delta) return math;
    const upper = delta > 0; const threshold = upper ? 32767 - delta : -32768 - delta; const boundary = upper ? 32767 : -32768;
    return event('EVENT_IF', { condition: condition(variable, upper ? 'gt' : 'lt', threshold), __collapseElse: false }, { true: [event('EVENT_SET_VALUE', { variable, value: number(boundary) }, undefined, `${key}:clamp`)], false: [math] }, key);
  }
  if (command.operation === 'random') { const min = Math.min(command.min, command.max); const max = Math.max(command.min, command.max); return event(PCE_VN_EVENT_RANDOM, { variable, min, range: Math.min(65535, max - min + 1) }, undefined, key); }
  return event('EVENT_SET_VALUE', { variable, value: number(command.value) }, undefined, key);
}

function nestedSwitch(command, segment, mode, model, key, index = 0) {
  const branch = command.cases[index]; const variable = model.variables.ids[command.variableName]; const target = labelTarget(segment, branch.targetLabel, model); const defaultTarget = labelTarget(segment, command.defaultLabel, model);
  const falseEvents = index + 1 < command.cases.length ? [nestedSwitch(command, segment, mode, model, key, index + 1)] : (defaultTarget ? [switchScene(defaultTarget, mode, '2', `${key}:default`)] : []);
  return event('EVENT_IF', { condition: condition(variable, 'eq', branch.value), __collapseElse: false }, { true: [switchScene(target, mode, '2', `${key}:case:${index}`)], false: falseEvents }, `${key}:case-if:${index}`);
}

function convertCommandCore(command, segment, mode, model, key) {
  if (command.type === 'background' || command.type === 'comment' || command.type === 'cache' || command.type === 'label') return [];
  if (command.type === 'message') return dialogueEvents(command, model, key);
  if (command.type === 'wait') return [event('EVENT_WAIT', { units: 'frames', frames: number(command.frames), time: number((Number(command.frames) || 0) / 60) }, undefined, key)];
  if (command.type === 'jump') return [switchScene(sceneTarget(segment, command.sceneId, model), mode, '2', key)];
  if (command.type === 'goto') return [switchScene(labelTarget(segment, command.targetLabel, model), mode, '2', key)];
  if (command.type === 'choice') return choiceEvents(command, segment, mode, model, key);
  if (command.type === 'variable') return [variableEvent(command, model.variables.ids[command.variableName], key)];
  if (command.type === 'if') { const variable = model.variables.ids[command.variableName]; const trueTarget = labelTarget(segment, command.targetLabel, model); const falseTarget = labelTarget(segment, command.elseLabel, model); return [event('EVENT_IF', { condition: condition(variable, command.operator, command.value), __collapseElse: false }, { true: trueTarget ? [switchScene(trueTarget, mode, '2', `${key}:true`)] : [], false: falseTarget ? [switchScene(falseTarget, mode, '2', `${key}:false`)] : [] }, key)]; }
  if (command.type === 'switch') return [nestedSwitch(command, segment, mode, model, key)];
  if (command.type === 'inputcheck') {
    const inputs = inputNames(command.buttons);
    if (command.mode === 'sync') { const target = labelTarget(segment, command.targetLabel, model); return [event('EVENT_AWAIT_INPUT', { input: inputs }, undefined, key), event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:remove-all`), ...(target ? [switchScene(target, mode, '2', `${key}:target`)] : [])]; }
    if (command.mode === 'cancel') return [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, key)];
    const target = labelTarget(segment, command.targetLabel, model); const children = target ? [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:remove-all`), switchScene(target, mode, '2', `${key}:target`)] : [];
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

function flattenEventIds(events, output = []) { for (const item of events || []) { if (item?.id) output.push(item.id); for (const children of Object.values(item?.children || {})) flattenEventIds(children, output); } return output; }

function recordCommandEvents(command, segment, mode, model, events, disposition = '') {
  const source = command?._gbvnSource; const entry = source && model.sourceInventory?.byKey?.get(source.key); if (!entry) return;
  const generated = entry.generated[mode]; const sceneId = modeSceneId(segment.key, mode); if (!generated.sceneIds.includes(sceneId)) generated.sceneIds.push(sceneId);
  for (const id of flattenEventIds(events)) if (!generated.eventIds.includes(id)) generated.eventIds.push(id);
  if (disposition) entry.disposition = disposition;
  else if (generated.eventIds.length) entry.disposition = 'generated';
  else if (['background', 'label', 'comment', 'cache'].includes(command.type) || (command.type === 'spritetext' && !command.text)) entry.disposition = 'generated-metadata';
  else if (command.type === 'sprite' || command.type === 'spritemove' || (command.type === 'effect' && command.effect !== 'shake') || command.type === 'audio') entry.disposition = 'omitted-confirmed';
}

function convertCommand(command, segment, mode, model, key) {
  const events = convertCommandCore(command, segment, mode, model, key); recordCommandEvents(command, segment, mode, model, events); return events;
}

function convertRange(commands, start, segment, mode, model, keyPrefix) {
  const output = [];
  for (let index = start; index < commands.length; index += 1) {
    const command = commands[index]; const key = `${keyPrefix}:${index}`;
    if (command.type === 'inputcheck' && command.mode === 'async' && !command.targetLabel) {
      const continuation = targetlessAsyncContinuation(commands, index);
      if (continuation?.kind === 'wait') {
        const wait = commands[continuation.gateIndex]; let cancel = continuation.resumeIndex; if (commands[cancel]?.type !== 'inputcheck' || commands[cancel].mode !== 'cancel') cancel -= 1; const inputTail = convertRange(commands, cancel + 1, segment, mode, model, `${key}:input-tail`); const timerTail = convertRange(commands, cancel + 1, segment, mode, model, `${key}:timer-tail`); const inputs = inputNames(command.buttons); const inputCleanup = event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:input-cleanup-all`); const timerCleanup = event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:timer-cleanup-all`); const child = [event('EVENT_TIMER_DISABLE', { timer: 1 }, undefined, `${key}:disable`), inputCleanup, ...inputTail]; const inputEvent = event('EVENT_SET_INPUT_SCRIPT', { input: inputs, override: true }, { true: child }, `${key}:input`); const timerEvent = event('EVENT_SET_TIMER_SCRIPT', { timer: 1, units: 'frames', frames: wait.frames, duration: (Number(wait.frames) || 0) / 60 }, { true: [timerCleanup, ...timerTail] }, `${key}:timer`);
        output.push(inputEvent, timerEvent); recordCommandEvents(command, segment, mode, model, [inputEvent]); recordCommandEvents(wait, segment, mode, model, [timerEvent]); if (commands[cancel]?.type === 'inputcheck' && commands[cancel].mode === 'cancel') recordCommandEvents(commands[cancel], segment, mode, model, [inputCleanup, timerCleanup]); return output;
      }
      if (continuation?.kind === 'sync') {
        const tail = convertRange(commands, continuation.resumeIndex, segment, mode, model, `${key}:resume`); const inputs = inputNames(command.buttons); const child = [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:cleanup-all`), ...tail]; output.push(event('EVENT_SET_INPUT_SCRIPT', { input: inputs, override: true }, { true: child }, `${key}:input`));
        for (let cursor = index + 1; cursor < continuation.gateIndex; cursor += 1) output.push(...convertCommand(commands[cursor], segment, mode, model, `${key}:gate:${cursor}`));
        const gate = commands[continuation.gateIndex]; const gateInputs = inputNames(gate.buttons); const gateTarget = labelTarget(segment, gate.targetLabel, model); const gateTail = gateTarget ? [switchScene(gateTarget, mode, '2', `${key}:gate:target`)] : convertRange(commands, continuation.resumeIndex, segment, mode, model, `${key}:gate:resume`); const gateChild = [event('EVENT_REMOVE_INPUT_SCRIPT', { input: ALL_INPUTS }, undefined, `${key}:gate:cleanup-all`), ...gateTail]; const outerInput = output[0]; const gateInput = event('EVENT_SET_INPUT_SCRIPT', { input: gateInputs, override: true }, { true: gateChild }, `${key}:gate:input`); output.push(gateInput); output.push(event('EVENT_IDLE', {}, undefined, `${key}:idle`)); recordCommandEvents(command, segment, mode, model, [outerInput]); recordCommandEvents(gate, segment, mode, model, [gateInput]); return output;
      }
    }
    output.push(...convertCommand(command, segment, mode, model, key));
  }
  return output;
}

function sceneScript(segment, mode, model) {
  const output = [event('EVENT_ACTOR_DEACTIVATE', { actorId: 'player' }, undefined, `${mode}:${segment.key}:deactivate`), event('EVENT_TEXT_SET_ANIMATION_SPEED', { speedIn: -3, speedOut: -3, speed: 3, allowFastForward: true }, undefined, `${mode}:${segment.key}:speed`), ...convertRange(segment.commands, 0, segment, mode, model, `${mode}:${segment.key}`)];
  if (segment.nextKey && segment.fallthrough) { const target = model.graph.segments.find((item) => item.key === segment.nextKey); const speed = target?.transition === 'fade' ? Math.max(1, Math.min(5, Math.round((target.fadeFrames || 30) / 15))) : 0; output.push(switchScene(segment.nextKey, mode, String(speed), `${mode}:${segment.key}:next`)); }
  return output;
}

function makeSceneResource(segment, mode, model, index) { const specialized = model.graph.segments.filter((candidate) => candidate.originBlockKey === segment.originBlockKey).length > 1; const backgroundLabel = specialized ? ` / BG:${segment.effectiveBackgroundKey}` : ''; return { _resourceType: 'scene', id: modeSceneId(segment.key, mode), _index: index, type: mode === 'gbc' ? 'TOPDOWN' : 'ADVENTURE', name: `${segment.sourceName}${segment.label ? ` / ${segment.label}` : ''}${backgroundLabel} [${mode.toUpperCase()}]`, symbol: `scene_${slug(`${segment.sourceSceneId}_${segment.label || segment.key}_${mode}`)}`, x: mode === 'gbc' ? 240 + (index % 8) * 240 : 240 + (index % 8) * 240, y: mode === 'gbc' ? Math.floor(index / 8) * 200 : 1200 + Math.floor(index / 8) * 200, width: 20, height: 18, backgroundId: backgroundId(segment.backgroundVariantKey, mode), tilesetId: '', colorModeOverride: mode === 'gbc' ? 'color' : 'mixed', paletteIds: [], spritePaletteIds: [], autoFadeSpeed: 2, script: sceneScript(segment, mode, model), playerHit1Script: [], playerHit2Script: [], playerHit3Script: [], collisions: '' };
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

function controlPluginFiles(model) {
  const files = new Map(); const commands = model.sourceInventory?.commands || []; const hasMenu = commands.some((entry) => entry.normalizedType === 'choice' && entry.disposition !== 'skipped-source'); const hasRandom = (model.sceneDoc.scenes || []).some((scene) => (scene.commands || []).some((command) => !command.skip && command.type === 'variable' && command.operation === 'random'));
  if (!hasMenu && !hasRandom) return files;
  files.set('plugins/pce-vn-control/plugin.json', json({ id: 'pce-vn-control', name: 'PCE VN Control Events', author: 'pce-vn-gb-studio-exporter', version: '1.0.0', description: 'Generated Phase 2 menu and signed random events.', gbsVersion: model.gbStudio?.version || '4.3.2', type: 'eventsPlugin', license: 'MIT' }));
  files.set('plugins/pce-vn-control/LICENSE', Buffer.from('MIT License\n\nCopyright (c) 2026 pce-vn-gb-studio-exporter\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n', 'utf-8'));
  if (hasMenu) {
    const menuSource = [
      "'use strict';", 'const id = "PCE_VN_EVENT_MENU";', 'const groups = ["EVENT_GROUP_DIALOGUE"];',
      'const fields = [{ key: "variable", label: "Result scratch variable", type: "variable", defaultValue: "LAST_VARIABLE" }, { key: "items", label: "Number of options", type: "number", min: 2, max: 4, defaultValue: 2 }].concat(Array.from({ length: 4 }, function (_, index) { return { key: "option" + (index + 1), label: "Option " + (index + 1), type: "textarea", defaultValue: "" }; }));',
      'const compile = (input, helpers) => {',
      '  const items = Array.from({ length: Number(input.items) || 2 }, function (_, index) { return String(input["option" + (index + 1)] || ""); });',
      '  const lineCounts = items.map(function (item) { return item.split("\\n").length; }); const totalLines = lineCounts.reduce(function (sum, value) { return sum + value; }, 0);',
      '  if (totalLines > 16) throw new Error("PCE VN menuは画面内16行を超えられません: " + totalLines);',
      '  const rowStarts = []; let row = 1; lineCounts.forEach(function (count) { rowStarts.push(row); row += count; });',
      '  const variable = helpers.getVariableAlias(input.variable); helpers._addComment("PCE VN Wrapped Menu");',
      '  helpers._overlayClear(0, 0, 20, totalLines + 2, ".UI_COLOR_WHITE", true, false); helpers._overlayMoveTo(0, 18 - totalLines - 2, ".OVERLAY_IN_SPEED");',
      '  items.forEach(function (item, index) { helpers.textDraw(item, 2, rowStarts[index], "overlay"); }); helpers._overlayWait(true, [".UI_WAIT_WINDOW", ".UI_WAIT_TEXT"]);',
      '  helpers._choice(variable, [".UI_MENU_SET_START"], items.length);',
      '  items.forEach(function (_, index) { const previous = index > 0 ? index : 0; const next = index + 1 < items.length ? index + 2 : 0; helpers._menuItem(1, rowStarts[index], 1, items.length, previous, next); });',
      '  helpers._overlayMoveTo(0, 18, ".OVERLAY_OUT_SPEED"); helpers._overlayWait(true, [".UI_WAIT_WINDOW", ".UI_WAIT_TEXT"]); helpers._addNL();',
      '};',
      'module.exports = { id, name: "PCE VN 2-4 Choice Menu", description: "Wrapped 16-cell menu with initial cursor and disabled B cancel.", groups, fields, compile, waitUntilAfterInitFade: true };', ''
    ].join('\n');
    files.set('plugins/pce-vn-control/events/eventPceVnMenu.js', Buffer.from(menuSource, 'utf-8'));
  }
  if (hasRandom) {
    const randomSource = ["'use strict';", 'const id = "PCE_VN_EVENT_RANDOM";', 'const groups = ["EVENT_GROUP_MATH", "EVENT_GROUP_VARIABLES"];', 'const fields = [{ key: "variable", label: "Variable", type: "variable", defaultValue: "LAST_VARIABLE" }, { key: "min", label: "Signed minimum", type: "number", min: -32768, max: 32767, defaultValue: 0 }, { key: "range", label: "Inclusive range width", type: "number", min: 1, max: 65535, defaultValue: 1 }];', 'const compile = (input, helpers) => { helpers.variableSetToRandom(input.variable, Number(input.min) || 0, Math.max(1, Math.min(65535, Number(input.range) || 1))); };', 'module.exports = { id, name: "PCE VN Signed Random", description: "Signed 16-bit inclusive random range up to 65535 values.", groups, fields, compile };', ''].join('\n');
    files.set('plugins/pce-vn-control/events/eventPceVnRandom.js', Buffer.from(randomSource, 'utf-8'));
  }
  return files;
}

function makeControlFlowAudit(model) {
  const commands = (model.sourceInventory?.commands || []).map((entry) => ({ ...entry, generated: { gbc: { sceneIds: [...entry.generated.gbc.sceneIds], eventIds: [...entry.generated.gbc.eventIds] }, dmg: { sceneIds: [...entry.generated.dmg.sceneIds], eventIds: [...entry.generated.dmg.eventIds] } } })); const failures = [];
  for (const command of commands) {
    if (!['generated', 'generated-metadata', 'omitted-confirmed', 'skipped-source'].includes(command.disposition)) failures.push(`${command.sceneId}.commands[${command.commandIndex}]: 未分類 ${command.disposition}`);
    if (command.disposition === 'generated' && (!command.generated.gbc.eventIds.length || !command.generated.dmg.eventIds.length)) failures.push(`${command.sceneId}.commands[${command.commandIndex}]: GBC/DMG eventが不足しています`);
    if (command.disposition === 'omitted-confirmed' && !model.settings.visualOmissionsConfirmed && ['sprite', 'spritemove', 'effect'].includes(command.normalizedType)) failures.push(`${command.sceneId}.commands[${command.commandIndex}]: 未確認の視覚省略です`);
    if (['branch', 'state', 'text', 'bgm'].includes(command.processingCategory) && command.disposition !== 'generated' && command.disposition !== 'skipped-source') failures.push(`${command.sceneId}.commands[${command.commandIndex}]: ${command.processingCategory}が生成されていません`);
  }
  const segments = model.graph.segments.map((segment) => ({ key: segment.key, originBlockKey: segment.originBlockKey, sourceSceneId: segment.sourceSceneId, label: segment.label, nextKey: segment.nextKey, fallthrough: segment.fallthrough, terminal: segment.terminal, reachable: segment.reachable, entryBackgroundKey: segment.entryBackgroundKey, entryBackgroundKeys: segment.entryBackgroundKeys, effectiveBackgroundKey: segment.effectiveBackgroundKey, backgroundSource: segment.backgroundSource, specializedSceneIds: { gbc: modeSceneId(segment.key, 'gbc'), dmg: modeSceneId(segment.key, 'dmg') }, edges: segment.edges }));
  const audit = { format: 'pce-vn-gb-studio-control-flow-audit', version: 1, status: failures.length ? 'fail' : 'pass', failures, summary: { sourceCommands: commands.length, consumedCommands: commands.filter((command) => command.disposition !== 'pending' && command.disposition !== 'error').length, generatedCommands: commands.filter((command) => command.disposition === 'generated').length, metadataCommands: commands.filter((command) => command.disposition === 'generated-metadata').length, omittedCommands: commands.filter((command) => command.disposition === 'omitted-confirmed').length, skippedCommands: commands.filter((command) => command.disposition === 'skipped-source').length, reachableSegments: segments.filter((segment) => segment.reachable).length, unreachableSegments: segments.filter((segment) => !segment.reachable).length }, graph: { startKey: model.graph.startKey, segments, joins: model.graph.joins, loops: model.graph.loops, unreachable: model.graph.unreachable, unreachableSpecialized: model.graph.unreachableSpecialized }, commands };
  if (failures.length) { const error = new Error(`control-flow監査に失敗しました:\n${failures.join('\n')}`); error.code = 'GBVN_CONTROL_FLOW_AUDIT_FAILED'; error.audit = audit; throw error; } return audit;
}

function buildGbStudioFiles(model, backgrounds, music) {
  const files = new Map(); const projectName = String(model.project.title || model.project.name || 'PCE VN GB Studio'); const romName = slug(model.project.romName || projectName, 'pce_vn_gb'); const descriptor = `${romName}.gbsproj`; const staticGbc = makeStaticSprite('gbc'); const staticDmg = makeStaticSprite('dmg');
  files.set(descriptor, json({ _resourceType: 'project', name: projectName, author: String(model.project.author || ''), notes: 'Generated by pce-vn-gb-studio-exporter. Generator-owned project.', _version: '4.2.0', _release: '10' }));
  for (const [relative, data] of controlPluginFiles(model)) files.set(relative, data);
  files.set('assets/sprites/static_gbc.png', staticGbc.png); files.set('assets/sprites/static_gbc.png.gbsres', json(staticGbc.resource)); files.set('assets/sprites/static_dmg.png', staticDmg.png); files.set('assets/sprites/static_dmg.png.gbsres', json(staticDmg.resource)); files.set('assets/ui/frame.png', makeUiPng('frame')); files.set('assets/ui/cursor.png', makeUiPng('cursor'));
  const paletteSpecs = [
    ['default-bg-1', 'Default BG 1', ['F8E8C8', 'D89048', 'A82820', '301850']], ['default-bg-2', 'Default BG 2', ['E0F8CF', '86C06C', '306850', '071821']], ['default-bg-3', 'Default BG 3', ['F8F8D8', 'D8B078', '786078', '181830']], ['default-bg-4', 'Default BG 4', ['F8E8E8', 'E89898', '885068', '281830']], ['default-bg-5', 'Default BG 5', ['E8F8F8', '88C8D8', '407088', '102038']], ['default-bg-6', 'Default BG 6', ['F8F0D0', 'B8C878', '587048', '182820']], ['dmg', 'DMG', ['E0F8CF', '86C06C', '306850', '071821']], ['default-ui', 'Default UI', ['E0F8CF', '86C06C', '306850', '071821']], ['default-sprite', 'Default Sprite', ['E0F8CF', '86C06C', '306850', '071821']]
  ];
  paletteSpecs.forEach(([id, name, colors]) => files.set(`project/palettes/${id}.gbsres`, json(paletteResource(id, name, colors))));
  model.font.pages.forEach((page) => { const filename = `pce-vn/page_${String(page.index + 1).padStart(2, '0')}.png`; const name = `PCE VN Font ${page.index + 1}`; files.set(`assets/fonts/${filename}`, page.png); files.set(`assets/fonts/${filename.replace(/\.png$/i, '.json')}`, json({ name, mapping: page.mapping })); files.set(`assets/fonts/${filename}.gbsres`, json({ _resourceType: 'font', id: fontId(page.index), name, symbol: `font_pce_vn_${page.index + 1}`, width: 128, height: 112, mapping: page.mapping, filename })); });
  for (const transformed of backgrounds.output) for (const mode of ['gbc', 'dmg']) { const safe = slug(transformed.key, 'background'); const filename = `pce-vn/${mode}/${safe}.png`; const converted = mode === 'gbc' ? transformed.gbc : transformed.dmg; files.set(`assets/backgrounds/${filename}`, encodeRgbaPng(converted.image)); files.set(`assets/backgrounds/${filename}.gbsres`, json({ _resourceType: 'background', id: backgroundId(transformed.key, mode), name: `${transformed.assetId || 'Blank'} ${mode.toUpperCase()}`, symbol: `background_${slug(`${transformed.key}_${mode}`)}`, tileColors: '', filename, width: 20, height: 18, imageWidth: 160, imageHeight: 144, autoColor: true })); }
  const dispatchKey = 'dispatcher-blank'; const blank = new Uint8Array(160 * 144 * 4); for (let i = 0; i < 160 * 144; i += 1) blank.set([224, 248, 207, 255], i * 4); files.set('assets/backgrounds/pce-vn/dispatcher.png', encodeRgbaPng({ width: 160, height: 144, rgba: blank })); files.set('assets/backgrounds/pce-vn/dispatcher.png.gbsres', json({ _resourceType: 'background', id: backgroundId(dispatchKey, 'mixed'), name: 'Device Dispatcher', symbol: 'background_device_dispatcher', tileColors: '', filename: 'pce-vn/dispatcher.png', width: 20, height: 18, imageWidth: 160, imageHeight: 144, autoColor: true }));
  for (const track of music.tracks) { const filename = `pce-vn/${slug(track.asset.id)}.mod`; files.set(`assets/music/${filename}`, track.buffer); files.set(`assets/music/${filename}.gbsres`, json({ _resourceType: 'music', id: musicId(track.asset.id), name: track.asset.name || track.asset.id, symbol: `music_${slug(track.asset.id)}`, settings: {}, filename, type: 'mod' })); }
  const startKey = model.graph.startKey; const dispatcherId = idFor('scene', 'device-dispatcher'); const initializers = model.variables.names.map((name) => event('EVENT_SET_VALUE', { variable: model.variables.ids[name], value: number(model.variables.initialValues[name]) }, undefined, `dispatcher:init:${name}`)); const dispatcher = { _resourceType: 'scene', id: dispatcherId, _index: 0, type: 'ADVENTURE', name: 'Device Dispatch', symbol: 'scene_device_dispatch', x: -240, y: 0, width: 20, height: 18, backgroundId: backgroundId(dispatchKey, 'mixed'), tilesetId: '', colorModeOverride: 'mixed', paletteIds: [], spritePaletteIds: [], autoFadeSpeed: 2, script: [event('EVENT_ACTOR_DEACTIVATE', { actorId: 'player' }, undefined, 'dispatcher:deactivate'), ...initializers, event('EVENT_IF_COLOR_SUPPORTED', { __collapseElse: false }, { true: [switchScene(startKey, 'gbc', '2', 'dispatcher:gbc')], false: [switchScene(startKey, 'dmg', '2', 'dispatcher:dmg')] }, 'dispatcher:if-color')], playerHit1Script: [], playerHit2Script: [], playerHit3Script: [], collisions: '' };
  files.set('project/scenes/device_dispatch/scene.gbsres', json(dispatcher)); let sceneIndex = 1;
  for (const mode of ['gbc', 'dmg']) for (const segment of model.graph.segments) { const folder = `${slug(segment.sourceSceneId)}_${String(segment.sourceIndex).padStart(3, '0')}_${mode}`; files.set(`project/scenes/${folder}/scene.gbsres`, json(makeSceneResource(segment, mode, model, sceneIndex++))); }
  const controlAudit = makeControlFlowAudit(model);
  files.set('build/qa/control-flow-audit.json', json(controlAudit));
  files.set('project/settings.gbsres', json(makeSettings(model, { gbc: staticGbc.id, dmg: staticDmg.id }, dispatcherId))); files.set('project/variables.gbsres', json({ _resourceType: 'variables', variables: model.variables.names.map((name) => ({ id: model.variables.ids[name], name, symbol: `var_${slug(name)}` })), constants: [] }));
  const gbcSheet = makeContactSheet(backgrounds.output.map((entry) => ({ image: entry.gbc.image }))); const dmgSheet = makeContactSheet(backgrounds.output.map((entry) => ({ image: entry.dmg.image }))); files.set('build/qa/backgrounds-gbc.png', encodeRgbaPng(gbcSheet)); files.set('build/qa/backgrounds-dmg.png', encodeRgbaPng(dmgSheet)); files.set('build/qa/background-audit.json', json({ format: 'pce-vn-gb-studio-background-audit', version: 1, reservedUiPalette: 7, backgrounds: backgrounds.audits })); files.set('build/qa/music-audit.json', json({ format: 'pce-vn-gb-studio-music-audit', version: 1, tracks: music.audits }));
  const voicedMessages = []; for (const scene of model.sceneDoc.scenes || []) for (const [commandIndex, command] of (scene.commands || []).entries()) if (command.type === 'message' && command.voiceAssetId) voicedMessages.push({ sceneId: scene.id, commandIndex, voiceAssetId: command.voiceAssetId, speaker: String(command.speaker || ''), frequency: speakerToneFrequency(command.speaker), substitution: 'text-tone' });
  files.set('build/qa/conversion-audit.json', json({ format: 'pce-vn-gb-studio-conversion-audit', version: 1, cddaMappings: model.settings.cddaMappings || {}, manualAudioSubstitutions: model.settings.audioSubstitutions || {}, automaticVoiceSubstitutions: voicedMessages }));
  files.set('LICENSES/Misaki-Font.txt', fs.readFileSync(path.join(__dirname, 'third_party', 'misaki-font', 'LICENSE.txt')));
  files.set('README.md', Buffer.from(`# ${projectName}\n\nこのGB Studio ${model.gbStudio?.version || '4.3.2'}プロジェクトはpce-vn-gb-studio-exporterが生成しました。Color + Monochromeの単一ROMとして、起動時にGBC/DMG scene graphを選択します。\n\n- 生成物はexporter管理です。任意の既存GB Studioプロジェクトへのmergeには対応しません。\n- 制御フロー監査: build/qa/control-flow-audit.json\n- 背景監査: build/qa/background-audit.json\n- BGM監査: build/qa/music-audit.json\n- 2～4択とsigned randomを使うprojectにはplugins/pce-vn-controlを同梱します。\n- ダイアログ直前にGB Studio標準eventが既定frame tileを再転送します。\n`, 'utf-8'));
  const choiceCounts = { 2: 0, 3: 0, 4: 0 }; for (const scene of model.sceneDoc.scenes || []) for (const command of scene.commands || []) if (!command.skip && command.type === 'choice' && choiceCounts[command.choices.length] !== undefined) choiceCounts[command.choices.length] += 1;
  return { files, descriptor, romName, stats: { scenes: model.graph.segments.length * 2 + 1, sourceScenes: model.sceneDoc.scenes.length, backgrounds: backgrounds.output.length * 2 + 1, fontPages: model.font.pages.length, music: music.tracks.length, variables: model.variables.names.length, choices: choiceCounts, unreachableSegments: model.graph.unreachable.length, controlCommands: controlAudit.summary } };
}

module.exports = { DIALOGUE_FRAME_EVENT, backgroundId, buildConversionModel, buildGbStudioFiles, buildMusic, externalMusicAssetId, fontId, idFor, modeSceneId, slug, speakerToneFrequency, splitScenes, targetlessAsyncContinuation, transformBackgrounds, transformBackgroundVariant, validateExternalMod, wrapChoiceLabel };
