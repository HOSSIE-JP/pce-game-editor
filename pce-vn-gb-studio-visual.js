'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAssetSource } = require('./pce-asset-manager');
const { DMG_COLORS, adjustBackgroundImage, encodeRgbaPng, orderedDitherOffset, readRgbaPng } = require('./pce-vn-gb-studio-image');

const PORTRAIT_RENDER_MODES = Object.freeze(['baked', 'actor']);
const SPRITE_CANVAS_WIDTH = 40;
const SPRITE_CANVAS_HEIGHT = 48;
const SPRITE_INNER_WIDTH = 38;
const SPRITE_INNER_HEIGHT = 46;
const SPRITE_TILE_WIDTH = 8;
const SPRITE_TILE_HEIGHT = 16;
const SPRITE_FRAME_LIMIT = 64;
const TITLE_SPRITETEXT_PROMPT_MARGIN_Y = 8;
const SPRITE_CARRIER_COLORS = Object.freeze([
  Object.freeze([224, 248, 207]),
  Object.freeze([224, 248, 207]),
  Object.freeze([134, 192, 108]),
  Object.freeze([7, 24, 33]),
]);

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function stableValue(value) { if (Array.isArray(value)) return value.map(stableValue); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])); return value; }
function stableJson(value) { return JSON.stringify(stableValue(value)); }
function clamp(value, min, max, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; }
function clampInt(value, min, max, fallback) { return Math.trunc(clamp(value, min, max, fallback)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function luminance(color) { return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]; }
function colorDistance(a, b) { const dr = a[0] - b[0]; const dg = a[1] - b[1]; const db = a[2] - b[2]; return dr * dr * 2 + dg * dg * 4 + db * db; }
function hexColor(color) { return color.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function visualStateHash(state) { return sha256(stableJson(state)).slice(0, 16); }

function normalizePortraitRenderMode(value) { return value === 'actor' ? 'actor' : 'baked'; }

function normalizeSpriteSetting(value = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const cropRaw = raw.crop && typeof raw.crop === 'object' && !Array.isArray(raw.crop) ? raw.crop : null;
  const crop = cropRaw && Number(cropRaw.width) > 0 && Number(cropRaw.height) > 0 ? {
    x: clampInt(cropRaw.x, 0, 4095, 0), y: clampInt(cropRaw.y, 0, 4095, 0),
    width: clampInt(cropRaw.width, 1, 4096, 1), height: clampInt(cropRaw.height, 1, 4096, 1),
  } : null;
  return {
    crop,
    scale: clamp(raw.scale, 25, 200, 100),
    offsetX: clampInt(raw.offsetX ?? raw.offset?.x, -320, 320, 0),
    offsetY: clampInt(raw.offsetY ?? raw.offset?.y, -224, 224, 0),
    brightness: clamp(raw.brightness, -100, 100, 0),
    saturation: clamp(raw.saturation, 0, 200, 100),
    gbcDither: Boolean(raw.gbcDither),
    dmgDither: Boolean(raw.dmgDither),
    sourceHash: String(raw.sourceHash || '').slice(0, 64),
  };
}

function image(width, height, fill = [0, 0, 0, 0]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) rgba.set(fill, index * 4);
  return { width, height, rgba };
}

function cropImage(source, x, y, width, height) {
  const output = image(width, height);
  for (let dy = 0; dy < height; dy += 1) for (let dx = 0; dx < width; dx += 1) {
    const sx = x + dx; const sy = y + dy; if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
    output.rgba.set(source.rgba.subarray((sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4), (dy * width + dx) * 4);
  }
  return output;
}

function opaqueBounds(source) {
  let minX = source.width; let minY = source.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) if (source.rgba[(y * source.width + x) * 4 + 3] > 0) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return maxX < minX ? { x: 0, y: 0, width: source.width, height: source.height, empty: true } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, empty: false };
}

function sourceAnimations(asset, sourceImage) {
  const options = asset.options || {}; const cellWidth = clampInt(options.cellWidth, 1, sourceImage.width, sourceImage.width); const cellHeight = clampInt(options.cellHeight, 1, sourceImage.height, sourceImage.height); const columns = Math.max(1, Math.floor(sourceImage.width / cellWidth));
  const rawAnimations = Array.isArray(options.animations) && options.animations.length ? options.animations : [{ id: 'default', frameWidth: sourceImage.width, frameHeight: sourceImage.height, firstCell: 0, frameCount: 1, frameDelay: 1, frameStrideCells: Math.max(1, Math.ceil(sourceImage.width / cellWidth)), loop: true }];
  return rawAnimations.map((raw, animationIndex) => {
    const frameWidth = clampInt(raw.frameWidth, 1, sourceImage.width, sourceImage.width); const frameHeight = clampInt(raw.frameHeight, 1, sourceImage.height, sourceImage.height); const firstCell = clampInt(raw.firstCell, 0, 65535, 0); const stride = clampInt(raw.frameStrideCells, 1, 65535, Math.max(1, Math.ceil(frameWidth / cellWidth))); const frameCount = clampInt(raw.frameCount, 1, 256, 1);
    const frames = Array.from({ length: frameCount }, (_, frameIndex) => { const cell = firstCell + frameIndex * stride; const sx = (cell % columns) * cellWidth; const sy = Math.floor(cell / columns) * cellHeight; return { key: `${String(raw.id || `row_${animationIndex}`)}:${frameIndex}`, sourceX: sx, sourceY: sy, image: cropImage(sourceImage, sx, sy, frameWidth, frameHeight) }; });
    const delays = Array.from({ length: frameCount }, (_, frameIndex) => clampInt(raw.frameDelays?.[frameIndex] ?? raw.frameDelay, 1, 65535, 1));
    return { id: String(raw.id || (animationIndex ? `row_${animationIndex}` : 'default')), name: String(raw.name || ''), loop: raw.loop !== false, frameWidth, frameHeight, frames, delays };
  });
}

function autoPortraitCrop(animations) {
  const frames = animations.flatMap((animation) => animation.frames.map((frame) => frame.image)); const frameWidth = Math.min(...frames.map((frame) => frame.width)); const frameHeight = Math.min(...frames.map((frame) => frame.height)); let top = frameHeight; let alphaWidth = 1;
  for (const frame of frames) { const bounds = opaqueBounds(frame); if (!bounds.empty) { top = Math.min(top, bounds.y); alphaWidth = Math.max(alphaWidth, bounds.width); } }
  if (top >= frameHeight) top = 0;
  let cropWidth = Math.min(frameWidth, Math.max(alphaWidth, Math.round((frameHeight - top) * SPRITE_INNER_WIDTH / SPRITE_INNER_HEIGHT))); let cropHeight = Math.min(frameHeight - top, Math.round(cropWidth * SPRITE_INNER_HEIGHT / SPRITE_INNER_WIDTH));
  if (cropHeight < 1) cropHeight = frameHeight; if (cropWidth < 1) cropWidth = frameWidth;
  const x = Math.max(0, Math.min(frameWidth - cropWidth, Math.round(frameWidth / 2 - cropWidth / 2)));
  return { x, y: top, width: cropWidth, height: cropHeight, automatic: true };
}

function fitPortraitFrame(frame, crop, settings) {
  const source = cropImage(frame, crop.x, crop.y, crop.width, crop.height); const adjusted = adjustBackgroundImage(source, { brightness: settings.brightness, saturation: settings.saturation, artworkHeight: source.height }); const output = image(SPRITE_CANVAS_WIDTH, SPRITE_CANVAS_HEIGHT);
  const baseScale = Math.min(SPRITE_INNER_WIDTH / adjusted.width, SPRITE_INNER_HEIGHT / adjusted.height); const scale = baseScale * settings.scale / 100; const drawWidth = Math.max(1, Math.round(adjusted.width * scale)); const drawHeight = Math.max(1, Math.round(adjusted.height * scale)); const left = Math.round((SPRITE_CANVAS_WIDTH - drawWidth) / 2) + settings.offsetX; const top = Math.round((SPRITE_CANVAS_HEIGHT - drawHeight) / 2) + settings.offsetY;
  for (let y = 0; y < drawHeight; y += 1) for (let x = 0; x < drawWidth; x += 1) { const sx = Math.min(adjusted.width - 1, Math.floor(x / scale)); const sy = Math.min(adjusted.height - 1, Math.floor(y / scale)); const dx = left + x; const dy = top + y; if (dx < 0 || dy < 0 || dx >= output.width || dy >= output.height) continue; output.rgba.set(adjusted.rgba.subarray((sy * adjusted.width + sx) * 4, (sy * adjusted.width + sx) * 4 + 4), (dy * output.width + dx) * 4); }
  return output;
}

function medianCutPalette(colors, count = 3) {
  if (!colors.length) return [[224, 248, 207], [134, 192, 108], [7, 24, 33]].slice(0, count);
  let boxes = [{ colors }];
  while (boxes.length < count) {
    boxes.sort((a, b) => { const range = (box) => Math.max(...[0, 1, 2].map((channel) => Math.max(...box.colors.map((color) => color[channel])) - Math.min(...box.colors.map((color) => color[channel])))); return range(b) - range(a) || b.colors.length - a.colors.length; });
    const box = boxes.shift(); if (!box || box.colors.length < 2) { if (box) boxes.push(box); break; }
    let channel = 0; let best = -1; for (let c = 0; c < 3; c += 1) { const range = Math.max(...box.colors.map((color) => color[c])) - Math.min(...box.colors.map((color) => color[c])); if (range > best) { best = range; channel = c; } }
    box.colors.sort((a, b) => a[channel] - b[channel] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]); const split = Math.ceil(box.colors.length / 2); boxes.push({ colors: box.colors.slice(0, split) }, { colors: box.colors.slice(split) });
  }
  const palette = boxes.map((box) => [0, 1, 2].map((channel) => Math.round(box.colors.reduce((sum, color) => sum + color[channel], 0) / box.colors.length))).sort((a, b) => luminance(b) - luminance(a));
  while (palette.length < count) palette.push([...palette.at(-1)]); return palette.slice(0, count);
}

function quantizePortraitFrames(frames, mode, dither) {
  const colors = []; const lumas = [];
  for (const frame of frames) for (let index = 0; index < frame.rgba.length; index += 4) if (frame.rgba[index + 3] > 0) { const color = [frame.rgba[index], frame.rgba[index + 1], frame.rgba[index + 2]]; colors.push(color); lumas.push(luminance(color)); }
  let palette;
  if (mode === 'gbc') palette = medianCutPalette(colors.map((color) => color.map((value) => Math.round(Math.round(value * 31 / 255) * 255 / 31))), 3);
  else { lumas.sort((a, b) => a - b); const at = (ratio, fallback) => lumas.length ? lumas[Math.min(lumas.length - 1, Math.floor((lumas.length - 1) * ratio))] : fallback; palette = [[at(0.84, 224), at(0.84, 224), at(0.84, 224)], [at(0.5, 134), at(0.5, 134), at(0.5, 134)], [at(0.16, 7), at(0.16, 7), at(0.16, 7)]]; }
  palette.sort((a, b) => luminance(b) - luminance(a));
  const converted = frames.map((frame) => { const output = image(frame.width, frame.height); const indices = new Uint8Array(frame.width * frame.height); for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) { const at = (y * frame.width + x) * 4; if (!frame.rgba[at + 3]) continue; const offset = dither ? orderedDitherOffset(x, y, 16) : 0; const color = [frame.rgba[at] + offset, frame.rgba[at + 1] + offset, frame.rgba[at + 2] + offset]; let chosen = 0; let error = Infinity; palette.forEach((candidate, index) => { const next = colorDistance(color, candidate); if (next < error) { error = next; chosen = index; } }); const carrierIndex = chosen + 1; indices[y * frame.width + x] = carrierIndex; output.rgba.set([...SPRITE_CARRIER_COLORS[carrierIndex], 255], at); } return { image: output, indices }; });
  return { palette, frames: converted };
}

