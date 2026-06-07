'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadWithMockedElectron } = require('./helpers/mock-electron');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('rhythm plugins declare MD editor and builder capabilities', () => {
  const userData = makeTempDir('md-editor-rhythm-plugin-list-');
  const pluginManager = loadWithMockedElectron(path.join(__dirname, '..', 'plugin-manager.js'), { userData });
  const editor = pluginManager.listPlugins().find((item) => item.id === 'rhythm-game-editor');
  const builder = pluginManager.listPlugins().find((item) => item.id === 'rhythm-game-builder');

  assert.ok(editor);
  assert.equal(editor.name, 'リズムゲームエディター');
  assert.deepEqual(editor.supportedCores, ['mega-drive']);
  assert.equal(editor.hasRenderer, true);
  assert.equal(editor.renderer.page, 'rhythm-game-editor');
  assert.deepEqual(editor.renderer.capabilities, ['page', 'rhythm-game-editor']);
  assert.deepEqual(editor.mainApi.hooks, [
    'listRhythmSongs',
    'saveRhythmSong',
    'deleteRhythmSong',
    'moveRhythmSong',
    'listRhythmSettings',
    'saveRhythmSettings',
    'exportRhythmData',
    'validateRhythmProject',
  ]);

  assert.ok(builder);
  assert.equal(builder.name, 'リズムゲームビルダー');
  assert.deepEqual(builder.supportedCores, ['mega-drive']);
  assert.deepEqual(builder.dependencies, ['rhythm-game-editor']);
  assert.equal(builder.roles.length, 1);
  assert.equal(builder.roles[0].id, 'builder');
});

