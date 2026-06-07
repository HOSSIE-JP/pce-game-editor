'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const pluginDir = path.join(__dirname, '..', 'plugins', 'md-bgm-composer');
const composer = require(path.join(pluginDir, 'index.js'));
const core = require(path.join(pluginDir, 'music-core.js'));

function vlq(value) {
  let buffer = value & 0x7F;
  let n = value >>> 7;
  while (n > 0) {
    buffer <<= 8;
    buffer |= ((n & 0x7F) | 0x80);
    n >>>= 7;
  }
  const out = [];
  for (;;) {
    out.push(buffer & 0xFF);
    if (buffer & 0x80) buffer >>>= 8;
    else break;
  }
  return Buffer.from(out.reverse());
}

function chunk(id, payload) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, 'ascii');
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function meta(delta, type, payload) {
  return Buffer.concat([vlq(delta), Buffer.from([0xFF, type]), vlq(payload.length), payload]);
}

function midi(delta, bytes) {
  return Buffer.concat([vlq(delta), Buffer.from(bytes)]);
}

function withGd3(vgm, metadata = {}) {
  const strings = [
    metadata.title || '',
    '',
    '',
    '',
    'Sega Mega Drive',
    '',
    metadata.artist || '',
    '',
    '',
    'MD Game Editor',
    '',
  ].join('\0') + '\0';
  const payload = Buffer.from(strings, 'utf16le');
  const gd3 = Buffer.alloc(12);
  gd3.write('Gd3 ', 0, 4, 'ascii');
  gd3.writeUInt32LE(0x00000100, 4);
  gd3.writeUInt32LE(payload.length, 8);
  const output = Buffer.concat([Buffer.from(vgm), gd3, payload]);
  output.writeUInt32LE(output.length - 4, 0x04);
  output.writeUInt32LE(vgm.length - 0x14, 0x14);
  return output;
}

function makeMidiFixture() {
  const header = Buffer.alloc(6);
  header.writeUInt16BE(1, 0);
  header.writeUInt16BE(2, 2);
  header.writeUInt16BE(96, 4);

  const tempoTrack = Buffer.concat([
    meta(0, 0x03, Buffer.from('Tempo')),
    meta(0, 0x51, Buffer.from([0x07, 0xA1, 0x20])),
    meta(0, 0x2F, Buffer.alloc(0)),
  ]);

  const noteTrack = Buffer.concat([
    meta(0, 0x03, Buffer.from('Lead')),
    meta(0, 0x02, Buffer.from('Composer Name')),
    midi(0, [0xC0, 0x10]),
    midi(0, [0xB0, 0x07, 0x64]),
    midi(0, [0x90, 60, 100]),
    midi(24, [0xE0, 0x00, 0x50]),
    midi(72, [0x80, 60, 0]),
    meta(0, 0x2F, Buffer.alloc(0)),
  ]);

  return Buffer.concat([
    chunk('MThd', header),
    chunk('MTrk', tempoTrack),
    chunk('MTrk', noteTrack),
  ]);
}