function portraitColorMetrics(sourceFrames, converted) {
  let opaquePixels = 0; let changedPixels = 0; let totalError = 0; let maxError = 0;
  sourceFrames.forEach((frame, frameIndex) => { const output = converted.frames[frameIndex]; for (let index = 0; index < frame.width * frame.height; index += 1) { const at = index * 4; if (!frame.rgba[at + 3]) continue; const paletteIndex = Math.max(0, (output.indices[index] || 1) - 1); const source = [frame.rgba[at], frame.rgba[at + 1], frame.rgba[at + 2]]; const target = converted.palette[paletteIndex] || converted.palette[0]; const error = Math.sqrt(colorDistance(source, target)); opaquePixels += 1; totalError += error; maxError = Math.max(maxError, error); if (source[0] !== target[0] || source[1] !== target[1] || source[2] !== target[2]) changedPixels += 1; } });
  return { opaquePixels, changedPixels, meanWeightedError: opaquePixels ? Number((totalError / opaquePixels).toFixed(4)) : 0, maxWeightedError: Number(maxError.toFixed(4)), exact: changedPixels === 0 };
}

function quantizeAnimationDelays(animations) {
  const candidates = [1, 2, 4, 8, 16, 32, 64]; let best = null;
  for (const quantum of candidates) {
    const rows = animations.map((animation) => { const repeats = animation.delays.map((delay) => Math.max(1, Math.round(delay / quantum))); if (repeats.reduce((sum, value) => sum + value, 0) > SPRITE_FRAME_LIMIT) return null; const errors = repeats.map((repeat, index) => repeat * quantum - animation.delays[index]); return { repeats, errors }; });
    if (rows.some((row) => !row)) continue; const periodError = rows.reduce((sum, row) => sum + Math.abs(row.errors.reduce((a, value) => a + value, 0)), 0); const maxFrameError = Math.max(0, ...rows.flatMap((row) => row.errors.map(Math.abs))); const frameCount = rows.reduce((sum, row) => sum + row.repeats.reduce((a, value) => a + value, 0), 0); const score = [periodError, maxFrameError, frameCount, quantum];
    if (!best || score.some((value, index) => value < best.score[index] && score.slice(0, index).every((prefix, at) => prefix === best.score[at]))) best = { quantum, rows, score };
  }
  if (!best) { const error = new Error('frameDelaysを64 generated frame以内へ量子化できません'); error.code = 'GBVN_SPRITE_ANIMATION_FRAME_LIMIT'; throw error; }
  return { quantum: best.quantum, animations: animations.map((animation, index) => ({ id: animation.id, repeats: best.rows[index].repeats, frameErrors: best.rows[index].errors, sourcePeriod: animation.delays.reduce((sum, value) => sum + value, 0), generatedPeriod: best.rows[index].repeats.reduce((sum, value) => sum + value, 0) * best.quantum, generatedFrames: best.rows[index].repeats.reduce((sum, value) => sum + value, 0) })) };
}

function frameTileMetrics(frame) {
  const occupied = []; const rowCounts = [0, 0, 0];
  for (let ty = 0; ty < 3; ty += 1) for (let tx = 0; tx < 5; tx += 1) { let visible = false; for (let y = 0; y < 16 && !visible; y += 1) for (let x = 0; x < 8; x += 1) if (frame.rgba[((ty * 16 + y) * frame.width + tx * 8 + x) * 4 + 3]) { visible = true; break; } if (visible) { occupied.push({ tx, ty }); rowCounts[ty] += 1; } }
  return { occupied, objects: occupied.length, rowCounts };
}

function makeSheet(frames) { const output = image(Math.max(1, frames.length) * SPRITE_CANVAS_WIDTH, SPRITE_CANVAS_HEIGHT); frames.forEach((frame, index) => { for (let y = 0; y < frame.height; y += 1) output.rgba.set(frame.rgba.subarray(y * frame.width * 4, (y + 1) * frame.width * 4), (y * output.width + index * SPRITE_CANVAS_WIDTH) * 4); }); return output; }

function transformSpriteAsset({ projectDir, asset, settings: rawSettings = {}, renderMode = 'baked', includeSourceImage = false }) {
  if (!asset || asset.type !== 'sprite') { const error = new Error(`sprite assetではありません: ${asset?.id || '(none)'}`); error.code = 'GBVN_PREVIEW_ASSET_INVALID'; throw error; }
  const source = resolveAssetSource(projectDir, asset).absPath; if (!source || !fs.existsSync(source) || path.extname(source).toLowerCase() !== '.png') { const error = new Error(`sprite PNGが見つかりません: ${asset.id}`); error.code = 'GBVN_UNRESOLVED_ASSET'; throw error; }
  const sourceBuffer = fs.readFileSync(source); const sourceHash = sha256(sourceBuffer); const sourceImage = readRgbaPng(sourceBuffer); const settings = normalizeSpriteSetting(rawSettings); const animations = sourceAnimations(asset, sourceImage); const crop = settings.crop || autoPortraitCrop(animations); const uniqueFrames = []; const frameIndex = new Map();
  for (const animation of animations) for (const frame of animation.frames) if (!frameIndex.has(frame.key)) { frameIndex.set(frame.key, uniqueFrames.length); uniqueFrames.push(fitPortraitFrame(frame.image, crop, settings)); }
  const gbc = quantizePortraitFrames(uniqueFrames, 'gbc', settings.gbcDither); const dmg = quantizePortraitFrames(uniqueFrames, 'dmg', settings.dmgDither); const timing = quantizeAnimationDelays(animations); const colorMetrics = { gbc: portraitColorMetrics(uniqueFrames, gbc), dmg: portraitColorMetrics(uniqueFrames, dmg) };
  const modeData = (converted) => { const frames = converted.frames.map((entry, index) => ({ key: [...frameIndex.entries()].find(([, at]) => at === index)?.[0] || String(index), image: entry.image, indices: entry.indices, ...frameTileMetrics(entry.image) })); return { palette: converted.palette, frames, sheet: makeSheet(frames.map((frame) => frame.image)), maxObjects: Math.max(0, ...frames.map((frame) => frame.objects)), maxScanlineObjects: Math.max(0, ...frames.flatMap((frame) => frame.rowCounts)) }; };
  const modes = { gbc: modeData(gbc), dmg: modeData(dmg) }; const stale = Boolean(settings.sourceHash && settings.sourceHash !== sourceHash); const outputHashes = { gbc: sha256(encodeRgbaPng(modes.gbc.sheet)), dmg: sha256(encodeRgbaPng(modes.dmg.sheet)) };
  const normalizedMode = normalizePortraitRenderMode(renderMode);
  const retainedAnimations = normalizedMode === 'baked' || includeSourceImage ? animations : animations.map((animation) => ({ ...animation, frames: animation.frames.map(({ image: _image, ...frame }) => frame) }));
  return { assetId: asset.id, name: asset.name || asset.id, renderMode: normalizedMode, source, sourceHash, ...(includeSourceImage ? { sourceImage } : {}), sourceWidth: sourceImage.width, sourceHeight: sourceImage.height, settings, stale, crop, animations: retainedAnimations, frameIndex: Object.fromEntries(frameIndex), timing, modes, outputHashes, audit: { assetId: asset.id, sourceHash, stale, crop, settings, animationCount: animations.length, sourceFrames: uniqueFrames.length, timing, gbc: { palette: gbc.palette.map(hexColor), maxObjects: modes.gbc.maxObjects, maxScanlineObjects: modes.gbc.maxScanlineObjects, color: colorMetrics.gbc, outputHash: outputHashes.gbc }, dmg: { palette: dmg.palette.map((color) => Math.round(luminance(color))), maxObjects: modes.dmg.maxObjects, maxScanlineObjects: modes.dmg.maxScanlineObjects, color: colorMetrics.dmg, outputHash: outputHashes.dmg } } };
}

function spriteStateIdKey(assetId, mode, physical, animationId, flipX, flipY) { return `${assetId}:${mode}:${physical}:${animationId}:${flipX ? 1 : 0}:${flipY ? 1 : 0}`; }
function spriteStateName(animationId = 'default', flipX = false, flipY = false, heldFrame = null) { return `${animationId || 'default'}${Number.isInteger(heldFrame) ? `:hold:${heldFrame}` : ''}${flipX ? ':flipX' : ''}${flipY ? ':flipY' : ''}`; }

function makeSpriteResource(transformed, mode, physical, helpers) {
  const { idFor, slug } = helpers; const modeData = transformed.modes[mode]; const paletteIndex = physical === 'B' ? 1 : 0; const objPalette = physical === 'B' ? 'OBP1' : 'OBP0'; const timingById = new Map(transformed.timing.animations.map((entry) => [entry.id, entry]));
  const states = [];
  const appendState = (animation, flipX, flipY, heldFrame = null) => {
    const quantized = timingById.get(animation.id); const sequence = [];
    if (Number.isInteger(heldFrame)) sequence.push(animation.frames[Math.max(0, Math.min(animation.frames.length - 1, heldFrame))].key);
    else animation.frames.forEach((frame, frameIndexValue) => { for (let repeat = 0; repeat < quantized.repeats[frameIndexValue]; repeat += 1) sequence.push(frame.key); });
    const stateKey = `${spriteStateIdKey(transformed.assetId, mode, physical, animation.id, flipX, flipY)}${Number.isInteger(heldFrame) ? `:hold:${heldFrame}` : ''}`;
    const frames = sequence.map((frameKey) => { const sourceIndex = transformed.frameIndex[frameKey]; const frame = modeData.frames[sourceIndex]; const tiles = frame.occupied.map(({ tx, ty }, tileIndex) => { const dx = flipX ? 4 - tx : tx; const dy = flipY ? 2 - ty : ty; return { id: idFor('tile', `${stateKey}:source:${sourceIndex}:${tileIndex}`), x: dx * 8 - 20, y: -8 - dy * SPRITE_TILE_HEIGHT, sliceX: sourceIndex * SPRITE_CANVAS_WIDTH + tx * SPRITE_TILE_WIDTH, sliceY: ty * SPRITE_TILE_HEIGHT, flipX, flipY, palette: paletteIndex, paletteIndex, objPalette, priority: false }; }); return { id: idFor('frame', `${stateKey}:source:${sourceIndex}`), tiles }; });
    // GB Studio's fixed sprite convention reads animation slot 0 regardless of
    // actor direction. Keep the seven unused directions as a single empty frame
    // instead of serializing the same (potentially 64-frame) metasprite sequence
    // eight times. This mirrors the official 4.3.x static sprite resource and
    // avoids minutes of duplicate sprite preprocessing on portrait-heavy games.
    const directional = Array.from({ length: 8 }, (_, direction) => ({
      id: idFor('animation', `${stateKey}:${direction}`),
      frames: direction === 0 ? frames : [{ id: idFor('frame', `${stateKey}:${direction}:empty`), tiles: [] }],
    }));
    states.push({ id: idFor('state', stateKey), name: spriteStateName(animation.id, flipX, flipY, heldFrame), animationType: 'fixed', flipLeft: false, animations: directional });
  };
  for (const animation of transformed.animations) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    appendState(animation, flipX, flipY);
    if (!animation.loop && animation.frames.length > 1) appendState(animation, flipX, flipY, animation.frames.length - 1);
  }
  const id = idFor('sprite', `${transformed.assetId}:${mode}:${physical}`); const filename = `pce-vn/${mode}/${slug(transformed.assetId)}_${physical.toLowerCase()}.png`;
  return { id, filename, png: encodeRgbaPng(modeData.sheet), resource: { _resourceType: 'sprite', id, name: `${transformed.name} ${mode.toUpperCase()} ${physical}`, symbol: `sprite_${slug(`${transformed.assetId}_${mode}_${physical}`)}`, states, numTiles: Math.max(1, modeData.frames.reduce((sum, frame) => sum + frame.objects, 0)), canvasOriginX: 8, canvasOriginY: 48, canvasWidth: 40, canvasHeight: 48, boundsX: -20, boundsY: -48, boundsWidth: 40, boundsHeight: 48, animSpeed: Math.max(0, transformed.timing.quantum - 1), filename, width: modeData.sheet.width, height: modeData.sheet.height }, stateId: (animationId = 'default', flipX = false, flipY = false) => idFor('state', spriteStateIdKey(transformed.assetId, mode, physical, animationId, flipX, flipY)), stateName: spriteStateName };
}

