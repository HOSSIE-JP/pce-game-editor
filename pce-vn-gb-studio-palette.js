'use strict';

const { DMG_COLORS } = require('./pce-vn-gb-studio-image');

const SYSTEM_UI_PALETTE_HEX = Object.freeze(['E0F8CF', '86C06C', '306850', '000000']);
const SYSTEM_UI_PALETTE = Object.freeze(SYSTEM_UI_PALETTE_HEX.map((hex) => Object.freeze([
  parseInt(hex.slice(0, 2), 16),
  parseInt(hex.slice(2, 4), 16),
  parseInt(hex.slice(4, 6), 16),
])));

function colorDistance(left, right) {
  const red = left[0] - right[0];
  const green = left[1] - right[1];
  const blue = left[2] - right[2];
  return red * red * 2 + green * green * 4 + blue * blue;
}

function nearestPaletteIndex(color, palette) {
  let selected = 0;
  let error = Infinity;
  palette.forEach((candidate, index) => {
    const next = colorDistance(color, candidate);
    if (next < error) { error = next; selected = index; }
  });
  return selected;
}

function normalizeFourColorPalette(palette, fallback = SYSTEM_UI_PALETTE) {
  const colors = (Array.isArray(palette) ? palette : []).slice(0, 4).map((color) => [
    Math.max(0, Math.min(255, Math.round(Number(color?.[0]) || 0))),
    Math.max(0, Math.min(255, Math.round(Number(color?.[1]) || 0))),
    Math.max(0, Math.min(255, Math.round(Number(color?.[2]) || 0))),
  ]);
  const fallbackColors = Array.isArray(fallback) && fallback.length ? fallback : SYSTEM_UI_PALETTE;
  while (colors.length < 4) colors.push([...(colors.at(-1) || fallbackColors[Math.min(colors.length, fallbackColors.length - 1)] || [0, 0, 0])]);
  return colors;
}

function paletteToHex(palette) {
  return normalizeFourColorPalette(palette).map((color) => color.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase());
}

function carrierImage(width, height, indices) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) rgba.set([...DMG_COLORS[indices[index] & 3], 255], index * 4);
  return { width, height, rgba };
}

// GB Studio stores background palette attributes as an RLE-compressed byte list.
// A value is written as two hex digits; a run of one ends with ! and longer runs
// use <hex count>+. This mirrors the 4.3.x project serializer.
function compress8BitNumberArray(values) {
  const input = Array.from(values || [], (value) => Math.max(0, Math.min(255, Math.trunc(Number(value) || 0))));
  if (!input.length) return '';
  let output = '';
  let previous = -1;
  let run = 0;
  const flush = () => { if (!run) return; output += run === 1 ? '!' : `${run.toString(16)}+`; run = 0; };
  for (const value of input) {
    if (value !== previous) { flush(); previous = value; output += value.toString(16).padStart(2, '0'); }
    run += 1;
  }
  flush();
  return output;
}

module.exports = {
  SYSTEM_UI_PALETTE,
  SYSTEM_UI_PALETTE_HEX,
  carrierImage,
  colorDistance,
  compress8BitNumberArray,
  nearestPaletteIndex,
  normalizeFourColorPalette,
  paletteToHex,
};