test('rhythm-game-editor hooks save, reorder, delete, and export songs', () => {
  const projectDir = path.join(makeTempDir('md-editor-rhythm-editor-'), 'demo');
  fs.mkdirSync(projectDir, { recursive: true });
  const plugin = require('../plugins/rhythm-game-editor');
  const assets = [
    { type: 'WAV', name: 'song_main_bgm', sourcePath: 'songs/main.wav', outRate: '6650' },
    { type: 'IMAGE', name: 'img_album_main', sourcePath: 'gfx/album.png' },
    { type: 'SPRITE', name: 'spr_mood_main', sourcePath: 'sprite/mood.png', width: '16', height: '12' },
    { type: 'SPRITE', name: 'spr_custom_note', sourcePath: 'sprite/note.png', width: '2', height: '2' },
  ];
  const context = { projectDir, assets, logger: logger() };

  const first = plugin.saveRhythmSong({
    create: true,
    song: {
      song_id: 'main',
      title: 'Main Theme',
      display_name: 'Main Theme',
      bpm: 132,
      audio_symbol: 'song_main_bgm',
      song_images: {
        album_art: 'img_album_main',
        mood_sprite: { symbol: 'spr_mood_main', frame_w: 128, frame_h: 96, fps: 8 },
      },
      charts: {
        easy: { notes: [{ time: 1, type: 'A', pattern: 'TAP' }] },
        normal: { notes: [{ time: 1.5, type: 'LEFT', pattern: 'HOLD', duration: 0.75 }] },
        hard: { notes: [{ time: 2, type: 'C', pattern: 'RAPID', duration: 1 }] },
      },
    },
  }, context);
  const second = plugin.saveRhythmSong({ create: true, song: { song_id: 'sub', title: 'Sub Theme' } }, context);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const settings = plugin.saveRhythmSettings({
    settings: {
      sprites: { note_sheet: 'spr_custom_note' },
      select_effects: { wobble_amplitude: 1.25, wobble_speed: 2, wobble_angular_velocity: 6, diag_scroll_x_speed: -1, diag_scroll_y_speed: 1.5 },
    },
  }, context);
  assert.equal(settings.ok, true);

  const moved = plugin.moveRhythmSong({ song_id: 'sub', direction: 'up' }, context);
  assert.equal(moved.ok, true);
  assert.equal(moved.moved, true);
  assert.deepEqual(moved.songs.map((song) => song.song_id), ['sub', 'main']);

  const renamed = plugin.saveRhythmSong({
    previous_song_id: 'main',
    song: { ...first.song, song_id: 'main_renamed', display_name: 'Main Renamed' },
  }, context);
  assert.equal(renamed.ok, true);
  assert.deepEqual(renamed.songs.map((song) => song.song_id).sort(), ['main_renamed', 'sub']);

  const exported = plugin.exportRhythmData({
    templateRoot: path.join(__dirname, '..', 'plugins', 'rhythm-game-builder', 'template'),
  }, context);
  assert.equal(exported.ok, true);
  assert.equal(fs.existsSync(path.join(projectDir, 'res', 'rhythm.res')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'rhythm_resources.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'song_data.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'song_data.c')), true);

  const rhythmRes = fs.readFileSync(path.join(projectDir, 'res', 'rhythm.res'), 'utf-8');
  assert.match(rhythmRes, /SPRITE rhythm_spr_note "sprite\/note\.png" 2 2 NONE 4 NONE/);
  assert.match(rhythmRes, /WAV rhythm_snd_main_renamed_bgm "songs\/main\.wav" XGM2 6650 TRUE/);
  assert.match(rhythmRes, /IMAGE rhythm_img_main_renamed_album_art "gfx\/album\.png" BEST/);

  const gameDef = fs.readFileSync(path.join(projectDir, 'inc', 'game_def.h'), 'utf-8');
  assert.match(gameDef, /#define MAX_SONGS\s+2/);
  assert.match(gameDef, /#define NOTE_LEFT\s+0/);
  assert.match(gameDef, /#define NOTE_UP\s+1/);
  assert.match(gameDef, /#define NOTE_DOWN\s+2/);
  assert.match(gameDef, /#define JUDGE_LINE_Y\s+184/);
  assert.match(gameDef, /#define LANE_X_START\s+16/);
  assert.match(gameDef, /#define NOTE_SPAWN_Y\s+-16/);
  assert.match(gameDef, /#define GAUGE_SEGMENTS\s+6/);
  assert.doesNotMatch(gameDef, /JUDGE_LINE_X|NOTE_SPAWN_X|LANE_Y_START|LANE_HEIGHT/);
  assert.match(gameDef, /#define SELECT_WOBBLE_AMPLITUDE_DEF\s+FIX16\(1\.2500\)/);

  const deleted = plugin.deleteRhythmSong({ song_id: 'sub' }, context);
  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.songs.map((song) => song.song_id), ['main_renamed']);
});

test('rhythm-game-builder syncs engine, generated data, and build variables', () => {
  const projectDir = path.join(makeTempDir('md-editor-rhythm-builder-'), 'demo');
  const romHeadPath = path.join(projectDir, 'src', 'boot', 'rom_head.c');
  fs.mkdirSync(path.dirname(romHeadPath), { recursive: true });
  fs.writeFileSync(romHeadPath, '/* user generated ROM header */\n', 'utf-8');

  const builder = require('../plugins/rhythm-game-builder');
  const manifest = require('../plugins/rhythm-game-builder/manifest.json');
  const context = { projectDir, assets: [], logger: logger() };

  const generated = builder.generateSource([], context);
  assert.equal(generated.ok, true);
  assert.match(generated.sourceCode, new RegExp(`Generated by rhythm-game-builder v${escapeRegExp(manifest.version)}`));
  assert.match(generated.sourceCode, /int main\(bool hardReset\)/);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'game.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'utils', 'draw_sjis.c')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'inc', 'utils', 'draw_sjis.h')), true);
  assert.equal(fs.existsSync(path.join(projectDir, 'src', 'boot', 'sega.s')), true);
  assert.equal(fs.readFileSync(romHeadPath, 'utf-8'), '/* user generated ROM header */\n');

  const songData = fs.readFileSync(path.join(projectDir, 'src', 'song_data.c'), 'utf-8');
  assert.match(songData, /const u16 song_count = 1;/);
  assert.match(songData, /rhythm_snd_sample_song_bgm/);
  assert.match(songData, /\{ 60, NOTE_LEFT, PATTERN_TAP, 0 \}[\s\S]*\{ 90, NOTE_UP, PATTERN_TAP, 0 \}[\s\S]*\{ 120, NOTE_DOWN, PATTERN_TAP, 0 \}[\s\S]*\{ 150, NOTE_RIGHT, PATTERN_TAP, 0 \}/);

  const noteSource = fs.readFileSync(path.join(projectDir, 'src', 'note.c'), 'utf-8');
  assert.match(noteSource, /laneToX/);
  assert.match(noteSource, /JUDGE_LINE_Y - \(s16\)\(frames_until_judge \* NOTE_SPEED\)/);
  assert.doesNotMatch(noteSource, /NOTE_SPAWN_X|JUDGE_LINE_X|laneToY/);

  const inputSource = fs.readFileSync(path.join(projectDir, 'src', 'input.c'), 'utf-8');
  assert.match(inputSource, /BUTTON_LEFT\) return NOTE_LEFT;[\s\S]*BUTTON_UP\) return NOTE_UP;[\s\S]*BUTTON_DOWN\) return NOTE_DOWN;/);

  const buildStart = builder.onBuildStart({ projectDir }, context);
  assert.equal(buildStart.ok, true);
  assert.match(buildStart.makeVariables.SRC_C, /src\/main\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/utils\/draw_sjis\.c/);
  assert.match(buildStart.makeVariables.SRC_C, /src\/song_data\.c/);
  assert.equal(Object.hasOwn(buildStart.makeVariables, 'SRC_S'), false);
});

test('rhythm-game-editor renderer provides waveform, converter, activation refresh, and dirty guard UI', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'rhythm-game-editor', 'renderer.js'), 'utf-8');
  const styleSource = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'rhythm-game-editor', 'style.css'), 'utf-8');

  assert.match(rendererSource, /<canvas class="rge-waveform"/);
  assert.match(rendererSource, /audio-convert-ui/);
  assert.match(rendererSource, /image-import-pipeline/);
  assert.match(rendererSource, /function refreshVisibleAssetDefinitions\(\)/);
  assert.match(rendererSource, /new MutationObserver/);
  assert.match(rendererSource, /rge-dirty-guard/);
  assert.match(rendererSource, /data-action="toggle-playback"/);
  assert.match(rendererSource, /data-action="stop-playback"/);
  assert.match(rendererSource, /class="rge-playback-speed"/);
  assert.match(rendererSource, /const NOTE_TYPES = \['LEFT', 'UP', 'DOWN', 'RIGHT', 'A', 'B', 'C'\];/);
  assert.match(rendererSource, /class="rge-record-toggle"/);
  assert.match(rendererSource, /data-action="auto-bpm"/);
  assert.match(rendererSource, /data-action="auto-place"/);
  assert.match(rendererSource, /data-action="delete-selected"/);
  assert.match(rendererSource, /class="rge-meta-accordion" open/);
  assert.match(rendererSource, /class="rge-accordion-caret"/);
  assert.match(rendererSource, /class="rge-meta-title"/);
  assert.match(rendererSource, /class="rge-accordion-state"/);
  assert.match(rendererSource, /class="rge-meta-column"/);
  assert.match(rendererSource, /class="rge-field-pair"/);
  assert.match(rendererSource, /class="rge-difficulty-row"/);
  assert.match(rendererSource, /class="rge-chart-panel"/);
  assert.match(rendererSource, /class="rge-note-tools"/);
  assert.match(rendererSource, /class="rge-meta-panel"/);
  const metaPanelIndex = rendererSource.indexOf('class="rge-meta-panel"');
  const difficultyRowIndex = rendererSource.indexOf('class="rge-difficulty-row"');
  const waveformIndex = rendererSource.indexOf('<canvas class="rge-waveform"');
  const noteToolsIndex = rendererSource.indexOf('class="rge-note-tools"');
  assert.ok(metaPanelIndex >= 0);
  assert.ok(difficultyRowIndex > metaPanelIndex);
  assert.ok(waveformIndex > difficultyRowIndex);
  assert.ok(noteToolsIndex > waveformIndex);
  assert.match(rendererSource, /class="rge-stage-thumb rge-album-thumb"/);
  assert.match(rendererSource, /class="rge-mood-preview"/);
  assert.match(rendererSource, /selectedNoteIndices:\s*new Set\(\)/);
  assert.match(rendererSource, /selectionBox:\s*null/);
  assert.match(rendererSource, /function deleteSelectedNotes\(\)/);
  assert.match(rendererSource, /function detectBeats\(\)/);
  assert.match(rendererSource, /function detectAndSetBpm\(\)/);
  assert.match(rendererSource, /function openAutoPlaceDialog\(\)/);
  assert.match(rendererSource, /function executeAutoPlace\(panel\)/);
  assert.match(rendererSource, /name="note-type" value="\$\{type\}" checked/);
  assert.doesNotMatch(rendererSource, /type === 'C'\s*\?\s*''\s*:\s*'checked'/);
  assert.match(rendererSource, /NOTE_KEY_MAP/);
  assert.match(rendererSource, /const MOOD_FRAME_W = 128;/);
  assert.match(rendererSource, /const MOOD_FRAME_H = 96;/);
  assert.match(rendererSource, /const MOOD_FPS = 8;/);
  assert.match(rendererSource, /registerCapability\('rhythm-game-editor'/);
  assert.doesNotMatch(rendererSource, /preview-song-audio/);
  assert.doesNotMatch(rendererSource, /rge-selected-note/);
  assert.doesNotMatch(rendererSource, /rge-note-list/);
  assert.doesNotMatch(rendererSource, /class="rge-splitter"/);
  assert.doesNotMatch(rendererSource, /class="rge-left"/);
  assert.doesNotMatch(rendererSource, /class="rge-right"/);
  assert.doesNotMatch(rendererSource, /rge-mood-w/);
  assert.doesNotMatch(rendererSource, /rge-mood-h/);
  assert.doesNotMatch(rendererSource, /rge-mood-fps/);
  assert.doesNotMatch(styleSource, /--rge-left/);
  assert.doesNotMatch(styleSource, /--rge-right/);
  assert.doesNotMatch(styleSource, /\.rge-splitter/);
  assert.match(styleSource, /\.rge-meta-accordion/);
  assert.match(styleSource, /\.rge-accordion-caret/);
  assert.match(styleSource, /\.rge-accordion-state::before\s*\{[\s\S]*content:\s*"展開中"/);
  assert.match(styleSource, /\.rge-meta-accordion:not\(\[open\]\) \.rge-accordion-state::before\s*\{[\s\S]*content:\s*"折りたたみ"/);
  assert.match(styleSource, /\.rge-meta-accordion summary:hover/);
  assert.match(styleSource, /grid-template-columns:\s*minmax\(360px,\s*1fr\)\s*minmax\(320px,\s*400px\)/);
  assert.match(styleSource, /\.rge-meta-panel\s*\{[\s\S]*padding:\s*10px 10px 10px/);
  assert.match(styleSource, /\.rge-field-pair/);
  assert.match(styleSource, /\.rge-difficulty-row/);
  assert.match(styleSource, /\.rge-chart-panel/);
  assert.match(styleSource, /\.rge-note-tools/);
  assert.match(styleSource, /\.rge-meta-panel/);
  assert.match(styleSource, /\.rge-tab-panel\.active\s*\{[\s\S]*display:\s*flex/);
  assert.match(styleSource, /\.rge-assets,[\s\S]*\.rge-settings\s*\{[\s\S]*overflow:\s*auto[\s\S]*flex:\s*1/);
  assert.match(styleSource, /\.rge-asset-table\s*\{[\s\S]*min-width:\s*760px/);
  assert.match(styleSource, /\.rge-stage-thumb/);
  assert.match(styleSource, /\.rge-sprite-preview-frame/);
  assert.match(styleSource, /\.rge-mood-preview/);
  assert.match(styleSource, /\.rge-record-control/);
  assert.match(styleSource, /\.rge-auto-panel/);
  assert.match(styleSource, /\.rge-auto-presets/);
  assert.match(styleSource, /\.rge-note-palette,[\s\S]*\.rge-pattern-palette\s*\{[\s\S]*display:\s*flex/);
  assert.doesNotMatch(styleSource, /^\.rhythm-editor-root\s*\{[^}]*display:\s*none/im);
});