function initialVisualState() { return { sprites: [null, null, null, null], spriteTexts: [null, null, null, null], physical: { A: null, B: null, next: 'A' }, activeMoves: [null, null, null, null], blank: false, clock: 0, touch: 0 }; }
function serializableVisualState(state) {
  const output = clone(state); delete output.clock; delete output.touch;
  const ordered = output.sprites.map((sprite, slot) => ({ sprite, slot })).filter((entry) => entry.sprite).sort((left, right) => (left.sprite.touched || 0) - (right.sprite.touched || 0) || left.slot - right.slot);
  ordered.forEach((entry, index) => { entry.sprite.touched = index + 1; });
  return output;
}
function currentMovePosition(move, elapsed) { const progress = Math.max(0, Math.min(move.frames, elapsed)) / Math.max(1, move.frames); return { x: Math.round(move.startX + (move.endX - move.startX) * progress), y: Math.round(move.startY + (move.endY - move.startY) * progress), complete: progress >= 1 }; }
function advanceMoves(state, frames) { const amount = frames === Infinity ? Infinity : Math.max(0, Number(frames) || 0); for (let slot = 0; slot < 4; slot += 1) { const move = state.activeMoves[slot]; if (!move) continue; move.elapsed = amount === Infinity ? move.frames : Math.min(move.frames, move.elapsed + amount); const position = currentMovePosition(move, move.elapsed); if (state.sprites[slot]) { state.sprites[slot].x = position.x; state.sprites[slot].y = position.y; } if (position.complete) state.activeMoves[slot] = null; } }
function removePhysical(state, slot) { for (const physical of ['A', 'B']) if (state.physical[physical] === slot) state.physical[physical] = null; }
function allocatePhysical(state, slot) {
  for (const physical of ['A', 'B']) if (state.physical[physical] === slot) return { physical, evictedSlot: null };
  const physical = state.physical.next; const evictedSlot = state.physical[physical];
  if (evictedSlot != null) state.activeMoves[evictedSlot] = null;
  state.physical.next = physical === 'A' ? 'B' : 'A'; state.physical[physical] = slot;
  return { physical, evictedSlot };
}
function restorePhysical(state) { state.physical.A = null; state.physical.B = null; const visible = state.sprites.map((sprite, slot) => ({ sprite, slot })).filter((entry) => entry.sprite?.visible).sort((a, b) => a.sprite.touched - b.sprite.touched); visible.slice(-2).forEach((entry) => allocatePhysical(state, entry.slot)); }
function cancelMoves(state) { advanceMoves(state, 0); state.activeMoves = [null, null, null, null]; }

function actorPosition(sprite) { return { x: clampInt((Number(sprite?.x) || 0) * 160 / 320, -64, 255, 0), y: clampInt((Number(sprite?.y) || 0) * 144 / 224 + 48, -64, 255, 48) }; }

function actorMoveTiming(plan) {
  const start = actorPosition({ x: plan.move?.startX, y: plan.move?.startY }); const end = actorPosition({ x: plan.move?.endX, y: plan.move?.endY }); const dx = Math.abs(end.x - start.x); const dy = Math.abs(end.y - start.y); const distance = Math.max(dx, dy); const sourceFrames = Math.max(1, Number(plan.move?.frames) || 1); const candidates = [0.25, 0.5, 1, 2, 3, 4]; let best = null;
  for (const speed of candidates) { const frames = distance ? Math.max(1, Math.ceil(distance / speed)) : 0; const error = Math.abs(frames - sourceFrames); if (!best || error < best.error || (error === best.error && frames < best.frames)) best = { speed, frames, error }; }
  return { ...best, sourceFrames, distance, timingErrorFrames: best.frames - sourceFrames, start, end, moveType: dx && dy ? 'diagonal' : (dx >= dy ? 'horizontal' : 'vertical') };
}

function commandAnimationPlayback(assetsById, assetId, animationId = 'default') {
  const asset = assetsById?.get(assetId); const animations = asset?.options?.animations;
  if (!Array.isArray(animations) || !animations.length) return { id: animationId || 'default', loop: true, frameCount: 1, delays: [1] };
  const raw = animations.find((animation) => String(animation.id || 'default') === String(animationId || 'default')) || animations[0]; const frameCount = clampInt(raw.frameCount, 1, 256, 1);
  return { id: String(raw.id || animationId || 'default'), loop: raw.loop !== false, frameCount, delays: Array.from({ length: frameCount }, (_, index) => clampInt(raw.frameDelays?.[index] ?? raw.frameDelay, 1, 65535, 1)) };
}

function visualEffectMapping(command) {
  if (command?.type !== 'effect') return null;
  const sourceFrames = Math.max(0, Math.round(Number(command.frames) || 0));
  if (command.effect === 'fadeIn' || command.effect === 'fadeOut') {
    const supported = [5, 10, 20, 40, 80, 160, 320]; const generatedFrames = supported.reduce((best, value) => { const error = Math.abs(value - sourceFrames); const bestError = Math.abs(best - sourceFrames); return error < bestError || (error === bestError && value < best) ? value : best; }, supported[0]);
    return { effect: command.effect, sourceFrames, generatedFrames, speed: String(supported.indexOf(generatedFrames)), timingErrorFrames: generatedFrames - sourceFrames, exact: generatedFrames === sourceFrames };
  }
  if (command.effect === 'flash') {
    const sourceColor = /^#?[0-9a-f]{6}$/i.test(String(command.color || '')) ? `#${String(command.color).replace(/^#/, '').toLowerCase()}` : '#ffffff'; const rgb = [1, 3, 5].map((at) => parseInt(sourceColor.slice(at, at + 2), 16)); const generatedColor = colorDistance(rgb, [255, 255, 255]) <= colorDistance(rgb, [0, 0, 0]) ? '#ffffff' : '#000000';
    return { effect: 'flash', sourceFrames, generatedFrames: sourceFrames, timingErrorFrames: 0, sourceColor, generatedColor, colorDistance: Number(Math.sqrt(colorDistance(rgb, generatedColor === '#ffffff' ? [255, 255, 255] : [0, 0, 0])).toFixed(4)), exact: sourceColor === generatedColor };
  }
  if (command.effect === 'shake') return { effect: 'shake', sourceFrames, generatedFrames: sourceFrames, timingErrorFrames: 0, direction: 'diagonal', sourceIntensity: Number(command.intensity) || 0, generatedIntensity: Number(command.intensity) || 0, exact: true };
  if (command.effect === 'blank') return { effect: 'blank', sourceFrames: 0, generatedFrames: 0, timingErrorFrames: 0, exact: true };
  return null;
}

function normalizeRgbHex(value, fallback = '#ffffff') {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || ''));
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function isScenarioSelectorPrompt(value) { return /シナリオ[\s\u3000]*選択/u.test(String(value || '').normalize('NFKC')); }

function isTitleOrSelectorScene(scene) {
  if (!scene) return false;
  const identity = `${scene.id || ''}\n${scene.name || ''}`.normalize('NFKC');
  if (/タイトル|シナリオ[\s\u3000]*選択/u.test(identity)) return true;
  if (/(?:^|[\/_.:\s-])title(?:$|[\/_.:\s-])/iu.test(identity)) return true;
  return (scene.commands || []).some((command) => command?.type === 'spritetext' && command.visible !== false && isScenarioSelectorPrompt(command.text));
}

function spriteTextMapping(command, options = {}) {
  const sourceColor = normalizeRgbHex(command?.color); const titleSceneBlack = Boolean(options.titleScene); const renderedColor = titleSceneBlack ? '#000000' : sourceColor; const rgb = [1, 3, 5].map((at) => parseInt(renderedColor.slice(at, at + 2), 16));
  const gbcRgb = rgb.map((value) => Math.round(Math.round(value * 31 / 255) * 255 / 31)); let dmgRgb = DMG_COLORS[0]; let dmgError = Infinity;
  for (const candidate of DMG_COLORS) { const error = colorDistance(rgb, candidate); if (error < dmgError) { dmgError = error; dmgRgb = candidate; } }
  const scaledX = Math.round((Number(command?.x) || 0) * 160 / 320); const scaledY = Math.round((Number(command?.y) || 0) * 144 / 224); const selectorPromptMarginY = titleSceneBlack && isScenarioSelectorPrompt(command?.text) ? TITLE_SPRITETEXT_PROMPT_MARGIN_Y : 0; const generatedX = Math.max(0, Math.min(160 - 8, scaledX)); const generatedY = Math.max(0, scaledY + selectorPromptMarginY);
  const mapping = {
    slot: clampInt(command?.slot, 0, 3, 0), content: String(command?.text || ''), contentFidelity: 'exact',
    sourcePosition: { x: Number(command?.x) || 0, y: Number(command?.y) || 0 }, scaledPosition: { x: scaledX, y: scaledY }, generatedPosition: { x: generatedX, y: generatedY }, positionFidelity: generatedX === scaledX && generatedY === scaledY ? 'exact' : 'approximated',
    color: { source: sourceColor, rendered: renderedColor, gbc: `#${hexColor(gbcRgb).toLowerCase()}`, dmg: `#${hexColor(dmgRgb).toLowerCase()}` },
    colorFidelity: sourceColor === renderedColor && gbcRgb.every((value, index) => value === rgb[index]) && dmgRgb.every((value, index) => value === rgb[index]) ? 'exact' : 'approximated',
    policy: { titleSceneBlack, selectorPromptMarginY },
    blinkFrames: clampInt(command?.blinkFrames, 0, 65535, 0), visible: command?.visible !== false,
  };
  return mapping;
}

function applyVisualCommand(state, command, plan, options = {}) {
  if (command.type === 'wait') advanceMoves(state, command.frames);
  if (command.type === 'message' || command.type === 'choice' || (command.type === 'inputcheck' && command.mode === 'sync')) advanceMoves(state, Infinity);
  if (command.type === 'effect') { const mapping = visualEffectMapping(command); plan.action = command.effect; plan.effect = mapping; if (mapping && !mapping.exact) plan.fidelity = 'approximated'; if (command.effect !== 'blank') advanceMoves(state, mapping?.generatedFrames || 0); }
  if (command.type === 'sprite') {
    const slot = clampInt(command.slot, 0, 3, 0); state.activeMoves[slot] = null; const beforePhysical = ['A', 'B'].find((physical) => state.physical[physical] === slot) || '';
    if (command.visible === false) { if (state.sprites[slot]) state.sprites[slot].visible = false; removePhysical(state, slot); plan.physical = beforePhysical; plan.action = 'hide'; }
    else { const playback = commandAnimationPlayback(options.assetsById, command.assetId, command.animationId || 'default'); state.touch += 1; state.sprites[slot] = { assetId: command.assetId, x: command.x, y: command.y, animationId: playback.id, frameIndex: !playback.loop && playback.frameCount > 1 ? playback.frameCount - 1 : 0, flipX: Boolean(command.flipX), flipY: Boolean(command.flipY), visible: true, touched: state.touch }; if (!playback.loop && playback.frameCount > 1) plan.animationPlayback = playback; if (state.blank) { removePhysical(state, slot); plan.physical = ''; plan.evictedSlot = null; plan.action = 'show-deferred-while-blank'; } else { const allocated = allocatePhysical(state, slot); plan.physical = allocated.physical; plan.evictedSlot = allocated.evictedSlot; plan.action = 'show'; } }
  }
  if (command.type === 'spritemove') {
    const slot = clampInt(command.slot, 0, 3, 0); const sprite = state.sprites[slot]; plan.physical = ['A', 'B'].find((physical) => state.physical[physical] === slot) || ''; plan.action = command.async ? 'move-async' : 'move-sync'; if (!sprite) { plan.missingSlot = true; return; }
    if (command.animationId) { const playback = commandAnimationPlayback(options.assetsById, sprite.assetId, command.animationId); sprite.animationId = playback.id; sprite.frameIndex = !playback.loop && playback.frameCount > 1 ? playback.frameCount - 1 : 0; if (!playback.loop && playback.frameCount > 1) plan.animationPlayback = playback; } const move = { startX: sprite.x, startY: sprite.y, endX: command.x, endY: command.y, frames: Math.max(1, Number(command.frames) || 1), elapsed: 0, async: Boolean(command.async), sourceKey: plan.sourceKey }; plan.move = clone(move);
    if (command.async) state.activeMoves[slot] = move; else { sprite.x = command.x; sprite.y = command.y; state.activeMoves[slot] = null; advanceMoves(state, move.frames); }
  }
  if (command.type === 'spritetext') { const slot = clampInt(command.slot, 0, 3, 0); plan.action = command.visible === false ? 'text-hide' : 'text-show'; plan.spriteText = spriteTextMapping(command, options); if ((plan.spriteText.colorFidelity === 'approximated' || plan.spriteText.positionFidelity === 'approximated') && command.visible !== false) plan.fidelity = 'approximated'; if (command.visible === false) state.spriteTexts[slot] = null; else state.spriteTexts[slot] = { text: String(command.text || ''), x: command.x, y: command.y, generatedX: plan.spriteText.generatedPosition.x, generatedY: plan.spriteText.generatedPosition.y, sourceColor: plan.spriteText.color.source, color: plan.spriteText.color.rendered, blinkFrames: command.blinkFrames || 0, visible: true }; }
  if (command.type === 'effect' && command.effect === 'blank') { cancelMoves(state); state.blank = true; state.physical.A = null; state.physical.B = null; plan.action = 'blank'; }
}

