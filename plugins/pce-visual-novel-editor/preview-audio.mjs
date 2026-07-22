export function pcePreviewBgmConflict(startKind, assetType) {
  if (startKind === 'cdda') return { kind: 'psg', target: 'bgm' };
  if (startKind === 'psg' && assetType === 'psg-song') {
    return { kind: 'cdda', target: 'all' };
  }
  return null;
}