test('md-bgm-composer declares renderer and main hook capabilities', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf-8'));
  const rendererSource = fs.readFileSync(path.join(pluginDir, 'renderer.js'), 'utf-8');

  assert.deepEqual(manifest.types, ['editor', 'converter', 'asset']);
  assert.deepEqual(manifest.dependencies, ['midi-converter']);
  assert.equal(manifest.tab.page, 'md-bgm-composer');
  assert.deepEqual(manifest.mainApi.hooks, ['importMidi', 'exportMusic', 'validateSong', 'previewMusic', 'analyzeVgm']);
  assert.ok(manifest.renderer.capabilities.includes('page'));
  assert.ok(manifest.renderer.capabilities.includes('md-bgm-composer'));
  assert.ok(manifest.renderer.capabilities.includes('music-import-handler'));
  assert.match(rendererSource, /registerCapability\(['"]md-bgm-composer['"]/);
  assert.match(rendererSource, /registerCapability\(['"]music-import-handler['"]/);
  assert.match(rendererSource, /refreshAssets/);
  assert.match(rendererSource, /selectAsset/);
  assert.match(rendererSource, /requestSelectAsset/);
  assert.match(rendererSource, /setupPageAutoRefresh/);
  assert.match(rendererSource, /MutationObserver/);
  assert.match(rendererSource, /preserveDirty:\s*true/);
  assert.match(rendererSource, /confirmUnsavedAssetSwitch/);
  assert.match(rendererSource, /confirmCanReplaceCurrentSong/);
  assert.match(rendererSource, /未保存の変更/);
  assert.match(rendererSource, /保存して開く/);
  assert.match(rendererSource, /破棄して開く/);
  assert.match(rendererSource, /decision === ['"]save['"]/);
  assert.match(rendererSource, /saveCurrentSong\(\{ plugin, api, state, els \}\)/);
  assert.match(rendererSource, /action === ['"]create-empty['"][\s\S]*confirmCanReplaceCurrentSong/);
  assert.match(rendererSource, /action === ['"]import-music-to-res['"][\s\S]*confirmCanReplaceCurrentSong/);
  assert.match(rendererSource, /async function importMidiToRes[\s\S]*confirmCanReplaceCurrentSong/);
  assert.match(rendererSource, /importMidiToRes/);
  assert.match(rendererSource, /importMusicToRes/);
  assert.match(rendererSource, /importMidiViaConverterToRes/);
  assert.match(rendererSource, /convertMidiMusic/);
  assert.match(rendererSource, /midi-converter/);
  assert.match(rendererSource, /writeAssetFile/);
  assert.match(rendererSource, /deleteCurrentAsset/);
  assert.match(rendererSource, /deleteResEntry/);
  assert.match(rendererSource, /clearEditorSelection/);
  assert.match(rendererSource, /createEmptySong/);
  assert.match(rendererSource, /editExternalAsset/);
  assert.match(rendererSource, /saveCurrentSong/);
  assert.match(rendererSource, /data-role="res-filter"/);
  assert.match(rendererSource, /data-role="keyword"/);
  assert.match(rendererSource, /expandedFiles/);
  assert.match(rendererSource, /data-file-toggle/);
  assert.match(rendererSource, /data-action="create-empty"/);
  assert.match(rendererSource, /data-action="import-music-to-res"/);
  assert.match(rendererSource, /data-action="delete-current"/);
  assert.match(rendererSource, /md-bgm-list-actions/);
  assert.match(rendererSource, /md-bgm-filter[\s\S]*md-bgm-list-actions[\s\S]*data-role="asset-tree"/);
  assert.match(rendererSource, /md-bgm-asset-actions/);
  assert.match(rendererSource, /md-bgm-asset-icon/);
  assert.match(rendererSource, /data-resize-column="left"/);
  assert.match(rendererSource, /data-resize-column="right"/);
  assert.match(rendererSource, /startColumnResize/);
  assert.match(rendererSource, /#icon-file-plus/);
  assert.match(rendererSource, /#icon-save/);
  assert.match(rendererSource, /#icon-trash/);
  assert.match(rendererSource, /プレビュー専用/);
  assert.match(rendererSource, /api\.createModal/);
  assert.match(rendererSource, /Tracker/);
  assert.match(rendererSource, /Piano Roll/);
  assert.match(rendererSource, /data-role="piano-layers"/);
  assert.match(rendererSource, /data-role="piano-channel-tabs"/);
  assert.match(rendererSource, /showPianoLayers:\s*true/);
  assert.match(rendererSource, /channelVisible/);
  assert.match(rendererSource, /getPianoGhostChannels/);
  assert.match(rendererSource, /TRACKER_KEYBOARD_MAP/);
  assert.match(rendererSource, /handleTrackerKeydown/);
  assert.match(rendererSource, /dataset\.action = ['"]add-pattern['"]/);
  assert.match(rendererSource, /dataset\.action = ['"]delete-pattern['"]/);
  assert.match(rendererSource, /add\.textContent = ['"]＋['"]/);
  assert.match(rendererSource, /remove\.textContent = ['"]－['"]/);
  assert.match(rendererSource, /data-inst-select/);
  assert.match(rendererSource, /playbackRow/);
  assert.match(rendererSource, /scrollPlaybackTarget/);
  assert.match(rendererSource, /selectedOrderIndex/);
  assert.match(rendererSource, /selectOrderIndex/);
  assert.match(rendererSource, /buildPlaybackSequence/);
  assert.match(rendererSource, /\(song\.order \|\| \[\]\)\.flatMap/);
  assert.match(rendererSource, /applyPlaybackStep/);
  assert.match(rendererSource, /previewMusic/);
  assert.match(rendererSource, /songToPreviewVgm/);
  assert.match(rendererSource, /cloneSongForPreview/);
  assert.match(rendererSource, /vgm-preview-player/);
  assert.match(rendererSource, /loadHighAccuracyEngine|getEngineStatus|previewEngineStatus/);
  assert.match(rendererSource, /playPreviewFallback/);
  assert.match(rendererSource, /changedPattern/);
  assert.match(rendererSource, /renderPatterns\(state, els\);\s*renderEditorMode\(state, els\);/);
  assert.doesNotMatch(rendererSource, /scrollIntoView/);
  assert.doesNotMatch(rendererSource, /data-action="refresh"/);
  assert.doesNotMatch(rendererSource, /<span>保存<\/span>/);
  assert.doesNotMatch(rendererSource, /<span>削除<\/span>/);
  assert.doesNotMatch(rendererSource, /VGM から近似復元しました/);
  assert.doesNotMatch(rendererSource, />Import MIDI</);
  assert.doesNotMatch(rendererSource, />Export</);
  assert.doesNotMatch(rendererSource, /import-midi-to-res/);
  assert.doesNotMatch(rendererSource, /window\.prompt|window\.alert|window\.confirm/);
});

test('md-bgm-composer shell aligns with sprite editor panes and uses collapsible resource tree', () => {
  const rendererSource = fs.readFileSync(path.join(pluginDir, 'renderer.js'), 'utf-8');
  const styleSource = fs.readFileSync(path.join(pluginDir, 'style.css'), 'utf-8');

  assert.match(rendererSource, /state\.expandedFiles\.has/);
  assert.match(rendererSource, /state\.expandedFiles\.delete/);
  assert.match(rendererSource, /state\.expandedFiles\.add/);
  assert.match(styleSource, /\.md-bgm-composer-shell\s*\{[^}]*margin:\s*-20px -24px;/s);
  assert.match(styleSource, /\.md-bgm-composer-shell\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styleSource, /\.md-bgm-layout\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styleSource, /\.md-bgm-layout\s*\{[^}]*grid-template-columns:\s*var\(--md-bgm-left\) 6px minmax\(420px,\s*1fr\) 6px var\(--md-bgm-right\);/s);
  assert.match(styleSource, /\.md-bgm-column-resizer\s*\{[^}]*cursor:\s*col-resize;/s);
  assert.match(styleSource, /\.md-bgm-main\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(styleSource, /\.md-bgm-sidebar\.right\s*\{[^}]*padding:\s*12px;/s);
  assert.match(styleSource, /\.md-bgm-res-title\s*\{[^}]*grid-template-columns:\s*16px minmax\(0,\s*1fr\) auto;/s);
  assert.match(styleSource, /\.md-bgm-list-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 34px;/s);
  assert.match(styleSource, /\.md-bgm-list-actions\s*\{[^}]*border-bottom:\s*1px solid var\(--border\);/s);
  assert.match(styleSource, /\.md-bgm-asset-tree\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(styleSource, /\.md-bgm-asset\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s);
  assert.match(styleSource, /\.md-bgm-asset-icon\s*\{/);
});

test('md-bgm-composer editor modes expose layer, keyboard, sticky scroll, and pattern controls', () => {
  const rendererSource = fs.readFileSync(path.join(pluginDir, 'renderer.js'), 'utf-8');
  const styleSource = fs.readFileSync(path.join(pluginDir, 'style.css'), 'utf-8');

  assert.match(rendererSource, /z:\s*0,\s*s:\s*1,\s*x:\s*2/);
  assert.match(rendererSource, /q:\s*12,\s*2:\s*13,\s*w:\s*14/);
  assert.match(rendererSource, /ArrowUp|ArrowDown|ArrowLeft|ArrowRight/);
  assert.match(rendererSource, /Backspace|Delete/);
  assert.match(rendererSource, /keyboardOctave/);
  assert.match(rendererSource, /addPattern/);
  assert.match(rendererSource, /deleteSelectedPattern/);
  assert.match(rendererSource, /state\.song\.order\.length <= 1/);
  assert.match(rendererSource, /getInstrumentForChannel/);
  assert.match(rendererSource, /instrument-type-mismatch/);
  assert.match(rendererSource, /data-piano-cell-row/);
  assert.match(rendererSource, /pianoTool:\s*['"]draw['"]/);
  assert.match(rendererSource, /data-role="piano-tools"/);
  assert.match(rendererSource, /data-role="piano-selection-rect"/);
  assert.match(rendererSource, /data-action="set-piano-tool"/);
  assert.match(rendererSource, /setPianoTool/);
  assert.match(rendererSource, /renderPianoTools/);
  assert.match(rendererSource, /pianoSelection/);
  assert.match(rendererSource, /pianoDrag/);
  assert.match(rendererSource, /handlePianoContextMenu/);
  assert.match(rendererSource, /handlePianoPointerDown/);
  assert.match(rendererSource, /handlePianoPointerEnter/);
  assert.match(rendererSource, /handlePianoPointerMove/);
  assert.match(rendererSource, /handlePianoPointerUp/);
  assert.match(rendererSource, /handlePianoKeydown/);
  assert.match(rendererSource, /updatePianoDragToPoint/);
  assert.match(rendererSource, /deletePianoSelection/);
  assert.match(rendererSource, /movePianoSelection/);
  assert.match(rendererSource, /getPianoSelectionChannels/);
  assert.match(rendererSource, /document\.elementFromPoint/);
  assert.match(rendererSource, /togglePianoNoteAt/);
  assert.match(rendererSource, /deletePianoNoteAt/);
  assert.match(rendererSource, /setPianoSelection/);
  assert.match(rendererSource, /isPianoCellSelected/);
  assert.match(rendererSource, /updatePianoSelectionRect/);
  assert.match(rendererSource, /getPianoCellElement/);
  assert.match(rendererSource, /state\.pianoDrag = \{ tool: ['"]select['"]/);
  assert.match(rendererSource, /state\.pianoTool === ['"]erase['"]/);
  assert.match(rendererSource, /state\.pianoTool === ['"]draw['"]/);
  assert.match(rendererSource, /addEventListener\(['"]contextmenu['"]/);
  assert.match(rendererSource, /addEventListener\(['"]pointerdown['"]/);
  assert.match(rendererSource, /addEventListener\(['"]pointerenter['"]/);
  assert.match(rendererSource, /onpointermove/);
  assert.match(rendererSource, /onpointerup/);
  assert.match(rendererSource, /onkeydown/);
  assert.match(rendererSource, /Backspace|Delete/);
  assert.match(rendererSource, /select-piano-channel/);
  assert.match(rendererSource, /toggle-channel-visibility/);
  assert.match(rendererSource, /◉|○/);
  assert.match(rendererSource, /♪|×/);
  assert.match(rendererSource, /row-group-boundary/);
  assert.match(rendererSource, /renderPianoChannelTabs/);
  assert.match(rendererSource, /pianoColumnClass/);
  assert.match(rendererSource, /octave-boundary/);
  assert.match(rendererSource, /container\.contains\(document\.activeElement\)/);
  assert.match(rendererSource, /channelMute/);
  assert.match(rendererSource, /data-action="toggle-channel-mute"|dataset\.action = ['"]toggle-channel-mute['"]/);
  assert.match(rendererSource, /renderTrackerCellParts/);
  assert.match(rendererSource, /md-bgm-cell-note/);
  assert.match(rendererSource, /playImmediateCell/);
  assert.match(rendererSource, /setSongCellFromMidi\(state, row, channel, midiNote\)/);
  assert.match(rendererSource, /isChannelMuted\(state, channelId\)/);
  assert.match(rendererSource, /pianoHover/);
  assert.match(rendererSource, /setPianoHover/);
  assert.match(rendererSource, /clearPianoHover/);
  assert.match(rendererSource, /renderPianoHover/);
  assert.match(rendererSource, /onpointerleave/);
  assert.match(rendererSource, /is-hover-col/);
  assert.match(rendererSource, /is-hover-row/);
  assert.match(rendererSource, /is-hover-cell/);
  assert.match(rendererSource, /data-piano-note-row/);
  assert.match(rendererSource, /data-piano-key-note/);
  assert.match(rendererSource, /data-action="test-instrument"/);
  assert.match(rendererSource, /renderFmInstrumentFields/);
  assert.match(rendererSource, /data-op-field/);
  assert.match(rendererSource, /renderPatternPresetEditor/);
  assert.match(rendererSource, /metadata\.patternPresets/);
  assert.match(rendererSource, /pattern-preset-truncated/);

  assert.match(styleSource, /\.md-bgm-piano-scroll\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(styleSource, /\.md-bgm-piano-scroll\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(styleSource, /\.md-bgm-piano-channel-tabs\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-tools\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-tool\.active\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-selection-rect\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-channel-tab\.active\s*\{/);
  assert.match(styleSource, /\.md-bgm-channel-visible\s*\{/);
  assert.match(styleSource, /\.md-bgm-tool-group\s*\{/);
  assert.match(styleSource, /\.md-bgm-tracker tr\.row-group-boundary th/s);
  assert.match(styleSource, /\.md-bgm-piano-row button\.bar-boundary\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-row button\.is-selected\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-row button\.active\.is-selected\s*\{/);
  assert.match(styleSource, /cursor:\s*crosshair;/);
  assert.match(styleSource, /touch-action:\s*none;/);
  assert.match(styleSource, /\.md-bgm-piano-row\.octave-boundary button/s);
  assert.match(styleSource, /\.md-bgm-piano-row\.header\s*\{[^}]*position:\s*sticky;[^}]*background:\s*#18202a;/s);
  assert.match(styleSource, /\.md-bgm-piano-key\.white\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-key\.black\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-row button\.is-hover-col\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-row button\.is-hover-row\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-row button\.is-hover-cell\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-key\.is-hover-row\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-row\.header button\.is-hover-col::before\s*\{/);
  assert.match(styleSource, /\.md-bgm-piano-ghost\s*\{/);
  assert.match(styleSource, /\.md-bgm-pattern-strip\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(styleSource, /\.md-bgm-editor-pane\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s);
  assert.match(styleSource, /\.md-bgm-tracker-wrap\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(styleSource, /\.md-bgm-tracker-wrap\s*\{[^}]*max-height:\s*100%;/s);
  assert.match(styleSource, /\.md-bgm-tracker-wrap\[hidden\],\s*\.md-bgm-piano-wrap\[hidden\]\s*\{[^}]*display:\s*none !important;/s);
  assert.match(styleSource, /\.md-bgm-tracker thead th\s*\{[^}]*position:\s*sticky;/s);
  assert.match(styleSource, /\.md-bgm-tracker th:first-child\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0;/s);
  assert.match(styleSource, /\.md-bgm-cell-note\s*\{[^}]*color:\s*#16c8d8;/s);
  assert.match(styleSource, /\.md-bgm-cell-inst\s*\{[^}]*color:\s*#7f91ff;/s);
  assert.match(styleSource, /\.md-bgm-cell-effect\s*\{[^}]*color:\s*#ff9b31;/s);
  assert.match(styleSource, /\.md-bgm-channel-mute\s*\{/);
  assert.match(styleSource, /\.md-bgm-operator-table\s*\{/);
  assert.match(styleSource, /\.md-bgm-preset-item\s*\{/);
});

test('MIDI parser reads format 1 tempo, program, CC, pitch bend, and notes', () => {
  const parsed = core.parseMidi(makeMidiFixture());

  assert.equal(parsed.format, 1);
  assert.equal(parsed.ticksPerQuarter, 96);
  assert.equal(parsed.tracks.length, 2);
  assert.ok(parsed.tracks[0].events.some((event) => event.type === 'tempo'));
  assert.ok(parsed.tracks[1].events.some((event) => event.type === 'copyright'));
  assert.ok(parsed.tracks[1].events.some((event) => event.type === 'programChange' && event.program === 0x10));
  assert.ok(parsed.tracks[1].events.some((event) => event.type === 'controlChange' && event.controller === 7));
  assert.ok(parsed.tracks[1].events.some((event) => event.type === 'pitchBend'));
  assert.ok(parsed.tracks[1].events.some((event) => event.type === 'noteOn' && event.note === 60));
});

test('MIDI metadata is used when importing without explicit title', () => {
  const imported = core.convertMidiToSong(core.parseMidi(makeMidiFixture()), {
    symbol: 'lead_theme',
  });

  assert.equal(imported.song.title, 'Lead');
  assert.equal(imported.song.artist, 'Composer Name');
  assert.equal(imported.song.metadata.midi.title, 'Lead');
  assert.equal(imported.song.metadata.midi.artist, 'Composer Name');
});

test('MIDI import builds an XGM2-safe song and reports lossy conversions', () => {
  const imported = core.convertMidiToSong(core.parseMidi(makeMidiFixture()), {
    title: 'Lead Theme',
    symbol: 'lead_theme',
  });

  assert.equal(imported.song.symbol, 'lead_theme');
  assert.equal(imported.song.tempo, 120);
  assert.equal(imported.allocations[0].target, 'FM1');
  assert.equal(imported.song.patterns[0].rows[0].cells.FM1.note, 'C4');
  assert.ok(imported.diagnostics.some((diag) => diag.code === 'pitch-bend-ignored'));

  const remapped = core.convertMidiToSong(core.parseMidi(makeMidiFixture()), {
    title: 'Lead Theme',
    symbol: 'lead_theme',
    allocations: [{ key: imported.allocations[0].key, target: 'PSG1' }],
  });
  assert.equal(remapped.allocations[0].target, 'PSG1');
  assert.equal(remapped.song.patterns[0].rows[0].cells.PSG1.note, 'C4');
});

test('channel allocator trims tracks that exceed FM/PSG/noise profile', () => {
  const diagnostics = [];
  const candidates = Array.from({ length: 11 }, (_, index) => ({
    key: `t${index}:0`,
    trackName: `Track ${index}`,
    midiChannel: index === 0 ? 9 : 0,
    notes: Array.from({ length: 4 }, () => ({ note: 60 })),
  }));

  const allocations = core.allocateMidiTracks(candidates, diagnostics);
  assert.equal(allocations.filter((entry) => entry.target === 'NOISE').length, 1);
  assert.equal(allocations.filter((entry) => entry.target === 'ignore').length, 2);
  assert.ok(diagnostics.some((diag) => diag.code === 'midi-track-overflow'));
});

test('VGM writer emits Mega Drive header, YM2612, PSG, waits, and end command', () => {
  const song = core.createDefaultSong({ symbol: 'test_bgm' });
  song.instruments[0].algorithm = 7;
  song.instruments[0].feedback = 5;
  song.instruments[0].ams = 2;
  song.instruments[0].fms = 3;
  song.instruments[0].operators[0] = {
    tl: 11, ar: 22, dr: 9, sr: 4, rr: 7, sl: 3, detune: 2, multiple: 5, rs: 1, am: 1, ssgEg: 8,
  };
  song.patterns[0].rows[0].cells.FM1 = { note: 'C4', midiNote: 60, instrument: 'fm_bell', volume: 12 };
  song.patterns[0].rows[1].cells.PSG1 = { note: 'E4', midiNote: 64, instrument: 'psg_square', volume: 10 };
  song.patterns[0].rows[2].cells.NOISE = { note: 'N', instrument: 'noise_kit', volume: 10 };

  const vgm = core.writeVgm(song);
  assert.equal(vgm.toString('ascii', 0, 4), 'Vgm ');
  assert.equal(vgm.readUInt32LE(0x0C), 3579545);
  assert.equal(vgm.readUInt32LE(0x2C), 7670454);
  assert.ok(vgm.includes(0x52));
  assert.ok(vgm.includes(0x50));
  assert.ok(vgm.includes(0x61) || vgm.includes(0x62));
  assert.ok(vgm.includes(Buffer.from([0x52, 0x30, 0x25])), 'FM operator DT/MUL register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0x50, 0x56])), 'FM operator RS/AR register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0x60, 0x89])), 'FM operator AM/D1R register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0x70, 0x04])), 'FM operator D2R register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0x80, 0x37])), 'FM operator D1L/RR register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0x90, 0x08])), 'FM operator SSG-EG register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0xB0, 0x2F])), 'FM algorithm/feedback register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0xB4, 0xE3])), 'FM pan/AMS/FMS register is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0x28, 0xF0])), 'FM key-on is exported');
  assert.ok(vgm.includes(Buffer.from([0x52, 0x28, 0x00])), 'FM key-off is exported');
  assert.ok(vgm.includes(Buffer.from([0x50, 0x9F])), 'PSG volume-off is exported');
  assert.equal(vgm[vgm.length - 1], 0x66);
});

test('VGM writer and preview timing honor speed as ticks per row', () => {
  const rendererSource = fs.readFileSync(path.join(pluginDir, 'renderer.js'), 'utf-8');
  const fast = core.createDefaultSong({ symbol: 'fast_bgm', tempo: 150, speed: 3 });
  const slow = core.createDefaultSong({ symbol: 'slow_bgm', tempo: 150, speed: 12 });

  const fastVgm = core.writeVgm(fast);
  const slowVgm = core.writeVgm(slow);

  assert.equal(slowVgm.readUInt32LE(0x18), fastVgm.readUInt32LE(0x18) * 4);
  assert.match(rendererSource, /function rowDurationMs\(song\)/);
  assert.match(rendererSource, /speed \/ 6/);
  assert.match(rendererSource, /const rowMs = rowDurationMs\(song\)/);
});

test('export hook saves song and VGM, and reports missing xgmtool clearly', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bgm-composer-'));
  const song = core.createDefaultSong({ symbol: 'export_theme' });
  song.patterns[0].rows[0].cells.FM1 = { note: 'C4', midiNote: 60, instrument: 'fm_bell', volume: 12 };

  const result = composer.exportMusic({
    song,
    symbol: 'export_theme',
    xgmToolPath: path.join(projectDir, 'missing-xgmtool.exe'),
    outputs: { xgm: true, registerAsset: true },
  }, { projectDir });

  assert.equal(result.ok, true);
  assert.equal(result.files.json, 'res/music/export_theme.mdbgm.json');
  assert.equal(result.files.vgm, 'res/music/export_theme.vgm');
  assert.equal(result.asset.type, 'XGM2');
  assert.equal(result.asset.sourcePath, 'music/export_theme.vgm');
  assert.ok(result.warnings.some((warning) => warning.includes('xgmtool')));
  assert.ok(fs.existsSync(path.join(projectDir, 'res', 'music', 'export_theme.mdbgm.json')));
  assert.ok(fs.existsSync(path.join(projectDir, 'res', 'music', 'export_theme.vgm')));
});

test('preview hook returns in-memory VGM for high-accuracy renderer playback', () => {
  const song = core.createDefaultSong({ symbol: 'preview_theme' });
  song.patterns[0].rows[0].cells.FM1 = { note: 'C4', midiNote: 60, instrument: 'fm_bell', volume: 12 };

  const result = composer.previewMusic({ song, symbol: 'preview_theme' });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.symbol, 'preview_theme');
  assert.match(result.dataUrl, /^data:audio\/vgm;base64,/);
  const data = Buffer.from(result.dataUrl.split(',')[1], 'base64');
  assert.equal(data.toString('ascii', 0, 4), 'Vgm ');
  assert.ok(result.byteLength > 0);
});

test('export hook honors selected asset source path for res-based editing', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bgm-composer-target-'));
  const song = core.createDefaultSong({ symbol: 'stage_theme' });
  song.patterns[0].rows[0].cells.FM1 = { note: 'C4', midiNote: 60, instrument: 'fm_bell', volume: 12 };

  const result = composer.exportMusic({
    song,
    symbol: 'stage_theme',
    sourcePath: 'music/stage/stage_theme.vgm',
    outputs: { xgm: false, registerAsset: true },
  }, { projectDir });

  assert.equal(result.ok, true);
  assert.equal(result.files.json, 'res/music/stage/stage_theme.mdbgm.json');
  assert.equal(result.files.vgm, 'res/music/stage/stage_theme.vgm');
  assert.equal(result.asset.sourcePath, 'music/stage/stage_theme.vgm');
  assert.ok(fs.existsSync(path.join(projectDir, 'res', 'music', 'stage', 'stage_theme.mdbgm.json')));
  assert.ok(fs.existsSync(path.join(projectDir, 'res', 'music', 'stage', 'stage_theme.vgm')));
});

test('VGM analyzer approximates editable song data from YM2612 and PSG writes', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bgm-composer-analyze-'));
  const song = core.createDefaultSong({ symbol: 'analyzed_theme' });
  song.patterns[0].rows[0].cells.FM1 = { note: 'C4', midiNote: 60, instrument: 'fm_bell', volume: 12 };
  song.patterns[0].rows[1].cells.PSG1 = { note: 'E4', midiNote: 64, instrument: 'psg_square', volume: 10 };
  const vgmPath = path.join(projectDir, 'theme.vgm');
  fs.writeFileSync(vgmPath, core.writeVgm(song));

  const result = composer.analyzeVgm({ sourcePath: vgmPath, symbol: 'theme' }, { projectDir });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.song.symbol, 'theme');
  assert.ok(result.song.patterns[0].rows.some((row) => row.cells.FM1?.note));
  assert.ok(result.diagnostics.some((diag) => diag.code === 'vgm-approximation'));
});

test('VGM analyzer imports GD3 metadata and infers tempo/speed from wait stream', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bgm-composer-gd3-'));
  const song = core.createDefaultSong({ symbol: 'gd3_theme', title: 'Ignored', artist: 'Ignored', tempo: 150, speed: 6 });
  song.patterns[0].rows[0].cells.FM1 = { note: 'C4', midiNote: 60, instrument: 'fm_bell', volume: 12 };
  const vgmPath = path.join(projectDir, 'theme.vgm');
  fs.writeFileSync(vgmPath, withGd3(core.writeVgm(song), {
    title: 'GD3 Title',
    artist: 'GD3 Artist',
  }));

  const result = composer.analyzeVgm({ sourcePath: vgmPath, symbol: 'theme' }, { projectDir });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.song.title, 'GD3 Title');
  assert.equal(result.song.artist, 'GD3 Artist');
  assert.equal(result.song.tempo, 150);
  assert.equal(result.song.speed, 6);
  assert.equal(result.song.metadata.source.type, 'VGM');
  assert.ok(result.song.metadata.source.durationSec > 0);
  assert.ok(result.diagnostics.some((diag) => diag.code === 'vgm-gd3-metadata'));
  assert.ok(result.diagnostics.some((diag) => diag.code === 'vgm-grid-inferred'));
});

test('XGM analyzer creates a lossy editable scaffold instead of failing', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bgm-composer-xgm-'));
  const xgmPath = path.join(projectDir, 'theme.xgm');
  fs.writeFileSync(xgmPath, Buffer.from([0x90, 0x24, 0x80, 0xff]));

  const result = composer.analyzeVgm({ sourcePath: xgmPath, symbol: 'theme' }, { projectDir });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.song.symbol, 'theme');
  assert.ok(result.diagnostics.some((diag) => diag.code === 'xgm-approximation'));
});