function remainingMoveTracks(state) {
  return (state?.activeMoves || []).map((move, slot) => { if (!move) return null; const sprite = state.sprites?.[slot]; const remaining = Math.max(0, Number(move.frames) - Number(move.elapsed)); if (!sprite || !remaining) return null; return { ...clone(move), slot, startX: sprite.x, startY: sprite.y, frames: remaining, elapsed: 0 }; }).filter(Boolean);
}

function coalesceBakedMoveGroups(segment, commands, timelineSpecs) {
  if (segment.visualPlans?.[0]?.renderMode !== 'baked') return;
  for (let index = 0; index < commands.length; index += 1) {
    if (commands[index]?.type !== 'spritemove' || !commands[index].async) continue;
    let syncIndex = index; while (commands[syncIndex]?.type === 'spritemove' && commands[syncIndex].async) syncIndex += 1;
    if (commands[syncIndex]?.type !== 'spritemove' || commands[syncIndex].async) { index = syncIndex - 1; continue; }
    const memberIndexes = Array.from({ length: syncIndex - index + 1 }, (_, offset) => index + offset); const plans = memberIndexes.map((at) => segment.visualPlans[at]);
    if (plans.some((plan) => !plan?.move || !plan.timelineId)) { index = syncIndex; continue; }
    const oldTimelineIds = new Set(plans.map((plan) => plan.timelineId)); const effectiveMoves = new Map();
    remainingMoveTracks(plans[0].beforeState).forEach((move) => effectiveMoves.set(Number(move.slot), move));
    plans.forEach((plan, memberIndex) => effectiveMoves.set(Number(commands[memberIndexes[memberIndex]].slot), { ...clone(plan.move), slot: Number(commands[memberIndexes[memberIndex]].slot), sourceKey: plan.sourceKey, animationId: commands[memberIndexes[memberIndex]].animationId || '' }));
    const firstPlan = plans[0]; const syncPlan = plans.at(-1); const beforeState = clone(firstPlan.beforeState); const boundaryState = clone(syncPlan.afterState); const finalState = clone(boundaryState); advanceMoves(finalState, Infinity);
    const sourceKeys = plans.map((plan) => plan.sourceKey); const id = `${segment.key}:visual:${index}-${syncIndex}:move-group`; const durationFrames = Math.max(...[...effectiveMoves.values()].map((move) => move.frames));
    for (let at = timelineSpecs.length - 1; at >= 0; at -= 1) if (oldTimelineIds.has(timelineSpecs[at].id)) timelineSpecs.splice(at, 1);
    segment.visualTimelineIds = segment.visualTimelineIds.filter((timelineId) => !oldTimelineIds.has(timelineId)); segment.visualTimelineIds.push(id);
    plans.forEach((plan, memberIndex) => { plan.timelineId = id; plan.coalescedRole = memberIndex === 0 ? 'group-start' : (memberIndex === plans.length - 1 ? 'group-sync' : 'group-member'); plan.coalescedSourceKeys = sourceKeys; });
    timelineSpecs.push({ id, segmentKey: segment.key, commandIndex: index, sourceKey: firstPlan.sourceKey, kind: 'spritemove-group', renderMode: 'baked', beforeState, afterState: boundaryState, renderAfterState: finalState, durationFrames, syncWaitFrames: syncPlan.move.frames, async: true, moves: [...effectiveMoves.values()], slot: null, plan: firstPlan, coalescedSourceKeys: sourceKeys });
    index = syncIndex;
  }
}

function specializeVisualStates(graph, sceneDoc, options = {}) {
  const renderMode = normalizePortraitRenderMode(options.renderMode); const baseSegments = graph.segments; const baseByKey = new Map(baseSegments.map((segment) => [segment.key, segment])); const sceneById = new Map((sceneDoc?.scenes || []).map((scene) => [String(scene.id || ''), scene])); const byPair = new Map(); const specialized = []; const processed = new Set(); const timelineSpecs = [];
  const prepareEntry = (base, incoming, fromSceneId, sourceSceneEntry = false) => { const state = clone(incoming); const enteringSourceScene = sourceSceneEntry || fromSceneId !== base.sourceSceneId; if (enteringSourceScene) state.spriteTexts = [null, null, null, null]; if (enteringSourceScene && base.fullScreen) { state.sprites = [null, null, null, null]; state.physical = { A: null, B: null, next: 'A' }; state.activeMoves = [null, null, null, null]; state.blank = false; } if (base.backgroundSource === 'explicit' && !base.fullScreen && state.blank) { state.blank = false; restorePhysical(state); } return state; };
  const ensure = (baseKey, incoming, reachable, fromSceneId = '', sourceSceneEntry = false) => { const base = baseByKey.get(baseKey); if (!base) return null; const entryState = prepareEntry(base, incoming, fromSceneId, sourceSceneEntry); entryState.touch = Math.max(0, ...(entryState.sprites || []).map((sprite) => Number(sprite?.touched) || 0)); if (fromSceneId) cancelMoves(entryState); const entryHash = visualStateHash(serializableVisualState(entryState)); const pair = `${baseKey}\0${entryHash}`; if (byPair.has(pair)) { const existing = byPair.get(pair); existing.reachable ||= reachable; return existing; } const key = `${base.key}::vs_${entryHash.slice(0, 12)}`; const segment = { ...base, key, backgroundStateKey: base.key, visualStateId: entryHash, entryVisualState: serializableVisualState(entryState), exitVisualState: null, visualPlans: [], visualTimelineIds: [], edges: [], targetMap: {}, nextKey: '', reachable: Boolean(reachable) }; const state = clone(entryState);
    const sourceScene = sceneById.get(String(base.sourceSceneId || '')); const visualOptions = { ...options, sourceScene, titleScene: isTitleOrSelectorScene(sourceScene) };
    base.commands.forEach((command, commandIndex) => { const plan = { commandIndex, sourceKey: command?._gbvnSource?.key || '', type: command?.type || '', beforeStateId: visualStateHash(serializableVisualState(state)), action: '', renderMode, fidelity: 'exact', generated: { actors: [], tilesets: [], events: [] } }; const before = serializableVisualState(state); applyVisualCommand(state, command, plan, visualOptions); plan.beforeState = before; plan.afterState = serializableVisualState(state); plan.afterStateId = visualStateHash(plan.afterState); if (['sprite', 'spritemove', 'spritetext'].includes(command?.type) || (command?.type === 'effect' && command.effect === 'blank')) { const id = `${key}:visual:${commandIndex}`; const carriedMoves = remainingMoveTracks(plan.afterState); const syncStartMoves = command.type === 'spritemove' && plan.move && !command.async ? remainingMoveTracks(plan.beforeState).filter((move) => Number(move.slot) !== Number(command.slot)) : carriedMoves; let moves = carriedMoves; if (command.type === 'spritemove' && plan.move && !command.async) moves = [...syncStartMoves, { ...clone(plan.move), slot: Number(command.slot), animationId: command.animationId || '' }]; let durationFrames = command.type === 'spritemove' ? Math.max(1, Number(command.frames) || 1) : 0; if (moves.length) durationFrames = Math.max(durationFrames, ...moves.map((move) => Number(move.frames) || 0)); if (plan.animationPlayback) durationFrames = Math.max(durationFrames, plan.animationPlayback.delays.reduce((sum, value) => sum + value, 0)); let renderAfterState = plan.afterState; if (moves.length) { const renderState = clone(plan.afterState); const alreadyAdvancedFrames = command.type === 'spritemove' && !command.async ? Math.max(1, Number(command.frames) || 1) : 0; advanceMoves(renderState, Math.max(0, durationFrames - alreadyAdvancedFrames)); renderAfterState = serializableVisualState(renderState); } plan.renderAfterState = renderAfterState; plan.renderAfterStateId = visualStateHash(renderAfterState); plan.timelineId = id; segment.visualTimelineIds.push(id); const carriedAsync = syncStartMoves.length > 0; timelineSpecs.push({ id, segmentKey: key, commandIndex, sourceKey: plan.sourceKey, kind: command.type === 'effect' ? command.effect : command.type, renderMode, beforeState: before, afterState: plan.afterState, renderAfterState, durationFrames, async: Boolean(command.async) || Boolean(plan.animationPlayback) || carriedAsync, syncWaitFrames: command.type === 'spritemove' && !command.async && carriedAsync ? Math.max(1, Number(command.frames) || 1) : 0, move: plan.move || null, moves, animationPlayback: plan.animationPlayback || null, slot: command.slot, plan }); }
      segment.visualPlans.push(plan); }); coalesceBakedMoveGroups(segment, base.commands, timelineSpecs); segment.exitVisualState = serializableVisualState(state); segment.exitVisualProgress = [];
    if (renderMode === 'baked') for (const spec of timelineSpecs.filter((entry) => entry.segmentKey === segment.key && entry.async)) { const sourceKeys = new Set([spec.sourceKey, ...(spec.coalescedSourceKeys || []), ...(spec.moves || []).map((move) => move.sourceKey)].filter(Boolean)); const active = (segment.exitVisualState.activeMoves || []).filter((move) => move && sourceKeys.has(move.sourceKey)); if (!active.length) continue; const sourceFrame = Math.max(0, ...active.map((move) => Number(move.elapsed) || 0)); spec.transitionSampleFrames = [...new Set([...(spec.transitionSampleFrames || []), sourceFrame])].sort((left, right) => left - right); segment.exitVisualProgress.push({ timelineId: spec.id, sourceFrame }); }
    byPair.set(pair, segment); specialized.push(segment); return segment; };
  const traverse = (seeds, reachable) => { const queue = [...seeds]; while (queue.length) { const item = queue.shift(); const segment = ensure(item.baseKey, item.state, reachable, item.fromSceneId, item.sourceSceneEntry); if (!segment) continue; const marker = `${segment.key}\0${reachable ? 'r' : 'u'}`; if (processed.has(marker)) continue; processed.add(marker); const base = baseByKey.get(segment.backgroundStateKey); for (const edge of base.edges || []) { const sourceSceneEntry = ['jump', 'choice'].includes(edge.kind); const target = ensure(edge.target, segment.exitVisualState, reachable, segment.sourceSceneId, sourceSceneEntry); if (!target) continue; segment.targetMap[edge.target] = target.key; if (edge.originTarget) segment.targetMap[edge.originTarget] = target.key; if (!segment.edges.some((candidate) => candidate.target === target.key && candidate.kind === edge.kind)) segment.edges.push({ ...edge, target: target.key }); queue.push({ baseKey: edge.target, state: segment.exitVisualState, fromSceneId: segment.sourceSceneId, sourceSceneEntry }); } if (base.nextKey && base.fallthrough) segment.nextKey = segment.targetMap[base.nextKey] || ''; } };
  const startBase = graph.startKey; if (startBase) traverse([{ baseKey: startBase, state: initialVisualState(), fromSceneId: '' }], true); for (const base of baseSegments.filter((segment) => !segment.reachable)) if (!specialized.some((segment) => segment.backgroundStateKey === base.key)) traverse([{ baseKey: base.key, state: initialVisualState(), fromSceneId: '' }], false);
  specialized.forEach((segment, index) => { segment.sourceIndex = index; }); const start = specialized.find((segment) => segment.backgroundStateKey === startBase && segment.reachable); const incoming = new Map(specialized.map((segment) => [segment.key, 0])); specialized.forEach((segment) => segment.edges.forEach((edge) => incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)));
  const firstTargets = {}; for (const [sceneId, baseTarget] of Object.entries(graph.firstTargets || {})) { const match = specialized.find((segment) => segment.backgroundStateKey === baseTarget && segment.reachable) || specialized.find((segment) => segment.backgroundStateKey === baseTarget); if (match) firstTargets[sceneId] = match.key; }
  const labelTargets = {}; for (const [label, baseTarget] of Object.entries(graph.labelTargets || {})) { const match = specialized.find((segment) => segment.backgroundStateKey === baseTarget && segment.reachable) || specialized.find((segment) => segment.backgroundStateKey === baseTarget); if (match) labelTargets[label] = match.key; }
  return { ...graph, segments: specialized, startKey: start?.key || '', firstTargets, labelTargets, reachable: specialized.filter((segment) => segment.reachable).map((segment) => segment.key), unreachableSpecialized: specialized.filter((segment) => !segment.reachable).map((segment) => segment.key), joins: specialized.filter((segment) => (incoming.get(segment.key) || 0) > 1).map((segment) => ({ key: segment.key, originBlockKey: segment.originBlockKey, incoming: incoming.get(segment.key) })), incoming: Object.fromEntries(incoming), visual: { renderMode, timelineSpecs } };
}

