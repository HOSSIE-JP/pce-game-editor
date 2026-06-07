export const IMAGE_EXTS = ['.png', '.bmp'];
export const AUDIO_EXTS = ['.wav', '.mp3', '.ogg'];
export const MIDI_EXTS = ['.mid', '.midi'];

export function inferTypeFromExtension(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.pal') return 'PALETTE';
  if (AUDIO_EXTS.includes(e)) return 'WAV';
  if (MIDI_EXTS.includes(e)) return 'XGM2';
  if (e === '.vgm' || e === '.xgm') return 'XGM';
  if (e === '.tsx') return 'TILESET';
  if (e === '.tmx') return 'MAP';
  if (IMAGE_EXTS.includes(e)) return 'IMAGE';
  return 'BIN';
}

export function allowedTypesForExtension(ext, allTypes = []) {
  const e = String(ext || '').toLowerCase();
  if (IMAGE_EXTS.includes(e)) return ['PALETTE', 'IMAGE', 'BITMAP', 'SPRITE', 'MAP', 'TILEMAP', 'TILESET'];
  if (AUDIO_EXTS.includes(e)) return ['WAV'];
  if (MIDI_EXTS.includes(e)) return ['XGM2', 'XGM'];
  if (e === '.xgm' || e === '.vgm') return ['XGM', 'XGM2'];
  if (e === '.tsx') return ['TILESET'];
  if (e === '.tmx') return ['MAP', 'TILEMAP'];
  if (e === '.pal') return ['PALETTE'];
  return allTypes;
}

export function defaultSubDirForType(type) {
  switch (String(type || '').toUpperCase()) {
    case 'PALETTE': return 'pal';
    case 'SPRITE': return 'sprite';
    case 'IMAGE':
    case 'BITMAP':
    case 'TILESET': return 'tilesets';
    case 'TILEMAP':
    case 'MAP': return 'maps';
    case 'XGM':
    case 'XGM2': return 'music';
    case 'WAV': return 'sfx';
    default: return 'assets';
  }
}

export function normalizeSymbolName(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'asset_name';
}