function drawImage(target, source, left, top, options = {}) { const flipX = Boolean(options.flipX); const flipY = Boolean(options.flipY); for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) { const sx = flipX ? source.width - 1 - x : x; const sy = flipY ? source.height - 1 - y : y; const sourceAt = (sy * source.width + sx) * 4; if (!source.rgba[sourceAt + 3]) continue; const dx = left + x; const dy = top + y; if (dx < 0 || dy < 0 || dx >= target.width || dy >= target.height) continue; target.rgba.set(source.rgba.subarray(sourceAt, sourceAt + 4), (dy * target.width + dx) * 4); } }

function bakedSpriteFrame(transformed, sprite) { const animation = transformed.animations.find((entry) => entry.id === sprite.animationId) || transformed.animations[0]; const frameIndex = clampInt(sprite?.frameIndex, 0, Math.max(0, animation.frames.length - 1), 0); const frame = animation.frames[frameIndex] || animation.frames[0]; const adjusted = adjustBackgroundImage(frame.image, { brightness: transformed.settings.brightness, saturation: transformed.settings.saturation, artworkHeight: frame.image.height }); const crop = transformed.settings.crop ? { ...transformed.settings.crop } : opaqueBounds(adjusted); return cropImage(adjusted, crop.x, crop.y, crop.width, crop.height); }

function drawScaled(target, source, left, top, width, height, options = {}) { const scaled = image(width, height); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const sx = Math.min(source.width - 1, Math.floor(x * source.width / width)); const sy = Math.min(source.height - 1, Math.floor(y * source.height / height)); scaled.rgba.set(source.rgba.subarray((sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4), (y * width + x) * 4); } drawImage(target, scaled, left, top, options); }

function drawSpriteText(model, target, spriteText) {
  if (!spriteText?.visible || spriteText.blinkHidden || !spriteText.text) return { glyphs: 0, wrappedLines: 0 };
  const unitId = Object.keys(model.font.assignments || {}).find((id) => id.endsWith(':spritetext') && model.textUnits.find((unit) => unit.id === id)?.text === spriteText.text); const pageIndex = unitId == null ? 0 : model.font.assignments[unitId]; const page = model.font.pages[pageIndex] || model.font.pages[0]; if (!page) return { glyphs: 0, wrappedLines: 0 };
  const atlas = readRgbaPng(page.png); const rgb = /^#?([0-9a-f]{6})$/i.exec(String(spriteText.color || '#ffffff')); const color = rgb ? [parseInt(rgb[1].slice(0, 2), 16), parseInt(rgb[1].slice(2, 4), 16), parseInt(rgb[1].slice(4, 6), 16)] : [255, 255, 255]; const mappedX = Number.isFinite(spriteText.generatedX) ? spriteText.generatedX : Math.round((Number(spriteText.x) || 0) * 160 / 320); const mappedY = Number.isFinite(spriteText.generatedY) ? spriteText.generatedY : Math.round((Number(spriteText.y) || 0) * 144 / 224); let x = Math.max(0, Math.min(target.width - 8, mappedX)); let y = Math.max(0, mappedY); const startX = x; let glyphs = 0; let wrappedLines = 1;
  for (const glyph of Array.from(String(spriteText.text || '').normalize('NFC'))) { if (glyph === '\n') { x = startX; y += 8; wrappedLines += 1; continue; } if (x + 8 > target.width) { x = startX; y += 8; wrappedLines += 1; } if (y + 8 > target.height) { const error = new Error(`SpriteTextが画面下端を超えます: ${spriteText.text}`); error.code = 'GBVN_SPRITETEXT_BOTTOM_OVERFLOW'; throw error; } const code = page.mapping[glyph]; if (code != null) { const tile = code - 32; const sx = (tile % 16) * 8; const sy = Math.floor(tile / 16) * 8; for (let gy = 0; gy < 8; gy += 1) for (let gx = 0; gx < 8; gx += 1) { const sourceAt = ((sy + gy) * atlas.width + sx + gx) * 4; if (luminance([atlas.rgba[sourceAt], atlas.rgba[sourceAt + 1], atlas.rgba[sourceAt + 2]]) < 128) target.rgba.set([...color, 255], ((y + gy) * target.width + x + gx) * 4); } } x += 8; glyphs += 1; }
  return { glyphs, wrappedLines };
}

function composeVisualState(model, baseImage, state, mode, spriteTransforms) {
  const output = { width: baseImage.width, height: baseImage.height, rgba: new Uint8Array(baseImage.rgba) }; if (state?.blank) { for (let index = 0; index < output.width * output.height; index += 1) output.rgba.set([224, 248, 207, 255], index * 4); return { image: output, metrics: { sprites: 0, spriteTextGlyphs: 0 } }; }
  let spriteCount = 0; if (model.settings.portraitRenderMode === 'baked') for (let slot = 0; slot < 4; slot += 1) { const sprite = state?.sprites?.[slot]; if (!sprite?.visible) continue; const transformed = spriteTransforms.get(sprite.assetId); if (!transformed) continue; const frame = bakedSpriteFrame(transformed, sprite); const scale = transformed.settings.scale / 100; const width = Math.max(1, Math.round(frame.width * 160 / 320 * scale)); const height = Math.max(1, Math.round(frame.height * 144 / 224 * scale)); const left = Math.round(sprite.x * 160 / 320) + transformed.settings.offsetX; const top = Math.round(sprite.y * 144 / 224) + transformed.settings.offsetY; drawScaled(output, frame, left, top, width, height, { flipX: sprite.flipX, flipY: sprite.flipY }); spriteCount += 1; }
  let glyphs = 0; for (const spriteText of state?.spriteTexts || []) glyphs += drawSpriteText(model, output, spriteText).glyphs; return { image: output, metrics: { sprites: spriteCount, spriteTextGlyphs: glyphs, mode } };
}

function actorAuditStates(segment) {
  const candidates = [{ source: 'entry', state: segment.entryVisualState }, { source: 'exit', state: segment.exitVisualState }];
  for (const plan of segment.visualPlans || []) {
    candidates.push({ source: `${plan.commandIndex}:before`, state: plan.beforeState }, { source: `${plan.commandIndex}:after`, state: plan.afterState }, { source: `${plan.commandIndex}:rendered`, state: plan.renderAfterState });
    if (plan.move) { const slot = Number(segment.commands?.[plan.commandIndex]?.slot); const start = actorPosition({ x: plan.move.startX, y: plan.move.startY }); const end = actorPosition({ x: plan.move.endX, y: plan.move.endY }); const steps = Math.max(1, Math.abs(end.y - start.y)); const spec = { kind: 'spritemove', move: plan.move, slot, durationFrames: plan.move.frames, beforeState: plan.beforeState, afterState: plan.afterState, renderAfterState: plan.renderAfterState || plan.afterState }; for (let step = 1; step < steps; step += 1) candidates.push({ source: `${plan.commandIndex}:move:${step}/${steps}`, state: timelineStateAtTime(spec, plan.move.frames * step / steps) }); }
  }
  const seen = new Set(); return candidates.filter((entry) => { if (!entry.state) return false; const key = visualStateHash(serializableVisualState(entry.state)); if (seen.has(key)) return false; seen.add(key); return true; });
}

function actorPairAudits(model, spriteTransforms) {
  const pairs = []; const seen = new Set();
  for (const segment of model.graph.segments.filter((entry) => entry.reachable)) for (const stateEntry of actorAuditStates(segment)) { const state = stateEntry.state; const entries = ['A', 'B'].map((physical) => { const slot = state?.physical?.[physical]; const sprite = slot == null ? null : state.sprites?.[slot]; return sprite?.visible ? { physical, slot, ...sprite } : null; }).filter(Boolean); if (!entries.length) continue; const key = entries.map((entry) => `${entry.physical}:${entry.assetId}:${entry.animationId}:${entry.x}:${entry.y}:${entry.flipX ? 1 : 0}:${entry.flipY ? 1 : 0}`).join('|'); if (seen.has(key)) continue; seen.add(key); const modes = {};
    for (const mode of ['gbc', 'dmg']) {
      const candidates = entries.map((entry) => { const transformed = spriteTransforms.get(entry.assetId); if (!transformed) return [{ entry, metrics: null }]; const animation = transformed.animations.find((candidate) => candidate.id === entry.animationId) || transformed.animations[0]; return animation.frames.map((frame) => ({ entry, metrics: transformed.modes[mode].frames[transformed.frameIndex[frame.key]] })); });
      let totalObjects = 0; let maxScanlineObjects = 0; const combinations = candidates.length === 2 ? candidates[0].flatMap((left) => candidates[1].map((right) => [left, right])) : candidates[0].map((entry) => [entry]);
      for (const combination of combinations) { let objects = 0; const scanlines = new Uint16Array(144); for (const candidate of combination) { const metrics = candidate.metrics; if (!metrics) continue; objects += metrics.objects; const position = actorPosition(candidate.entry); for (const tile of metrics.occupied) { const top = position.y - SPRITE_CANVAS_HEIGHT + tile.ty * 16; for (let y = Math.max(0, top); y < Math.min(144, top + 16); y += 1) scanlines[y] += 1; } } totalObjects = Math.max(totalObjects, objects); maxScanlineObjects = Math.max(maxScanlineObjects, ...scanlines); }
      modes[mode] = { totalObjects, maxScanlineObjects, objectLimit: 40, scanlineLimit: 10, inspectedFrameCombinations: combinations.length };
    }
    pairs.push({ key, originBlockKey: segment.originBlockKey, segmentKey: segment.key, stateSource: stateEntry.source, entries, modes }); }
  return pairs;
}

function assertActorPairBudgets(pairs, renderMode = 'actor') {
  if (normalizePortraitRenderMode(renderMode) !== 'actor') return;
  for (const pair of pairs || []) for (const mode of ['gbc', 'dmg']) { const metrics = pair.modes?.[mode]; if (!metrics) continue; if (metrics.totalObjects > metrics.objectLimit || metrics.maxScanlineObjects > metrics.scanlineLimit) { const error = new Error(`actor OAM制約を超えています: ${pair.key} ${mode} OBJ ${metrics.totalObjects}/${metrics.objectLimit} scanline ${metrics.maxScanlineObjects}/${metrics.scanlineLimit}。crop/scaleを調整するか背景焼き込みmodeを選択してください`); error.code = 'GBVN_SPRITE_OAM_OVERFLOW'; error.pair = pair; throw error; } }
}

function tileDiffers(left, right, tx, ty) {
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const px = tx * 8 + x; const py = ty * 8 + y; const at = (py * left.width + px) * 4;
    for (let channel = 0; channel < 4; channel += 1) if (left.rgba[at + channel] !== right.rgba[at + channel]) return true;
  }
  return false;
}

function extractTile(source, tx, ty) {
  const output = image(8, 8);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const sourceAt = ((ty * 8 + y) * source.width + tx * 8 + x) * 4;
    output.rgba.set(source.rgba.subarray(sourceAt, sourceAt + 4), (y * 8 + x) * 4);
  }
  return output;
}

function packTiles(tiles) {
  const widthInTiles = Math.max(1, Math.min(16, tiles.length)); const heightInTiles = Math.max(1, Math.ceil(tiles.length / widthInTiles)); const output = image(widthInTiles * 8, heightInTiles * 8, [224, 248, 207, 255]);
  tiles.forEach((tile, index) => { const ox = (index % widthInTiles) * 8; const oy = Math.floor(index / widthInTiles) * 8; for (let y = 0; y < 8; y += 1) output.rgba.set(tile.rgba.subarray(y * 32, y * 32 + 32), ((oy + y) * output.width + ox) * 4); });
  return { image: output, widthInTiles, heightInTiles };
}

function movementTracks(spec) {
  if (Array.isArray(spec.moves) && spec.moves.length) return spec.moves;
  return spec.move ? [{ ...spec.move, slot: Number(spec.slot) }] : [];
}

function timelineStateAtTime(spec, time) {
  const tracks = movementTracks(spec); if (!tracks.length) return clone(time >= Number(spec.durationFrames || 0) ? spec.afterState : spec.beforeState);
  const target = spec.renderAfterState || spec.afterState; const state = clone(target); const elapsed = Math.max(0, Number(time) || 0);
  for (const move of tracks) { const slot = clampInt(move.slot, 0, 3, 0); const sprite = state.sprites?.[slot]; if (!sprite) continue; const ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, Number(move.frames) || 1))); sprite.x = Math.round((Number(move.startX) || 0) + ((Number(move.endX) || 0) - (Number(move.startX) || 0)) * ratio); sprite.y = Math.round((Number(move.startY) || 0) + ((Number(move.endY) || 0) - (Number(move.startY) || 0)) * ratio); if (move.animationId) sprite.animationId = move.animationId; }
  return state;
}

function timelineState(spec, ratio) { const bounded = Math.max(0, Math.min(1, ratio)); if (!movementTracks(spec).length) return clone(bounded >= 1 ? spec.afterState : spec.beforeState); return timelineStateAtTime(spec, Math.max(0, Number(spec.durationFrames) || 0) * bounded); }

function movementTimelineSequence(spec, limit) {
  const duration = Math.max(1, Number(spec.durationFrames) || 1); const required = new Set([0, duration]); if (Number(spec.syncWaitFrames) > 0 && Number(spec.syncWaitFrames) < duration) required.add(Number(spec.syncWaitFrames));
  for (const move of movementTracks(spec)) if (Number(move.frames) > 0 && Number(move.frames) < duration) required.add(Number(move.frames));
  for (const sample of spec.transitionSampleFrames || []) if (Number(sample) >= 0 && Number(sample) <= duration) required.add(Number(sample));
  const boundaries = new Set(required); for (let index = 1; index < limit - 1; index += 1) boundaries.add(Math.round(duration * index / Math.max(1, limit - 1)));
  let times = [...boundaries].sort((a, b) => a - b);
  if (times.length > limit) { const optional = times.filter((time) => !required.has(time)); const keep = new Set(required); const remaining = Math.max(0, limit - keep.size); for (let index = 0; index < remaining && optional.length; index += 1) keep.add(optional[Math.round(index * (optional.length - 1) / Math.max(1, remaining - 1))]); times = [...keep].sort((a, b) => a - b); }
  return { times, stateTimes: [0, ...times], states: [clone(spec.beforeState), ...times.map((time) => timelineStateAtTime(spec, time))], durations: [0, ...times.slice(1).map((time, index) => time - times[index])], duration };
}

const timelineTileCache = new Map();
function quantizeTimelineTile(tile, mode) {
  const cacheKey = `${mode}:${sha256(tile.rgba)}`; const cached = timelineTileCache.get(cacheKey); if (cached) return cached; const output = image(8, 8); let palette;
  if (mode === 'dmg') palette = DMG_COLORS;
  else { const colors = []; for (let index = 0; index < tile.rgba.length; index += 4) colors.push([tile.rgba[index], tile.rgba[index + 1], tile.rgba[index + 2]].map((value) => Math.round(Math.round(value * 31 / 255) * 255 / 31))); palette = medianCutPalette(colors, 4); }
  for (let index = 0; index < 64; index += 1) { const at = index * 4; const color = [tile.rgba[at], tile.rgba[at + 1], tile.rgba[at + 2]]; let chosen = palette[0]; let error = Infinity; for (const candidate of palette) { const next = colorDistance(color, candidate); if (next < error) { error = next; chosen = candidate; } } output.rgba.set([...chosen, 255], at); }
  if (timelineTileCache.size > 100000) timelineTileCache.clear(); timelineTileCache.set(cacheKey, output); return output;
}

function quantizeTimelineFrame(model, background, state, mode) {
  const composed = composeVisualState(model, background.basePrepared, state, mode, model.visual.spriteTransforms || new Map()).image; const converted = image(composed.width, composed.height);
  for (let ty = 0; ty < 18; ty += 1) for (let tx = 0; tx < 20; tx += 1) { const tile = quantizeTimelineTile(extractTile(composed, tx, ty), mode); for (let y = 0; y < 8; y += 1) converted.rgba.set(tile.rgba.subarray(y * 32, y * 32 + 32), ((ty * 8 + y) * converted.width + tx * 8) * 4); }
  return { source: composed, converted };
}

function bakedSpritePreviewFrames(model, background, transformed, options = {}) {
  const mode = options.mode === 'dmg' ? 'dmg' : 'gbc'; const animation = transformed.animations.find((entry) => entry.id === options.animationId) || transformed.animations[0]; const slot = clampInt(options.slot, 0, 3, 0);
  return animation.frames.map((_frame, frameIndex) => {
    const state = initialVisualState(); state.sprites[slot] = { assetId: transformed.assetId, x: Number(options.x) || 0, y: Number(options.y) || 0, animationId: animation.id, frameIndex, flipX: Boolean(options.flipX), flipY: Boolean(options.flipY), visible: true, touched: 1 };
    const rendered = quantizeTimelineFrame(model, background, state, mode); return { ...rendered, sourceHash: sha256(encodeRgbaPng(rendered.source)), outputHash: sha256(encodeRgbaPng(rendered.converted)) };
  });
}

function stableResourceStem(value, helpers, fallback) {
  const readable = helpers.slug(value, fallback).slice(0, 43) || fallback;
  return `${readable}_${sha256(String(value || fallback)).slice(0, 12)}`;
}

function animationTimelineSequence(spec, maxStates) {
  const playback = spec.animationPlayback; const frameCount = Math.max(1, playback.frameCount); const animationFrames = playback.delays.reduce((sum, value) => sum + value, 0); const tracks = movementTracks(spec); const movementFrames = Math.max(0, ...tracks.map((move) => Number(move.frames) || 0)); const totalFrames = Math.max(animationFrames, movementFrames); const required = new Set([0, totalFrames]); const boundaries = new Set(required); let elapsed = 0;
  for (let index = 0; index < playback.delays.length - 1; index += 1) { elapsed += playback.delays[index]; boundaries.add(Math.min(totalFrames, elapsed)); }
  for (const move of tracks) if (Number(move.frames) > 0 && Number(move.frames) < totalFrames) { required.add(Number(move.frames)); boundaries.add(Number(move.frames)); }
  for (const sample of spec.transitionSampleFrames || []) if (Number(sample) >= 0 && Number(sample) <= totalFrames) { required.add(Number(sample)); boundaries.add(Number(sample)); }
  if (movementFrames) for (let index = 1; index < 16; index += 1) boundaries.add(Math.min(totalFrames, Math.round(movementFrames * index / 16)));
  const sourceTimes = [...boundaries].sort((a, b) => a - b); const limit = Math.max(movementFrames ? 2 : 1, maxStates); let times = sourceTimes;
  if (times.length > limit) {
    const chosen = new Set(required); const optional = sourceTimes.filter((time) => !required.has(time)); const remaining = Math.max(0, limit - chosen.size); for (let index = 0; index < remaining && optional.length; index += 1) chosen.add(optional[Math.round(index * (optional.length - 1) / Math.max(1, remaining - 1))]);
    times = [...chosen].sort((a, b) => a - b);
  }
  const frameAt = (time) => { let at = 0; let sum = 0; while (at < playback.delays.length - 1 && time >= sum + playback.delays[at]) { sum += playback.delays[at]; at += 1; } return Math.min(frameCount - 1, at); };
  const target = spec.renderAfterState || spec.afterState; const states = times.map((time) => {
    const state = clone(target); const slot = clampInt(spec.slot, 0, 3, 0); const sprite = state.sprites?.[slot]; if (sprite) sprite.frameIndex = frameAt(time);
    for (const move of tracks) { const movingSlot = clampInt(move.slot, 0, 3, 0); const movingSprite = state.sprites?.[movingSlot]; if (!movingSprite) continue; const ratio = Math.max(0, Math.min(1, time / Math.max(1, Number(move.frames) || 1))); movingSprite.x = Math.round((Number(move.startX) || 0) + ((Number(move.endX) || 0) - (Number(move.startX) || 0)) * ratio); movingSprite.y = Math.round((Number(move.startY) || 0) + ((Number(move.endY) || 0) - (Number(move.startY) || 0)) * ratio); if (move.animationId) movingSprite.animationId = move.animationId; }
    return state;
  });
  const representedFrames = new Set(times.map(frameAt)); const omittedAttributes = representedFrames.size < frameCount ? [{ attribute: 'animationFrames', assetId: target?.sprites?.[clampInt(spec.slot, 0, 3, 0)]?.assetId || '', slot: clampInt(spec.slot, 0, 3, 0), sourceValue: frameCount, generatedValue: representedFrames.size, reason: 'tile-controller-budget' }] : [];
  return { states: [clone(spec.beforeState), ...states], durations: [0, ...times.slice(1).map((time, index) => time - times[index])], times, stateTimes: [0, ...times], totalFrames, sourceAnimationFrames: frameCount, generatedAnimationFrames: representedFrames.size, omittedAttributes };
}

function timelineModeArtifact(model, background, spec, mode, helpers) {
  const moving = spec.kind === 'spritemove' || spec.kind === 'spritemove-group' || movementTracks(spec).length > 0; const animating = Boolean(spec.animationPlayback); const candidates = animating ? (moving ? [16, 8, 4, 2] : [16, 8, 4, 2, 1]) : (moving ? [16, 8, 4, 2] : [2]); let selected = null;
  for (const keyframeCount of candidates) {
    const animationSequence = animating ? animationTimelineSequence(spec, keyframeCount) : null; const movementSequence = moving && !animating ? movementTimelineSequence(spec, keyframeCount) : null; const states = animationSequence?.states || movementSequence?.states || Array.from({ length: keyframeCount }, (_, index) => timelineState(spec, index / Math.max(1, keyframeCount - 1))); const frames = states.map((state) => quantizeTimelineFrame(model, background, state, mode)); const tileMap = new Map(); const tileImages = []; const steps = [];
    for (let frameIndex = 1; frameIndex < frames.length; frameIndex += 1) {
      const writes = []; for (let ty = 0; ty < 18; ty += 1) for (let tx = 0; tx < 20; tx += 1) if (tileDiffers(frames[frameIndex - 1].source, frames[frameIndex].source, tx, ty)) {
        const tile = extractTile(frames[frameIndex].converted, tx, ty); const identity = sha256(tile.rgba); let tileIndex = tileMap.get(identity); if (tileIndex == null) { tileIndex = tileImages.length; tileMap.set(identity, tileIndex); tileImages.push(tile); }
        writes.push({ x: tx, y: ty, tileIndex });
      }
      const targetFrames = animating ? (animationSequence.durations[frameIndex - 1] || 0) : (moving ? (movementSequence?.durations?.[frameIndex - 1] || 0) : 0); const batches = Math.max(1, Math.ceil(writes.length / 32)); const requiredFrames = Math.max(0, batches - 1); const sourceTimes = animationSequence?.stateTimes || movementSequence?.stateTimes || []; steps.push({ keyframe: frameIndex, sourceStartFrame: sourceTimes[frameIndex - 1] ?? null, sourceEndFrame: sourceTimes[frameIndex] ?? null, writes, waitBeforeFrames: animating ? targetFrames : 0, targetFrames, batches, requiredFrames, waitFrames: animating ? requiredFrames : Math.max(targetFrames, requiredFrames) });
    }
    if (tileImages.length <= 256) { selected = { keyframeCount: frames.length, frames, tileImages, steps, animationSequence, movementSequence }; break; }
  }
  if (!selected) { const error = new Error(`${spec.sourceKey || spec.id}: visual timelineを256 tiles以内へ削減できません`); error.code = 'GBVN_VISUAL_TIMELINE_TILE_BUDGET'; throw error; }
  const packed = packTiles(selected.tileImages); const key = `${spec.id}:${mode}`; const id = helpers.idFor('tileset', key); const filename = `pce-vn/${mode}/${stableResourceStem(spec.id, helpers, 'visual_timeline')}.png`; const renderedFrames = selected.steps.reduce((sum, step) => sum + (step.waitBeforeFrames || 0) + step.waitFrames, 0); const sourceFrames = animating ? selected.animationSequence.totalFrames : (moving ? spec.durationFrames : 0); const extraFrames = renderedFrames - sourceFrames; const nonAtomicFrames = selected.steps.filter((step) => step.writes.length > 32).length; const omittedAttributes = selected.animationSequence?.omittedAttributes || []; const renderedThrough = (sourceFrame) => selected.steps.filter((step) => Number.isFinite(Number(step.sourceEndFrame)) && Number(step.sourceEndFrame) <= sourceFrame).reduce((sum, step) => sum + (Number(step.waitBeforeFrames) || 0) + (Number(step.waitFrames) || 0), 0); const syncSourceFrames = Number(spec.syncWaitFrames) || 0; const syncRenderedFrames = syncSourceFrames ? renderedThrough(syncSourceFrames) : 0; const transitionSamples = (spec.transitionSampleFrames || []).map((sourceFrame) => { const rendered = renderedThrough(Number(sourceFrame) || 0); return { sourceFrame: Number(sourceFrame) || 0, renderedFrames: rendered, extraFrames: Math.max(0, rendered - (Number(sourceFrame) || 0)) }; });
  return { id, key, mode, filename, png: encodeRgbaPng(packed.image), tiles: selected.tileImages, resource: { _resourceType: 'tileset', id, name: `PCE VN Visual ${mode.toUpperCase()} ${spec.id}`, symbol: `tileset_${helpers.slug(`${spec.id}_${mode}`)}`, width: packed.widthInTiles, height: packed.heightInTiles, imageWidth: packed.image.width, imageHeight: packed.image.height, filename }, steps: selected.steps, audit: { mode, tilesetId: id, tilesetHash: sha256(encodeRgbaPng(packed.image)), fullFrameHashes: selected.frames.map((frame) => sha256(encodeRgbaPng(frame.converted))), sourceFrameHashes: selected.frames.map((frame) => sha256(encodeRgbaPng(frame.source))), keyframes: selected.keyframeCount, generatedTiles: selected.tileImages.length, replacementTiles: selected.steps.reduce((sum, step) => sum + step.writes.length, 0), maxTilesPerFrame: 32, nonAtomicFrames, sourceFrames, renderedFrames, extraFrames: Math.max(0, extraFrames), timingErrorFrames: extraFrames, syncSourceFrames, syncRenderedFrames, syncTimingErrorFrames: syncSourceFrames ? syncRenderedFrames - syncSourceFrames : 0, transitionSamples, sourceAnimationFrames: selected.animationSequence?.sourceAnimationFrames || 0, generatedAnimationFrames: selected.animationSequence?.generatedAnimationFrames || 0, omittedAttributes, fidelity: extraFrames || nonAtomicFrames ? 'approximated' : 'exact' } };
}

function gcd(left, right) { let a = Math.max(1, Math.round(left)); let b = Math.max(1, Math.round(right)); while (b) { const next = a % b; a = b; b = next; } return a; }
function cappedLcm(left, right, cap) { const value = left / gcd(left, right) * right; return value > cap ? 0 : value; }

function reducedAnimation(animation, maxStates) {
  const frameCount = animation.frames.length;
  if (frameCount <= maxStates) return { indices: Array.from({ length: frameCount }, (_, index) => index), delays: [...animation.delays] };
  if (maxStates <= 1) return { indices: [0], delays: [animation.delays.reduce((sum, value) => sum + value, 0)] };
  const indices = [...new Set(Array.from({ length: maxStates }, (_, index) => Math.round(index * (frameCount - 1) / (maxStates - 1))))].sort((a, b) => a - b); const delays = indices.map((sourceIndex, index) => { const end = indices[index + 1] ?? frameCount; return animation.delays.slice(sourceIndex, end).reduce((sum, value) => sum + value, 0); }); return { indices, delays };
}

function frameAtTime(track, time) {
  const local = track.period ? time % track.period : 0; let elapsed = 0;
  for (let index = 0; index < track.delays.length; index += 1) { elapsed += track.delays[index]; if (local < elapsed) return track.indices[index]; }
  return track.indices.at(-1) || 0;
}

function visualPlaybackSchedule(model, state, { maxStates = SPRITE_FRAME_LIMIT, includeBlink = true } = {}) {
  const spriteTracks = []; const blinkTracks = []; const omittedAttributes = []; const spriteTransforms = model.visual.spriteTransforms || new Map(); const includeSprites = model.settings.portraitRenderMode === 'baked'; let sourceFeatures = 0;
  if (includeSprites && !state?.blank) for (let slot = 0; slot < 4; slot += 1) {
    const sprite = state?.sprites?.[slot]; if (!sprite?.visible) continue; const transformed = spriteTransforms.get(sprite.assetId); const animation = transformed?.animations.find((entry) => entry.id === sprite.animationId) || transformed?.animations[0]; if (!animation || animation.frames.length <= 1) continue; sourceFeatures += 1;
    if (!animation.loop) continue;
    const reduced = reducedAnimation(animation, maxStates); const period = reduced.delays.reduce((sum, value) => sum + value, 0); spriteTracks.push({ slot, assetId: sprite.assetId, animationId: animation.id, sourceFrames: animation.frames.length, ...reduced, period });
    if (reduced.indices.length < animation.frames.length) omittedAttributes.push({ attribute: 'loopAnimationFrames', assetId: sprite.assetId, slot, sourceValue: animation.frames.length, generatedValue: reduced.indices.length, reason: 'tile-controller-budget' });
    if (reduced.indices.length <= 1) omittedAttributes.push({ attribute: 'loop', assetId: sprite.assetId, slot, sourceValue: true, generatedValue: false, reason: 'tile-controller-budget' });
  }
  if (!state?.blank) for (let slot = 0; slot < 4; slot += 1) { const text = state?.spriteTexts?.[slot]; const blinkFrames = clampInt(text?.blinkFrames, 0, 65535, 0); if (!text?.visible || !blinkFrames) continue; sourceFeatures += 1; if (includeBlink) blinkTracks.push({ slot, blinkFrames, period: blinkFrames * 2 }); else omittedAttributes.push({ attribute: 'blinkFrames', slot, sourceValue: blinkFrames, generatedValue: 'always-visible', reason: 'tile-controller-budget' }); }
  if (!sourceFeatures) return null;
  const activeTracks = [...spriteTracks.filter((track) => track.indices.length > 1), ...blinkTracks]; if (!activeTracks.length) return { states: [], durations: [], horizon: 0, sourceFeatures, omittedAttributes, supercycleExact: true, timingErrorFrames: 0 };
  const periods = activeTracks.map((track) => track.period); let horizon = periods[0]; let supercycleExact = true; for (const period of periods.slice(1)) { const next = cappedLcm(horizon, period, 2048); if (!next) { supercycleExact = false; horizon = Math.max(...periods); break; } horizon = next; }
  const times = new Set([0, horizon]);
  for (const track of spriteTracks) if (track.indices.length > 1) { let elapsed = 0; while (elapsed < horizon) for (const delay of track.delays) { elapsed += delay; if (elapsed > 0 && elapsed < horizon) times.add(elapsed); if (elapsed >= horizon) break; } }
  for (const track of blinkTracks) for (let elapsed = track.blinkFrames; elapsed < horizon; elapsed += track.blinkFrames) times.add(elapsed);
  const ordered = [...times].sort((a, b) => a - b); if (ordered.length - 1 > SPRITE_FRAME_LIMIT) return { overflow: true, sourceFeatures, omittedAttributes };
  const states = ordered.slice(0, -1).map((time) => { const current = clone(state); for (const track of spriteTracks) if (current.sprites?.[track.slot]) current.sprites[track.slot].frameIndex = frameAtTime(track, time); for (const track of blinkTracks) if (current.spriteTexts?.[track.slot]) current.spriteTexts[track.slot].blinkHidden = Math.floor(time / track.blinkFrames) % 2 === 1; return current; });
  const durations = ordered.slice(0, -1).map((time, index) => ordered[index + 1] - time); return { states, durations, horizon, sourceFeatures, omittedAttributes, supercycleExact, timingErrorFrames: 0, tracks: { sprites: spriteTracks.map(({ slot, assetId, animationId, sourceFrames, indices, delays, period }) => ({ slot, assetId, animationId, sourceFrames, generatedFrames: indices.length, indices, delays, period })), spriteTexts: blinkTracks } };
}

function loopModeArtifact(model, background, loopId, schedule, mode, helpers) {
  const frames = schedule.states.map((state) => quantizeTimelineFrame(model, background, state, mode)); const tileMap = new Map(); const tileImages = []; const steps = [];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const nextIndex = (frameIndex + 1) % frames.length; const writes = [];
    for (let ty = 0; ty < 18; ty += 1) for (let tx = 0; tx < 20; tx += 1) if (tileDiffers(frames[frameIndex].source, frames[nextIndex].source, tx, ty)) { const tile = extractTile(frames[nextIndex].converted, tx, ty); const identity = sha256(tile.rgba); let tileIndex = tileMap.get(identity); if (tileIndex == null) { tileIndex = tileImages.length; tileMap.set(identity, tileIndex); tileImages.push(tile); } writes.push({ x: tx, y: ty, tileIndex }); }
    const batches = Math.max(1, Math.ceil(writes.length / 32)); const requiredFrames = Math.max(0, batches - 1); steps.push({ keyframe: frameIndex, writes, waitBeforeFrames: schedule.durations[frameIndex], targetFrames: schedule.durations[frameIndex], batches, requiredFrames, waitFrames: requiredFrames });
  }
  if (tileImages.length > 256) return null;
  const packed = packTiles(tileImages); const id = helpers.idFor('tileset', `${loopId}:${mode}`); const filename = `pce-vn/${mode}/${stableResourceStem(loopId, helpers, 'visual_loop')}.png`; const png = encodeRgbaPng(packed.image); const extraFrames = steps.reduce((sum, step) => sum + step.requiredFrames, 0); const nonAtomicFrames = steps.filter((step) => step.writes.length > 32).length; const renderedFrames = schedule.horizon + extraFrames; const fidelity = !schedule.supercycleExact || extraFrames || nonAtomicFrames ? 'approximated' : 'exact';
  return { id, key: `${loopId}:${mode}`, mode, filename, png, tiles: tileImages, resource: { _resourceType: 'tileset', id, name: `PCE VN Visual Loop ${mode.toUpperCase()} ${loopId}`, symbol: `tileset_${helpers.slug(`${loopId}_${mode}`)}`, width: packed.widthInTiles, height: packed.heightInTiles, imageWidth: packed.image.width, imageHeight: packed.image.height, filename }, steps, audit: { mode, tilesetId: id, tilesetHash: sha256(png), fullFrameHashes: frames.map((frame) => sha256(encodeRgbaPng(frame.converted))), sourceFrameHashes: frames.map((frame) => sha256(encodeRgbaPng(frame.source))), keyframes: frames.length, generatedTiles: tileImages.length, replacementTiles: steps.reduce((sum, step) => sum + step.writes.length, 0), maxTilesPerFrame: 32, nonAtomicFrames, sourceFrames: schedule.horizon, renderedFrames, extraFrames, timingErrorFrames: renderedFrames - schedule.horizon, supercycleExact: schedule.supercycleExact, fidelity } };
}

function createVisualTileBankAccumulator(helpers) {
  const banksByMode = { gbc: [], dmg: [] };
  const add = (artifact) => {
    for (const mode of ['gbc', 'dmg']) {
      const source = artifact?.modes?.[mode]; if (!source || source._visualBankAdded) continue; source._visualBankAdded = true; const banks = banksByMode[mode];
      const tiles = source.tiles || []; const hashes = tiles.map((tile) => sha256(tile.rgba)); let bank = banks.find((candidate) => candidate.tiles.length + hashes.filter((hash) => !candidate.tileMap.has(hash)).length <= 256);
      if (!bank) { bank = { mode, index: banks.length, tileMap: new Map(), tiles: [], sources: [] }; banks.push(bank); }
      const remap = hashes.map((hash, index) => { let target = bank.tileMap.get(hash); if (target == null) { target = bank.tiles.length; bank.tileMap.set(hash, target); bank.tiles.push(tiles[index]); } return target; });
      for (const step of source.steps || []) for (const write of step.writes || []) write.tileIndex = remap[write.tileIndex] ?? 0;
      bank.sources.push(source); source.tiles = [];
    }
  };
  const finalize = () => {
    const output = [];
    for (const mode of ['gbc', 'dmg']) for (const bank of banksByMode[mode]) {
      const packed = packTiles(bank.tiles); const identity = sha256(stableJson([...bank.tileMap.keys()])); const id = helpers.idFor('tileset', `visual-bank:${mode}:${bank.index}:${identity}`); const stem = `visual_bank_${String(bank.index).padStart(3, '0')}_${identity.slice(0, 12)}`; const filename = `pce-vn/${mode}/${stem}.png`; const png = encodeRgbaPng(packed.image); const resource = { _resourceType: 'tileset', id, name: `PCE VN Visual Bank ${mode.toUpperCase()} ${bank.index + 1}`, symbol: `tileset_${stem}_${mode}`, width: packed.widthInTiles, height: packed.heightInTiles, imageWidth: packed.image.width, imageHeight: packed.image.height, filename };
      for (const source of bank.sources) { delete source._visualBankAdded; Object.assign(source, { id, filename, png, resource, bankIndex: bank.index }); Object.assign(source.audit, { tilesetId: id, tilesetHash: sha256(png), bankIndex: bank.index, bankTiles: bank.tiles.length }); }
      output.push({ mode, index: bank.index, id, filename, tiles: bank.tiles.length, artifacts: bank.sources.length, sha256: sha256(png) });
      bank.tiles = []; bank.tileMap.clear();
    }
    return output;
  };
  return { add, finalize };
}

function packVisualTileBanks(artifacts, helpers) {
  const accumulator = createVisualTileBankAccumulator(helpers); for (const artifact of [...artifacts].sort((left, right) => left.id.localeCompare(right.id))) accumulator.add(artifact); return accumulator.finalize();
}

function buildVisualTimelineArtifacts(model, backgrounds, helpers) {
  const bySegment = new Map(model.graph.segments.map((segment) => [segment.key, segment])); const byBackground = new Map(backgrounds.output.map((entry) => [entry.key, entry])); const timelines = []; const omissions = []; const approximations = []; const loopsByKey = new Map(); const entryLoops = new Map(); const tileBanks = createVisualTileBankAccumulator(helpers);
  if (model.settings.portraitRenderMode === 'actor') for (const sprite of backgrounds.visual?.sprites || []) {
    const timingApproximated = (sprite.timing?.animations || []).some((animation) => (animation.frameErrors || []).some((error) => error !== 0)); const colorApproximated = ['gbc', 'dmg'].some((mode) => !sprite[mode]?.color?.exact);
    if (timingApproximated || colorApproximated) approximations.push({ id: `sprite:${sprite.assetId}`, kind: 'actor-sprite-quantization', assetId: sprite.assetId, timing: sprite.timing, colors: { gbc: sprite.gbc?.color, dmg: sprite.dmg?.color }, attributes: { frameDelays: timingApproximated ? 'approximated' : 'exact', color: colorApproximated ? 'approximated' : 'exact' }, fidelity: 'approximated' });
  }
  const ensureLoop = (segment, state) => {
    const background = byBackground.get(segment.backgroundVariantKey); if (!background) return null; const stateId = visualStateHash(state); const cacheKey = `${background.key}\0${stateId}\0${model.settings.portraitRenderMode}`; const existing = loopsByKey.get(cacheKey); if (existing) { if (!existing.usedBySegments.includes(segment.key)) existing.usedBySegments.push(segment.key); return existing; }
    const configs = [{ maxStates: 64, includeBlink: true }, { maxStates: 4, includeBlink: true }, { maxStates: 2, includeBlink: true }, { maxStates: 1, includeBlink: true }, { maxStates: 1, includeBlink: false }]; let selected = null;
    for (const config of configs) { const schedule = visualPlaybackSchedule(model, state, config); if (!schedule) return null; if (schedule.overflow) continue; const loopId = `${segment.key}:loop:${stateId.slice(0, 12)}`; const modes = {}; if (schedule.states.length) { modes.gbc = loopModeArtifact(model, background, loopId, schedule, 'gbc', helpers); modes.dmg = loopModeArtifact(model, background, loopId, schedule, 'dmg', helpers); if (!modes.gbc || !modes.dmg) continue; } selected = { loopId, schedule, modes }; break; }
    if (!selected) { const error = new Error(`${segment.key}: visual loopをtile/controller予算内へ削減できません`); error.code = 'GBVN_VISUAL_LOOP_TILE_BUDGET'; throw error; }
    const modeAudits = Object.fromEntries(Object.entries(selected.modes).map(([mode, artifact]) => [mode, artifact.audit])); const noVisualDelta = Object.keys(modeAudits).length > 0 && Object.values(modeAudits).every((audit) => audit.replacementTiles === 0); const runtimeModes = noVisualDelta ? {} : selected.modes; const omittedAttributes = selected.schedule.omittedAttributes || []; const approximated = Object.values(modeAudits).some((audit) => audit.fidelity === 'approximated'); const fidelity = omittedAttributes.length ? 'omitted-attribute' : (approximated ? 'approximated' : 'exact'); const loop = { id: selected.loopId, kind: 'visual-loop', stateId, backgroundVariantKey: segment.backgroundVariantKey, usedBySegments: [segment.key], modes: runtimeModes, schedule: selected.schedule, audit: { id: selected.loopId, kind: 'visual-loop', renderMode: model.settings.portraitRenderMode, visualStateId: stateId, backgroundVariantKey: segment.backgroundVariantKey, tracks: selected.schedule.tracks || { sprites: [], spriteTexts: [] }, modes: modeAudits, noVisualDelta, omittedAttributes, fidelity } }; loopsByKey.set(cacheKey, loop); tileBanks.add(loop); if (omittedAttributes.length) omissions.push(loop.audit); if (fidelity === 'approximated') approximations.push(loop.audit); return loop;
  };
  for (const spec of model.visual.timelineSpecs || []) {
    const segment = bySegment.get(spec.segmentKey); const background = segment && byBackground.get(segment.backgroundVariantKey); if (!segment || !background) continue;
    if (model.settings.portraitRenderMode === 'actor' && spec.kind === 'spritemove' && spec.plan?.move) { const movement = actorMoveTiming(spec.plan); Object.assign(spec.plan, { movement, fidelity: movement.timingErrorFrames ? 'approximated' : spec.plan.fidelity }); }
    const prebakedSpriteText = spec.kind === 'spritetext' && segment.prebakedSpriteTextSourceKeys?.includes(spec.sourceKey); if (prebakedSpriteText) spec.plan.prebakedBackground = true;
    const usesTiles = !prebakedSpriteText && (model.settings.portraitRenderMode === 'baked' || ['spritetext', 'blank'].includes(spec.kind)); const modes = {};
    if (usesTiles) for (const mode of ['gbc', 'dmg']) modes[mode] = timelineModeArtifact(model, background, spec, mode, helpers);
    const loopState = spec.renderAfterState || spec.afterState; const loop = ensureLoop(segment, loopState); const modeAudits = Object.fromEntries(Object.entries(modes).map(([mode, artifact]) => [mode, artifact.audit])); const artifactOmissions = []; const seenOmissions = new Set();
    for (const modeAudit of Object.values(modeAudits)) for (const omission of modeAudit.omittedAttributes || []) { const identity = stableJson(omission); if (!seenOmissions.has(identity)) { seenOmissions.add(identity); artifactOmissions.push(omission); } }
    const intrinsicApproximation = spec.plan?.fidelity === 'approximated'; const modeApproximation = Object.values(modeAudits).some((audit) => audit.fidelity === 'approximated'); const loopApproximation = loop?.audit?.fidelity === 'approximated'; const fidelity = artifactOmissions.length || loop?.audit?.fidelity === 'omitted-attribute' ? 'omitted-attribute' : (intrinsicApproximation || modeApproximation || loopApproximation ? 'approximated' : 'exact');
    const audit = { id: spec.id, sourceKey: spec.sourceKey, coalescedSourceKeys: spec.coalescedSourceKeys || [], segmentKey: spec.segmentKey, commandIndex: spec.commandIndex, kind: spec.kind, renderMode: spec.renderMode, visualStateBefore: visualStateHash(spec.beforeState), visualStateAfter: visualStateHash(spec.afterState), renderedVisualStateAfter: visualStateHash(loopState), durationFrames: spec.durationFrames, syncWaitFrames: spec.syncWaitFrames || 0, async: spec.async, prebakedBackground: prebakedSpriteText, movement: spec.plan?.movement || null, movements: spec.moves || [], effect: spec.plan?.effect || null, spriteText: spec.plan?.spriteText || null, modes: modeAudits, loopId: loop?.id || '', loopFidelity: loop?.audit?.fidelity || 'exact', omittedAttributes: artifactOmissions, fidelity };
    const timeline = { ...spec, modes, loop, audit }; if (artifactOmissions.length) omissions.push(audit); if (audit.fidelity === 'approximated') approximations.push(audit); timelines.push(timeline); tileBanks.add(timeline);
  }
  for (const segment of model.graph.segments) { const loop = ensureLoop(segment, segment.entryVisualState); if (loop?.modes && Object.keys(loop.modes).length) entryLoops.set(segment.key, loop); }
  const approximatedSources = new Set(approximations.map((entry) => entry.sourceKey).filter(Boolean));
  for (const segment of model.graph.segments) for (const plan of segment.visualPlans || []) if (plan.fidelity === 'approximated' && plan.sourceKey && !approximatedSources.has(plan.sourceKey)) { approximatedSources.add(plan.sourceKey); approximations.push({ id: `${segment.key}:${plan.commandIndex}:mapping`, kind: 'visual-command-mapping', sourceKey: plan.sourceKey, segmentKey: segment.key, commandIndex: plan.commandIndex, commandType: plan.type, movement: plan.movement || null, effect: plan.effect || null, spriteText: plan.spriteText || null, fidelity: 'approximated' }); }
  const loops = [...loopsByKey.values()]; loops.forEach((loop) => { loop.usedBySegments.sort(); loop.audit.usedBySegments = [...loop.usedBySegments]; }); const packedTileBanks = tileBanks.finalize(); const audit = { format: 'pce-vn-gb-studio-visual-audit', version: 1, renderMode: model.settings.portraitRenderMode, status: 'pass', sprites: backgrounds.visual?.sprites || [], actorPairs: backgrounds.visual?.actorPairs || [], timelines: timelines.map((entry) => entry.audit), loops: loops.map((entry) => entry.audit), tileBanks: packedTileBanks, omissions, approximations };
  audit.hash = sha256(stableJson(audit)); model.visual.timelineArtifacts = new Map(timelines.map((entry) => [entry.id, entry])); model.visual.loopArtifacts = new Map(loops.map((entry) => [entry.id, entry])); model.visual.tileBanks = packedTileBanks; model.visual.entryLoops = entryLoops; model.visual.audit = audit; backgrounds.visual = { ...(backgrounds.visual || {}), timelines: audit.timelines, loops: audit.loops, tileBanks: packedTileBanks, omissions, approximations, auditHash: audit.hash };
  return { timelines, loops, audit };
}

module.exports = {
  PORTRAIT_RENDER_MODES, SPRITE_CANVAS_HEIGHT, SPRITE_CANVAS_WIDTH, SPRITE_FRAME_LIMIT,
  actorMoveTiming, actorPairAudits, actorPosition, assertActorPairBudgets, bakedSpritePreviewFrames, buildVisualTimelineArtifacts, composeVisualState, initialVisualState, makeSpriteResource,
  normalizePortraitRenderMode, normalizeSpriteSetting, serializableVisualState, sha256,
  specializeVisualStates, stableJson, transformSpriteAsset, visualStateHash,
};
