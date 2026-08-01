'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const iconv = require('iconv-lite');
const converter = require('../plugins/pce-kitahe-pm-converter/converter');
const plugin = require('../plugins/pce-kitahe-pm-converter');
const vnManager = require('../pce-vn-manager');

function scr(text) {
  return iconv.encode(String(text).replace(/\n/g, '\r\n'), 'cp932');
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function analyze(lines, extraFiles = []) {
  return converter.inspectScripts({
    files: [
      { path: 'A.SCR', buffer: scr(lines.join('\n')) },
      ...extraFiles.map((file) => ({ path: file.path, buffer: scr(file.lines.join('\n')) })),
    ],
    entryScript: 'A.SCR',
  });
}

test('Kitahe PM sourceKey contract matches Viewer fixed vectors and separates PLAYP rates', () => {
  assert.equal(converter.assetSourceKey('image', [
    'BG/KYOTSUU/BGF011_A.PVR',
    'BG/KYOTSUU/BGF011_B.PVR',
  ], {
    crops: [{ width: 320, height: 240 }, { width: 320, height: 240 }],
  }), 'image-aab5c68d56ce9a54');
  assert.equal(converter.assetSourceKey('p04', 'VOICE/AY/V001.P04', {
    usage: 'voice', loop: false, playbackRate: 22050,
  }), 'p04-83dbeb09338a0511');
  assert.equal(
    converter.assetSourceKey('midi', 'MIDI/PM_bank00_track11.mid'),
    'midi-f4c1d8d28017e69f',
  );

  const analysis = analyze([
    'PCMDIR \\SE',
    'LPCM 0, SHARED',
    'PLAYP 0',
    'PLAYP 0, 22050, OFF, 1',
    'END',
  ]);
  const requirements = analysis.requirements.filter((entry) => entry.kind === 'p04');
  assert.equal(requirements.length, 2);
  assert.deepEqual(requirements.map((entry) => entry.details.playbackRate).sort(), [22050, 32000]);
  assert.notEqual(requirements[0].key, requirements[1].key);

  const invalidRate = analyze([
    'PCMDIR \\SE',
    'LPCM 0, SHARED',
    'PLAYP 0, UNKNOWN_RATE',
    'END',
  ]);
  assert.ok(invalidRate.diagnostics.some((entry) => entry.code === 'invalid-playp-rate'));
  assert.equal(invalidRate.requirements.filter((entry) => entry.kind === 'p04').length, 0);
});

test('Kitahe PM parser accepts CP932, unclosed strings, and both IF GOTO forms', () => {
  const parsed = converter.parseScrBuffer('ADV_TEST.SCR', scr([
    '# comment',
    'DEFINE FLAG',
    'IF FLAG == 0 GOTO FALSE_PATH',
    'IF FLAG != 1 THEN GOTO TRUE_PATH',
    'IF FLAG == 2 THEN FLAG = 3',
    'CH1 = "KAPM_001',
  ].join('\n')));

  assert.equal(parsed.instructions.length, 5);
  assert.deepEqual(parsed.instructions[1].condition, {
    left: 'FLAG',
    operator: '==',
    right: '0',
    then: 'GOTO FALSE_PATH',
  });
  assert.equal(parsed.instructions[2].condition.then, 'GOTO TRUE_PATH');
  assert.equal(parsed.instructions[3].condition.then, 'FLAG = 3');
  assert.equal(parsed.instructions[4].assignment.value, 'KAPM_001');
  assert.ok(parsed.diagnostics.some((entry) => entry.code === 'unclosed-quote'));
  assert.ok(!parsed.diagnostics.some((entry) => entry.code === 'invalid-if'));
});

test('Kitahe PM converts cross-script IF THEN assignment to a different shared variable', () => {
  const analysis = analyze([
    'DEFINE SANTAKU_OK',
    'SANTAKU_OK = 0',
    'DEFINE TOTAL_OK',
    'TOTAL_OK = 0',
    'GOTO TOP, B.SCR',
  ], [{
    path: 'B.SCR',
    lines: [
      'LABEL TOP',
      'IF SANTAKU_OK != 3 THEN TOTAL_OK = 1',
      'END',
    ],
  }]);

  assert.ok(analysis.runtimeVariables.has('SANTAKU_OK'));
  assert.ok(analysis.runtimeVariables.has('TOTAL_OK'));
  const converted = converter.convertScripts(analysis, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  assert.ok(!converted.diagnostics.some((entry) => entry.code === 'unsupported-if-action'));
  const commands = converted.scenes.flatMap((scene) => scene.commands);
  const conditionIndex = commands.findIndex((command) => command.type === 'if');
  assert.ok(conditionIndex >= 0);
  assert.equal(commands[conditionIndex].variableName, 'SANTAKU_OK');
  assert.ok(commands.slice(conditionIndex + 1).some((command) => (
    command.type === 'variable'
    && command.variableName === 'TOTAL_OK'
    && command.operation === 'set'
    && command.value === 1
  )));

  const invalid = analyze([
    'DEFINE SOURCE',
    'DEFINE TARGET',
    'IF SOURCE == 0 THEN TARGET = UNKNOWN_VALUE',
    'END',
  ]);
  const rejected = converter.convertScripts(invalid, { mapping: {}, assetCatalog: [] });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.diagnostics.some((entry) => entry.code === 'unsupported-if-action'));
});

test('Kitahe PM inspection keeps LINKCG ordered pairs and does not carry voice across a branch', () => {
  const analysis = converter.inspectScripts({
    files: [{
      path: 'ADV_TEST.SCR',
      buffer: scr([
        'LABEL TOP',
        'CGDIR CG_BG, \\BG\\TEST',
        'LCG 0, LEFT, 512, 480',
        'LCG 1, RIGHT, 128, 480',
        'LINKCG 0, 1',
        'ICG 0, 0, 0',
        'PCMDIR \\VOICE\\TEST',
        'LPCM 2, V001',
        'PLAYP 2',
        'GOTO TALK',
        'LABEL TALK',
        'MSG WIN_MSG, あいうえお',
        'WAIT WIN_MSG',
        'END',
      ].join('\n')),
    }],
    entryScript: 'ADV_TEST.SCR',
  });

  const image = analysis.requirements.find((entry) => entry.kind === 'image');
  assert.deepEqual(image.details.parts, ['BG/TEST/LEFT.PVR', 'BG/TEST/RIGHT.PVR']);
  assert.deepEqual(image.details.orderedSlots, ['0', '1']);
  const waitFact = Array.from(analysis.facts.values()).find((fact) => fact.message);
  assert.equal(waitFact.message.voiceRequirementKey, '');
});

test('Kitahe PM derives automatic asset names from single and joined source files', () => {
  const single = {
    key: 'single',
    kind: 'image',
    source: 'NEW/AYU/KAPM_001.PVR',
    details: { parts: ['NEW/AYU/KAPM_001.PVR'] },
  };
  const joined = {
    key: 'joined',
    kind: 'image',
    source: 'BG/KYOTSUU/BGF011_A.PVR + BG/KYOTSUU/BGF011_B.PVR',
    details: {
      parts: [
        'BG/KYOTSUU/BGF011_A.PVR',
        'BG/KYOTSUU/BGF011_B.PVR',
      ],
    },
  };
  assert.equal(converter.assetMatchName(single), 'NEW/AYU/KAPM_001');
  assert.equal(converter.assetMatchName(joined), 'BG/KYOTSUU/BGF011');

  const suggested = plugin.suggestAssetRequirements([single, joined], [
    { id: 'kapm_001', name: 'new\\ayu\\kapm_001', type: 'image' },
    { id: 'bgf011_sprite', name: 'BG/KYOTSUU/BGF011', type: 'sprite' },
    { id: 'bgf011_image', name: 'BG/KYOTSUU/BGF011', type: 'image' },
    { id: 'wrong_type', name: 'NEW/AYU/KAPM_001', type: 'adpcm' },
  ]);
  assert.equal(suggested[0].suggestedAssetId, 'kapm_001');
  assert.equal(suggested[0].suggestedAssetType, 'image');
  assert.equal(suggested[1].suggestedAssetName, 'BG/KYOTSUU/BGF011');
  assert.equal(suggested[1].suggestedAssetId, 'bgf011_image');
  assert.equal(suggested[1].suggestedAssetType, 'image');
});


test('Kitahe PM auto mapping prioritizes unique sourceKey and limits name fallback to legacy assets', () => {
  const details = {
    parts: ['BG/KYOTSUU/BGF011_A.PVR', 'BG/KYOTSUU/BGF011_B.PVR'],
    crops: [{ width: 320, height: 240 }, { width: 320, height: 240 }],
  };
  const requirement = {
    key: converter.assetSourceKey('image', details.parts, details),
    kind: 'image',
    source: details.parts.join(' + '),
    details,
  };
  const provenance = (sourceKey) => ({ import: { kitahePm: { sourceKey } } });

  const exact = plugin.suggestAssetRequirements([requirement], [{
    id: 'exact', type: 'image', name: 'completely/different', data: provenance(requirement.key),
  }])[0];
  assert.equal(exact.suggestedAssetId, 'exact');
  assert.equal(exact.suggestedBy, 'sourceKey');

  const duplicate = plugin.suggestAssetRequirements([requirement], [
    { id: 'one', type: 'image', name: 'one', data: provenance(requirement.key) },
    { id: 'two', type: 'sprite', name: 'two', data: provenance(requirement.key) },
  ])[0];
  assert.equal(duplicate.suggestedAssetId, '');
  assert.equal(duplicate.sourceKeyMatchCount, 2);

  const wrongOwned = plugin.suggestAssetRequirements([requirement], [{
    id: 'wrong-owned',
    type: 'image',
    name: 'BG/KYOTSUU/BGF011',
    data: provenance('image-0000000000000000'),
  }])[0];
  assert.equal(wrongOwned.suggestedAssetId, '');

  const legacy = plugin.suggestAssetRequirements([requirement], [
    { id: 'wrong-owned', type: 'image', name: 'BG/KYOTSUU/BGF011', data: provenance('image-0000000000000000') },
    { id: 'legacy', type: 'image', name: 'BG/KYOTSUU/BGF011' },
  ])[0];
  assert.equal(legacy.suggestedAssetId, 'legacy');
  assert.equal(legacy.suggestedBy, 'name');
});

test('Kitahe PM maps static COLOR values while treating every message as narration', () => {
  const analysis = converter.inspectScripts({
    files: [{
      path: 'ADV_TEST.SCR',
      buffer: scr([
        'LABEL TOP',
        'DEFINE GCOLOR',
        'DEFINE PCOLOR',
        'GCOLOR = 0xFAAA',
        'PCOLOR = 0xF1B8',
        'COLOR WIN_MSG, GCOLOR',
        'MSG WIN_MSG, ヒロインの台詞',
        'WAIT WIN_MSG',
        'COLOR WIN_MSG, PCOLOR',
        'MSG WIN_MSG, 主人公の台詞',
        'WAIT WIN_MSG',
        'END',
      ].join('\n')),
    }],
    entryScript: 'ADV_TEST.SCR',
  });

  const converted = converter.convertScripts(analysis, {
    mapping: {},
    assetCatalog: [],
    namespace: 'khpm_test',
  });
  const legacyMapped = converter.convertScripts(analysis, {
    mapping: {
      speakers: {
        GCOLOR: { mode: 'speaker', name: 'ヒロイン' },
        PCOLOR: { mode: 'speaker', name: '主人公' },
      },
      assets: {},
    },
    assetCatalog: [],
    namespace: 'khpm_legacy_mapping',
  });
  assert.equal(converted.ok, true);
  assert.equal(legacyMapped.ok, true);
  const messages = converted.scenes.flatMap((scene) => scene.commands)
    .filter((command) => command.type === 'message');
  const legacyMessages = legacyMapped.scenes.flatMap((scene) => scene.commands)
    .filter((command) => command.type === 'message');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((message) => message.speaker), ['', '']);
  assert.deepEqual(messages.map((message) => message.textColor), ['#aaaaaa', '#11bb88']);
  assert.deepEqual(legacyMessages.map((message) => message.speaker), ['', '']);
  assert.deepEqual(legacyMessages.map((message) => message.textColor), ['#aaaaaa', '#11bb88']);
  assert.deepEqual(Object.keys(converted.normalizedMapping.speakers), []);
  assert.ok(!converted.diagnostics.some((entry) => entry.code === 'missing-speaker-mapping'));
});

test('Kitahe PM compacts SCR line breaks and paginates narration at 67 glyphs', () => {
  const first = 'あ'.repeat(34);
  const second = 'い'.repeat(34);
  const analysis = analyze([
    `MSG WIN_MSG, ${first}\\n`,
    `MSG WIN_MSG, ${second}`,
    'WAIT WIN_MSG',
    'END',
  ]);
  const converted = converter.convertScripts(analysis, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  const messages = converted.scenes.flatMap((scene) => scene.commands)
    .filter((command) => command.type === 'message');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((message) => Array.from(message.text).length), [67, 1]);
  assert.ok(messages.every((message) => message.speaker === '' && !message.text.includes('\n')));
  assert.equal(messages.map((message) => message.text).join(''), `${first}${second}`);
});

test('Kitahe PM protagonist replacement wins over the general NAME table across joined MSG lines', () => {
  const analysis = converter.inspectScripts({
    files: [{
      path: 'ADV_TEST.SCR',
      buffer: scr([
        'NAME 0, PLAYER, BAD',
        'MSG WIN_MSG, 主人公と',
        'MSG WIN_MSG, 【主人公】',
        'WAIT WIN_MSG',
        'END',
      ].join('\n')),
    }],
    entryScript: 'ADV_TEST.SCR',
    protagonistName: 'PLAYER',
  });
  const converted = converter.convertScripts(analysis, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  const message = converted.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'message');
  assert.equal(message.text, 'PLAYERとPLAYER');
});

test('Kitahe PM ignores legacy speaker mappings even for prototype-like COLOR tokens', () => {
  const analysis = analyze([
    'COLOR WIN_MSG, __proto__',
    'MSG WIN_MSG, text',
    'WAIT WIN_MSG',
    'END',
  ]);
  const mapping = JSON.parse('{"speakers":{"__proto__":{"mode":"narration"}},"assets":{}}');
  const converted = converter.convertScripts(analysis, { mapping, assetCatalog: [] });
  assert.equal(converted.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(converted.normalizedMapping.speakers, '__proto__'), false);
  const message = converted.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'message');
  assert.equal(message.speaker, '');
  assert.equal(message.textColor, '');
  assert.ok(converted.diagnostics.some((entry) => entry.code === 'unresolved-message-color'));
});

test('Kitahe PM CG analysis preserves CCG links, clears both link ends on reuse, and separates crop identities', () => {
  const analysis = analyze([
    'CGDIR DIR, \\BG',
    'LCG 0, A, 512, 480',
    'LCG 1, B, 128, 480',
    'LINKCG 0, 1',
    'CCG 0, 2',
    'ICG 2, 0, 0',
    'LCG 0, NEW, 640, 480',
    'ICG 1, 0, 0',
    'LCG 3, SAME, 512, 480',
    'ICG 3, 0, 0',
    'LCG 4, SAME, 320, 240',
    'ICG 4, 0, 0',
    'END',
  ]);
  const images = analysis.requirements.filter((entry) => entry.kind === 'image');
  const copied = images.find((entry) => entry.details.parts.length === 2);
  assert.deepEqual(copied.details.parts, ['BG/A.PVR', 'BG/B.PVR']);
  const reusedOther = images.find((entry) => entry.details.parts[0] === 'BG/B.PVR'
    && entry.details.parts.length === 1);
  assert.ok(reusedOther, 'LCG slot reuse must detach the stale relation from its peer');
  const sameSource = images.filter((entry) => entry.details.parts[0] === 'BG/SAME.PVR');
  assert.equal(sameSource.length, 2);
  assert.notEqual(sameSource[0].key, sameSource[1].key);
});

test('Kitahe PM CCG and CPCM clears prevent stale slot reuse', () => {
  const staleCg = analyze([
    'CGDIR DIR, \\BG',
    'LCG 2, OLD, 640, 480',
    'CCG 9, 2',
    'ICG 2, 0, 0',
    'END',
  ]);
  assert.ok(staleCg.diagnostics.some((entry) => entry.code === 'unresolved-cg-slot'));

  const stalePcm = analyze([
    'PCMDIR \\VOICE',
    'LPCM 1, V001',
    'CPCM',
    'PLAYP 1',
    'END',
  ]);
  assert.ok(stalePcm.diagnostics.some((entry) => entry.code === 'unresolved-p04-slot'));

  const selectivePcm = analyze([
    'PCMDIR \\SE',
    'LPCM 1, S001',
    'LPCM 2, S002',
    'CPCM 1',
    'PLAYP 2',
    'END',
  ]);
  assert.ok(!selectivePcm.diagnostics.some((entry) => entry.code === 'unresolved-p04-slot'));
  assert.equal(selectivePcm.requirements.length, 1);
  assert.equal(selectivePcm.requirements[0].source, 'SE/S002.P04');

  const invalidPcm = analyze([
    'PCMDIR \\VOICE',
    'LPCM SYMBOLIC_SLOT',
    'PLAYP SYMBOLIC_SLOT',
    'END',
  ]);
  assert.ok(invalidPcm.diagnostics.some((entry) => entry.code === 'invalid-lpcm-slot'));
  assert.ok(invalidPcm.diagnostics.some((entry) => entry.code === 'missing-lpcm-source'));
});

test('Kitahe PM image mappings emit speed 3 BG fade and derive Sprite position from ICG', () => {
  const analysis = analyze([
    'CGDIR DIR, \\BG',
    'LCG 0, A, 640, 480',
    'ICG 0, 320, 200',
    'END',
  ]);
  const key = analysis.requirements[0].key;
  const catalog = [{ id: 'bg', type: 'image' }, { id: 'hero', type: 'sprite' }, { id: 'voice', type: 'adpcm' }];

  const bg = converter.convertScripts(analysis, {
    mapping: { assets: { [key]: { action: 'map', assetId: 'bg', display: 'background', x: 2, y: 3 } } },
    assetCatalog: catalog,
  });
  assert.equal(bg.ok, true);
  const backgroundCommand = bg.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'background');
  assert.deepEqual(backgroundCommand, {
    type: 'background',
    assetId: 'bg',
    transition: 'fade',
    fadeOutFrames: 30,
    fadeInFrames: 30,
    x: 2,
    y: 3,
  });

  const sprite = converter.convertScripts(analysis, {
    mapping: {
      assets: {
        [key]: {
          action: 'map',
          assetId: 'hero',
          display: 'sprite',
          slot: 2,
          x: 319,
          y: 223,
        },
      },
    },
    assetCatalog: catalog,
  });
  assert.equal(sprite.ok, true);
  const spriteCommand = sprite.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'sprite');
  assert.equal(spriteCommand.slot, 2);
  assert.equal(spriteCommand.x, Math.round(320 * 224 / 640));
  assert.equal(spriteCommand.y, 17);

  const mismatch = converter.convertScripts(analysis, {
    mapping: { assets: { [key]: { action: 'map', assetId: 'voice', display: 'background' } } },
    assetCatalog: catalog,
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.diagnostics.some((entry) => entry.code === 'mapped-asset-type-mismatch'));

  const omitted = converter.convertScripts(analysis, {
    mapping: { assets: { [key]: { action: 'omit' } } },
    assetCatalog: catalog,
  });
  assert.equal(omitted.ok, true);
  assert.ok(omitted.diagnostics.some((entry) => entry.code === 'asset-explicitly-omitted'));

  const missingAnimation = converter.convertScripts(analysis, {
    mapping: {
      assets: {
        [key]: {
          action: 'map',
          assetId: 'animated',
          display: 'sprite',
          slot: 0,
          animationId: 'walk',
        },
      },
    },
    assetCatalog: [{
      id: 'animated',
      type: 'sprite',
      options: { animations: [{ id: 'default' }] },
    }],
  });
  assert.equal(missingAnimation.ok, false);
  assert.ok(missingAnimation.diagnostics.some((entry) => entry.code === 'missing-sprite-animation'));

  const invalidPosition = converter.convertScripts(analysis, {
    mapping: {
      assets: {
        [key]: { action: 'map', assetId: 'bg', display: 'background', x: 32, y: 'NaN' },
      },
    },
    assetCatalog: catalog,
  });
  assert.equal(invalidPosition.ok, false);
  assert.ok(invalidPosition.diagnostics.some((entry) => entry.code === 'invalid-image-position'));

  const convertSpriteAt = (sourceX) => {
    const positioned = analyze([
      'CGDIR DIR, \\BG',
      'LCG 0, A, 640, 480',
      `ICG 0, ${sourceX}, 999`,
      'END',
    ]);
    const positionedKey = positioned.requirements[0].key;
    return converter.convertScripts(positioned, {
      mapping: {
        assets: {
          [positionedKey]: {
            action: 'map',
            assetId: 'hero',
            display: 'sprite',
            slot: 1,
            x: 319,
            y: 223,
          },
        },
      },
      assetCatalog: catalog,
    });
  };

  const negative = convertSpriteAt(-100);
  assert.equal(negative.ok, true);
  const negativeSprite = negative.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'sprite');
  assert.equal(negativeSprite.x, 0);
  assert.equal(negativeSprite.y, 17);
  assert.ok(negative.diagnostics.some((entry) => (
    entry.severity === 'warning' && entry.code === 'sprite-x-clamped'
  )));

  const unresolved = convertSpriteAt('UNKNOWN_X');
  assert.equal(unresolved.ok, false);
  assert.ok(unresolved.diagnostics.some((entry) => (
    entry.severity === 'error' && entry.code === 'invalid-sprite-source-x'
  )));
});

test('Kitahe PM omits CG alpha FADE while preserving SCREEN effects', () => {
  const analysis = analyze([
    'DEFINE FLAG',
    'DEFINE T',
    'IF FLAG == 1 GOTO BRANCH',
    'T = 1',
    'GOTO MERGE',
    'LABEL BRANCH',
    'T = 2',
    'LABEL MERGE',
    'FADE 0, T, 0, 0, T',
    'SCREEN OFF',
    'END',
  ]);

  assert.ok(!analysis.diagnostics.some((entry) => entry.code === 'ambiguous-constant-state'));
  assert.ok(analysis.diagnostics.some((entry) => (
    entry.code === 'fade-omitted'
    && entry.severity === 'warning'
    && entry.line === 9
  )));
  assert.ok(!analysis.diagnostics.some((entry) => entry.code === 'fade-approximated'));

  const converted = converter.convertScripts(analysis, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  const effects = converted.scenes.flatMap((scene) => scene.commands)
    .filter((command) => command.type === 'effect');
  assert.deepEqual(effects, [{
    type: 'effect',
    effect: 'blank',
    frames: 0,
    intensity: 0,
    color: '#000000',
  }]);
});

test('Kitahe PM CFG handles local/external GOTO and gates unselected or unresolved targets', () => {
  const selectedExternal = analyze([
    'LABEL TOP',
    'GOTO TOP, B.SCR',
  ], [{
    path: 'B.SCR',
    lines: ['LABEL TOP', 'MSG WIN_MSG, 外部です。', 'WAIT WIN_MSG', 'END'],
  }]);
  assert.equal(selectedExternal.canApply, true);
  assert.ok(selectedExternal.reachability.reachableLocations.has('1:0'));

  const unselected = analyze(['GOTO TOP, MISSING.SCR']);
  assert.ok(unselected.diagnostics.some((entry) => entry.code === 'unselected-external-script' && entry.severity === 'warning'));
  assert.ok(!unselected.diagnostics.some((entry) => entry.severity === 'error'));

  const unresolved = analyze(['GOTO NO_SUCH_LABEL']);
  assert.ok(unresolved.diagnostics.some((entry) => entry.code === 'unresolved-label' && entry.severity === 'error'));

  const ambiguousExternal = analyze(['GOTO TARGET, X.SCR'], [
    { path: 'D1/X.SCR', lines: ['LABEL TARGET', 'END'] },
    { path: 'D2/X.SCR', lines: ['LABEL TARGET', 'END'] },
  ]);
  assert.ok(ambiguousExternal.diagnostics.some((entry) => (
    entry.code === 'ambiguous-external-script' && entry.severity === 'error'
  )));

  const qualifiedMissing = analyze(['GOTO TARGET, D2/X.SCR'], [
    { path: 'D1/X.SCR', lines: ['LABEL TARGET', 'END'] },
  ]);
  assert.ok(qualifiedMissing.diagnostics.some((entry) => entry.code === 'unselected-external-script'));
  assert.ok(!qualifiedMissing.reachability.reachableLocations.has('1:0'));

  const explicitTop = analyze([
    'MSG WIN_MSG, before',
    'GOTO TOP',
    'LABEL TOP',
    'END',
  ]);
  const gotoNode = Array.from(explicitTop.reachability.nodes.values())
    .find((node) => node.instruction.op === 'GOTO');
  assert.equal(explicitTop.reachability.nodes.get(gotoNode.edges[0].key).pc, 2);

  const missingTrueExternal = analyze([
    'DEFINE X',
    'IF X == 1 GOTO TARGET, OUT.SCR',
    'MSG WIN_MSG, false path',
    'WAIT WIN_MSG',
    'END',
  ]);
  const convertedIf = converter.convertScripts(missingTrueExternal, { mapping: {}, assetCatalog: [] });
  assert.equal(convertedIf.ok, true);
  const ifScene = convertedIf.scenes.find((scene) => (
    scene.commands.some((command) => command.type === 'if')
  ));
  const ifCommand = ifScene.commands.find((command) => command.type === 'if');
  assert.match(ifCommand.targetLabel, /_end$/);
  assert.match(ifCommand.elseLabel, /_false$/);
  const falseLabelIndex = ifScene.commands.findIndex((command) => (
    command.type === 'label' && command.name === ifCommand.elseLabel
  ));
  assert.equal(ifScene.commands[falseLabelIndex + 1].type, 'jump');

  const missingFalse = analyze([
    'DEFINE X',
    'GOTO CHECK',
    'LABEL YES',
    'END',
    'LABEL CHECK',
    'IF X == 1 GOTO YES',
  ]);
  const convertedMissingFalse = converter.convertScripts(missingFalse, { mapping: {}, assetCatalog: [] });
  assert.equal(convertedMissingFalse.ok, true);
  const missingFalseScene = convertedMissingFalse.scenes.find((scene) => (
    scene.commands.some((command) => command.type === 'if')
  ));
  const missingFalseCommand = missingFalseScene.commands.find((command) => command.type === 'if');
  assert.match(missingFalseCommand.targetLabel, /_true$/);
  assert.match(missingFalseCommand.elseLabel, /_end$/);
  assert.equal(
    missingFalseScene.commands[missingFalseScene.commands.length - 1].name,
    missingFalseCommand.elseLabel,
  );
});

test('Kitahe PM facts ignore physically intervening but unreachable CG and MSG instructions', () => {
  const imageAnalysis = analyze([
    'CGDIR DIR, \\BG',
    'LCG 0, A, 640, 480',
    'GOTO SHOW',
    'LCG 0, HIDDEN, 640, 480',
    'LABEL SHOW',
    'ICG 0, 0, 0',
    'END',
  ]);
  assert.equal(imageAnalysis.requirements.length, 1);
  assert.equal(imageAnalysis.requirements[0].source, 'BG/A.PVR');

  const messageAnalysis = analyze([
    'GOTO SHOW',
    'MSG WIN_MSG, hidden',
    'LABEL SHOW',
    'WAIT WIN_MSG',
    'END',
  ]);
  const converted = converter.convertScripts(messageAnalysis, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  assert.equal(converted.scenes.flatMap((scene) => scene.commands)
    .filter((command) => command.type === 'message').length, 0);

  const publicResult = converter.publicInspection(analyze([
    'MSG WIN_MSG, secret body',
    'WAIT WIN_MSG',
    'END',
  ]));
  assert.deepEqual(publicResult.reachableInstructions, [
    { script: 'A.SCR', line: 1, op: 'MSG' },
    { script: 'A.SCR', line: 2, op: 'WAIT' },
    { script: 'A.SCR', line: 3, op: 'END' },
  ]);
  assert.equal(JSON.stringify(publicResult.reachableInstructions).includes('secret body'), false);
});

test('Kitahe PM inspection rejects path-dependent CG or message state at CFG joins', () => {
  const ambiguousCg = analyze([
    'DEFINE FLAG',
    'IF FLAG == 0 GOTO LEFT',
    'LCG 0, RIGHT, 640, 480',
    'GOTO SHOW',
    'LABEL LEFT',
    'LCG 0, LEFT, 640, 480',
    'LABEL SHOW',
    'ICG 0, 0, 0',
    'END',
  ]);
  assert.ok(ambiguousCg.diagnostics.some((entry) => entry.code === 'ambiguous-cg-state'));

  const ambiguousMessage = analyze([
    'DEFINE FLAG',
    'IF FLAG == 0 GOTO LEFT',
    'MSG WIN_MSG, right',
    'GOTO SHOW',
    'LABEL LEFT',
    'MSG WIN_MSG, left',
    'LABEL SHOW',
    'WAIT WIN_MSG',
    'END',
  ]);
  assert.ok(ambiguousMessage.diagnostics.some((entry) => entry.code === 'ambiguous-message-state'));

  const orderedCalls = analyze([
    'DEFINE FLAG',
    'IF FLAG == 0 GOTO LEFT',
    'CALL SA',
    'CALL SB',
    'GOTO JOIN',
    'LABEL LEFT',
    'CALL SB',
    'CALL SA',
    'LABEL JOIN',
    'WAIT WIN_MSG',
    'END',
    'LABEL SA',
    'MSG WIN_MSG, A',
    'RETURN',
    'LABEL SB',
    'MSG WIN_MSG, B',
    'RETURN',
  ]);
  assert.ok(orderedCalls.diagnostics.some((entry) => entry.code === 'ambiguous-message-state'));

  const repeatedCall = analyze([
    'DEFINE FLAG',
    'IF FLAG == 0 GOTO LEFT',
    'CALL SA',
    'GOTO JOIN',
    'LABEL LEFT',
    'CALL SA',
    'CALL SA',
    'LABEL JOIN',
    'WAIT WIN_MSG',
    'END',
    'LABEL SA',
    'MSG WIN_MSG, A',
    'RETURN',
  ]);
  assert.ok(repeatedCall.diagnostics.some((entry) => entry.code === 'ambiguous-message-state'));

  const ambiguousCgDirectory = analyze([
    'DEFINE FLAG',
    'IF FLAG == 0 GOTO LEFT',
    'CGDIR D, \\RIGHT',
    'GOTO JOIN',
    'LABEL LEFT',
    'CGDIR D, \\LEFT',
    'LABEL JOIN',
    'LCG 0, IMAGE, 640, 480',
    'ICG 0, 0, 0',
    'END',
  ]);
  assert.ok(ambiguousCgDirectory.diagnostics.some((entry) => entry.code === 'ambiguous-cg-state'));

  const ambiguousPcmDirectory = analyze([
    'DEFINE FLAG',
    'IF FLAG == 0 GOTO LEFT',
    'PCMDIR \\RIGHT',
    'GOTO JOIN',
    'LABEL LEFT',
    'PCMDIR \\LEFT',
    'LABEL JOIN',
    'LPCM 0, V001',
    'PLAYP 0',
    'END',
  ]);
  assert.ok(ambiguousPcmDirectory.diagnostics.some((entry) => entry.code === 'ambiguous-p04-state'));

  const ambiguousTrack = analyze([
    'DEFINE X',
    'DEFINE T',
    'IF X == 1 GOTO BRANCH',
    'T = 1',
    'GOTO MERGE',
    'LABEL BRANCH',
    'T = 2',
    'LABEL MERGE',
    'PLAYM T',
    'END',
  ]);
  assert.ok(ambiguousTrack.diagnostics.some((entry) => entry.code === 'ambiguous-constant-state'));
});

test('Kitahe PM MENU emits Choice and CALL/RETURN expands without runtime call commands', () => {
  const menu = analyze([
    'MENU 0, 0xF000, 0xF999, 綺, 二, 三',
    'ONRMG 0, -1, -1, NULL, C1, C2, C3',
    'LABEL C1',
    'END',
    'LABEL C2',
    'END',
    'LABEL C3',
    'END',
  ]);
  const convertedMenu = converter.convertScripts(menu, { mapping: {}, assetCatalog: [] });
  assert.equal(convertedMenu.ok, true);
  const choice = convertedMenu.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'choice');
  assert.deepEqual(choice.choices.map((entry) => entry.label), ['□', '二', '三']);
  assert.ok(choice.choices.every((entry) => entry.targetSceneId));
  assert.ok(convertedMenu.diagnostics.some((entry) => (
    entry.severity === 'warning'
    && entry.code === 'font-character-replaced'
    && entry.script === 'A.SCR'
    && entry.line === 1
    && entry.field === 'choice[0]'
    && entry.codePoint === 'U+7DBA'
  )));

  const longLabel = '長'.repeat(25);
  const longMenu = analyze([
    `MENU 0, 0, 0, ${longLabel}`,
    'ONRMG 0, -1, -1, NULL, C1',
    'LABEL C1',
    'END',
  ]);
  const convertedLongMenu = converter.convertScripts(longMenu, { mapping: {}, assetCatalog: [] });
  assert.equal(convertedLongMenu.ok, true);
  assert.ok(convertedLongMenu.diagnostics.some((entry) => entry.code === 'choice-label-truncated'));
  const truncatedChoice = convertedLongMenu.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'choice');
  assert.equal(Array.from(truncatedChoice.choices[0].label).length, 24);

  const calls = analyze([
    'CALL SUB',
    'MSG WIN_MSG, 戻りました。',
    'WAIT WIN_MSG',
    'END',
    'LABEL SUB',
    'MSG WIN_MSG, 呼出中です。',
    'WAIT WIN_MSG',
    'RETURN',
  ]);
  const convertedCalls = converter.convertScripts(calls, { mapping: {}, assetCatalog: [] });
  assert.equal(convertedCalls.ok, true);
  assert.equal(convertedCalls.scenes.flatMap((scene) => scene.commands)
    .filter((command) => command.type === 'message').length, 2);

  const recursive = analyze(['CALL SUB', 'END', 'LABEL SUB', 'CALL SUB', 'RETURN']);
  assert.ok(recursive.diagnostics.some((entry) => entry.code === 'recursive-call' && entry.severity === 'error'));
});

test('Kitahe PM CFG facts carry CG and message state through CALL/RETURN expansion', () => {
  const cgCall = analyze([
    'CALL SUB',
    'ICG 0, 0, 0',
    'END',
    'LABEL SUB',
    'CGDIR D, \\BG',
    'LCG 0, A, 640, 480',
    'RETURN',
  ]);
  assert.ok(!cgCall.diagnostics.some((entry) => entry.severity === 'error'));
  assert.equal(cgCall.requirements.length, 1);
  assert.equal(cgCall.requirements[0].source, 'BG/A.PVR');

  const messageCall = analyze([
    'CALL SUB',
    'WAIT WIN_MSG',
    'END',
    'LABEL SUB',
    'HERO = 0xFAAA',
    'COLOR WIN_MSG, HERO',
    'MSG WIN_MSG, sub message',
    'RETURN',
  ]);
  assert.ok(messageCall.colorTokens.some((entry) => entry.token === 'HERO'));
  const converted = converter.convertScripts(messageCall, {
    mapping: { speakers: { HERO: { mode: 'speaker', name: '話者' } }, assets: {} },
    assetCatalog: [],
  });
  assert.equal(converted.ok, true);
  const message = converted.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'message');
  assert.equal(message.text, 'sub message');
  assert.equal(message.speaker, '');
  assert.equal(message.textColor, '#aaaaaa');

  const constantCall = analyze([
    'CALL SUB',
    'WAIT 0, 1, DURATION',
    'END',
    'LABEL SUB',
    'DURATION = 12',
    'RETURN',
  ]);
  const constantConverted = converter.convertScripts(constantCall, { mapping: {}, assetCatalog: [] });
  assert.equal(constantConverted.ok, true);
  assert.ok(constantConverted.scenes.some((scene) => (
    scene.commands.some((command) => command.type === 'wait' && command.frames === 12)
  )));
});

test('Kitahe PM rejects WAIT frame counts outside the PCE runtime range', () => {
  for (const frames of [-1, 65536]) {
    const analysis = analyze([
      `WAIT 0, 1, ${frames}`,
      'END',
    ]);
    assert.ok(
      analysis.diagnostics.some((entry) => entry.severity === 'error' && entry.code === 'wait-range'),
      `WAIT ${frames} must be rejected`,
    );
    const converted = converter.convertScripts(analysis, { mapping: {}, assetCatalog: [] });
    assert.equal(converted.ok, false);
  }

  const zero = analyze([
    'WAIT 0, 1, 0',
    'END',
  ]);
  const convertedZero = converter.convertScripts(zero, { mapping: {}, assetCatalog: [] });
  assert.equal(convertedZero.ok, true);
  assert.ok(!convertedZero.scenes.some((scene) => (
    scene.commands.some((command) => command.type === 'wait')
  )));
});

test('Kitahe PM WAITBTN requires a matching straight-line variable and photo timers choose timeout', () => {
  const recognized = analyze([
    'WAITBTN BTN',
    'ONG BTN, YES, NO',
    'LABEL YES',
    'END',
    'LABEL NO',
    'END',
  ]);
  assert.ok(!recognized.diagnostics.some((entry) => entry.severity === 'error'));
  const converted = converter.convertScripts(recognized, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  assert.ok(converted.scenes.some((scene) => scene.commands.some((command) => command.type === 'choice')));

  const unmatched = analyze([
    'WAITBTN OTHER',
    'ONG BTN, YES, NO',
    'LABEL YES',
    'END',
    'LABEL NO',
    'END',
  ]);
  assert.ok(unmatched.diagnostics.some((entry) => entry.code === 'unsupported-input-cycle' && entry.severity === 'error'));

  const emptyChoice = analyze(['WAITBTN BTN', 'ONG BTN, NULL, NULL', 'END']);
  assert.ok(emptyChoice.diagnostics.some((entry) => entry.code === 'unsupported-input-cycle'));

  const sparse = analyze([
    'WAITBTN BTN',
    'ONG BTN, L0, NULL, L2',
    'LABEL L0',
    'END',
    'LABEL L2',
    'END',
  ]);
  const sparseConverted = converter.convertScripts(sparse, { mapping: {}, assetCatalog: [] });
  assert.equal(sparseConverted.ok, true);
  const sparseChoice = sparseConverted.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'choice');
  assert.deepEqual(sparseChoice.choices.map((entry) => entry.value), [1, 3]);
  assert.ok(sparseChoice.choices.every((entry) => entry.targetSceneId));

  const dynamicSelector = analyze([
    'DEFINE BTN',
    'WAITBTN BTN',
    'ONG BTN, L1, L2',
    'LABEL L1',
    'PLAYM BTN',
    'END',
    'LABEL L2',
    'PLAYM BTN',
    'END',
  ]);
  assert.ok(!dynamicSelector.diagnostics.some((entry) => entry.severity === 'error'));
  assert.deepEqual(
    dynamicSelector.requirements.filter((entry) => entry.kind === 'midi')
      .map((entry) => entry.details.track)
      .sort((left, right) => left - right),
    [1, 2],
  );

  const photo = analyze([
    'ONTG 300, TIMEOUT',
    'LABEL WAIT_LOOP',
    'GOTO WAIT_LOOP',
    'LABEL TIMEOUT',
    'MSG WIN_MSG, 時間切れ',
    'WAIT WIN_MSG',
    'END',
  ]);
  assert.ok(photo.diagnostics.some((entry) => entry.code === 'timer-timeout-approximation'));
  assert.ok(photo.reachability.reachableLocations.has('0:3'));
  assert.ok(!photo.reachability.reachableLocations.has('0:1'));
});

test('Kitahe PM photo ONG button registration keeps the straight-line timeout continuation', () => {
  const photo = analyze([
    'ONG LBTN, SHOT',
    'KEY LBTN, ON',
    'ONTG 300, TIMEOUT',
    'LABEL WAIT_LOOP',
    'GOTO WAIT_LOOP',
    'LABEL SHOT',
    'MSG WIN_MSG, shot',
    'WAIT WIN_MSG',
    'END',
    'LABEL TIMEOUT',
    'MSG WIN_MSG, timeout',
    'WAIT WIN_MSG',
    'END',
  ]);
  assert.ok(!photo.diagnostics.some((entry) => entry.severity === 'error'));
  assert.ok(photo.reachability.reachableLocations.has('0:9'));
  assert.ok(!photo.reachability.reachableLocations.has('0:5'));
  const converted = converter.convertScripts(photo, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  const messageTexts = converted.scenes.flatMap((scene) => scene.commands)
    .filter((command) => command.type === 'message')
    .map((command) => command.text);
  assert.deepEqual(messageTexts, ['timeout']);
  const entryScene = converted.scenes.find((scene) => scene.id === converted.entrySceneId);
  assert.ok(entryScene.nextSceneId
    || entryScene.commands.some((command) => command.type === 'jump' && command.sceneId));

  const pairedPhoto = analyze([
    'ONG LBTN, PHOTO',
    'ONG RBTN, PHOTO',
    'KEY LBTN',
    'KEY RBTN',
    'MSG WIN_MSG, non photo',
    'WAIT WIN_MSG',
    'END',
    'LABEL PHOTO',
    'MSG WIN_MSG, photo',
    'WAIT WIN_MSG',
    'END',
  ]);
  assert.ok(!pairedPhoto.diagnostics.some((entry) => entry.severity === 'error'));
  assert.equal(pairedPhoto.diagnostics.filter((entry) => entry.code === 'photo-input-approximation').length, 2);

  const bareTimer = analyze([
    'ONTG',
    'MSG WIN_MSG, continues',
    'WAIT WIN_MSG',
    'END',
  ]);
  const bareConverted = converter.convertScripts(bareTimer, { mapping: {}, assetCatalog: [] });
  assert.equal(bareConverted.ok, true);
  assert.ok(bareTimer.diagnostics.some((entry) => entry.code === 'timer-reset-omitted'));
  assert.ok(bareConverted.scenes.some((scene) => (
    scene.commands.some((command) => command.type === 'message' && command.text === 'continues')
  )));
});

test('Kitahe PM rejects unsupported data/control producers and incomplete input cycles', () => {
  const unsupported = analyze([
    'DEFINE A',
    'A = B',
    'RANDOM A, 0, 10',
    'IF A == 0 THEN A = 1',
    'END',
  ]);
  assert.ok(unsupported.diagnostics.some((entry) => entry.code === 'unsupported-assignment'));
  assert.ok(unsupported.diagnostics.some((entry) => entry.code === 'unsupported-random'));

  const standaloneButton = analyze([
    'ONG ABTN, HANDLER',
    'END',
    'LABEL HANDLER',
    'END',
  ]);
  assert.ok(standaloneButton.diagnostics.some((entry) => entry.code === 'unsupported-input-cycle'));

  const incompleteWait = analyze(['WAITBTN BTN', 'MSG WIN_MSG, text', 'WAIT WIN_MSG', 'END']);
  assert.ok(incompleteWait.diagnostics.some((entry) => entry.code === 'unsupported-input-cycle'));
  const incompleteMenu = analyze(['MENU 0, 0, 0, one', 'END']);
  assert.ok(incompleteMenu.diagnostics.some((entry) => entry.code === 'incomplete-menu-cycle'));

  const invalidVariables = analyze([
    'WAITBTN',
    'ONG , L',
    'LABEL L',
    'END',
  ]);
  assert.ok(invalidVariables.diagnostics.filter((entry) => entry.code === 'invalid-variable-name').length >= 2);
  const invalidOnc = analyze(['ONC , L', 'LABEL L', 'END']);
  assert.ok(invalidOnc.diagnostics.some((entry) => entry.code === 'invalid-variable-name'));

  const invalidDefine = analyze(['DEFINE', 'END']);
  assert.ok(invalidDefine.diagnostics.some((entry) => entry.code === 'invalid-variable-name'));

  const outOfRangeAssignment = analyze([
    'DEFINE A',
    'A = 40000',
    'IF A > 0 GOTO DONE',
    'LABEL DONE',
    'END',
  ]);
  assert.ok(outOfRangeAssignment.diagnostics.some((entry) => entry.code === 'variable-value-range'));

  const outOfRangeArithmetic = analyze([
    'DEFINE A',
    'A = 32767',
    'A = A + 1',
    'IF A > 0 GOTO DONE',
    'LABEL DONE',
    'END',
  ]);
  assert.ok(outOfRangeArithmetic.diagnostics.some((entry) => entry.code === 'variable-value-range'));

  const outOfRangeCompare = analyze([
    'DEFINE A',
    'IF A > 35000 GOTO DONE',
    'LABEL DONE',
    'END',
  ]);
  const rejectedCompare = converter.convertScripts(outOfRangeCompare, { mapping: {}, assetCatalog: [] });
  assert.equal(rejectedCompare.ok, false);
  assert.ok(rejectedCompare.diagnostics.some((entry) => entry.code === 'variable-value-range'));

  const omittedInputProducer = analyze([
    'INKEY X',
    'IF X == 1 GOTO YES',
    'END',
    'LABEL YES',
    'END',
  ]);
  assert.ok(omittedInputProducer.diagnostics.some((entry) => entry.code === 'unsupported-input-producer'));
  assert.ok(omittedInputProducer.diagnostics.some((entry) => entry.code === 'undefined-runtime-variable'));

  const returnWithoutCall = analyze(['RETURN']);
  assert.ok(returnWithoutCall.diagnostics.some((entry) => (
    entry.code === 'return-without-call' && entry.severity === 'error'
  )));

  const metadataOmissions = analyze(['WINDOW WIN_MSG, ON', 'MIDIDIR \\MIDI', 'IMIDI PM', 'END']);
  assert.equal(metadataOmissions.diagnostics.filter((entry) => entry.code === 'command-omitted').length, 3);

  const auxiliaryWindows = analyze([
    'COLOR WIN_SUB, C',
    'MSG WIN_SUB, hidden',
    'CLEAR WIN_SUB',
    'CLEARW WIN_SUB',
    'END',
  ]);
  assert.equal(
    auxiliaryWindows.diagnostics.filter((entry) => entry.code === 'auxiliary-window-omitted').length,
    4,
  );
});

test('Kitahe PM rejects unresolved LCG slot, source, and crop metadata', () => {
  const invalid = analyze([
    'LCG UNKNOWN_SLOT, A, 640, 480',
    'LCG 0, , 640, 480',
    'LCG 1, B, WIDTH, HEIGHT',
    'END',
  ]);
  assert.ok(invalid.diagnostics.some((entry) => entry.code === 'invalid-lcg-slot'));
  assert.ok(invalid.diagnostics.some((entry) => entry.code === 'missing-lcg-source'));
  assert.ok(invalid.diagnostics.some((entry) => entry.code === 'invalid-lcg-crop'));
  assert.equal(invalid.canApply, false);
});

test('Kitahe PM ONC preserves original case indices and rejects positional NULL menus', () => {
  const analysis = analyze([
    'DEFINE V',
    'ONC V, L0, NULL, L2',
    'LABEL L0',
    'END',
    'LABEL L2',
    'END',
  ]);
  const converted = converter.convertScripts(analysis, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  const switchCommand = converted.scenes.flatMap((scene) => scene.commands)
    .find((command) => command.type === 'switch');
  assert.deepEqual(switchCommand.cases.map((entry) => entry.value), [0, 2]);
  assert.ok(switchCommand.defaultLabel);

  const nullMenu = analyze([
    'MENU 0, 0, 0, one, two, three',
    'ONRMG 0, -1, -1, NULL, L0, NULL, L2',
    'LABEL L0',
    'END',
    'LABEL L2',
    'END',
  ]);
  const rejected = converter.convertScripts(nullMenu, { mapping: {}, assetCatalog: [] });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.diagnostics.some((entry) => entry.code === 'invalid-menu-shape'));
});

test('Kitahe PM rejects normalized variable collisions and reserves scene ID suffixes', () => {
  const prefix = 'VARIABLE_NAME_ABCDEFGHIJKLMNOPQRS';
  const collision = analyze([
    `DEFINE ${prefix}_A`,
    `DEFINE ${prefix}_B`,
    `IF ${prefix}_A == 0 THEN ${prefix}_A = 1`,
    `IF ${prefix}_B == 0 THEN ${prefix}_B = 1`,
    'END',
  ]);
  assert.ok(collision.diagnostics.some((entry) => entry.code === 'variable-name-collision'));

  const longPrefix = 'LABEL_WITH_A_VERY_LONG_COMMON_PREFIX_'.repeat(3);
  const sceneAnalysis = analyze([
    `LABEL ${longPrefix}A`,
    'MSG WIN_MSG, first',
    'WAIT WIN_MSG',
    `LABEL ${longPrefix}B`,
    'MSG WIN_MSG, second',
    'WAIT WIN_MSG',
    'END',
  ]);
  const converted = converter.convertScripts(sceneAnalysis, { mapping: {}, assetCatalog: [] });
  assert.equal(converted.ok, true);
  assert.equal(new Set(converted.scenes.map((scene) => scene.id)).size, converted.scenes.length);
  assert.ok(converted.scenes.every((scene) => scene.id.length <= 72));
});

test('Kitahe PM audio conversion attaches straight-line voice and maps SFX, MIDI, and CD-DA only', () => {
  const analysis = analyze([
    'PCMDIR \\VOICE\\AY_ADP32',
    'LPCM 0, V001',
    'PLAYP 0',
    'MSG WIN_MSG, 音声台詞',
    'WAIT WIN_MSG',
    'PCMDIR \\SE',
    'LPCM 1, S001',
    'PLAYP 1, 22050, ON, 2',
    'PLAYM 11',
    'PLAYGD 9',
    'END',
  ]);
  const mapping = { speakers: {}, assets: {} };
  const catalog = [];
  analysis.requirements.forEach((requirement, index) => {
    const type = requirement.kind === 'p04' ? 'adpcm'
      : (requirement.kind === 'midi' ? 'psg-song' : 'cdda-track');
    const id = `asset_${index}`;
    mapping.assets[requirement.key] = { action: 'map', assetId: id };
    catalog.push({
      id,
      type,
      ...(requirement.kind === 'p04'
        ? { options: { loop: requirement.details?.loop === true } }
        : {}),
    });
  });
  const converted = converter.convertScripts(analysis, { mapping, assetCatalog: catalog });
  assert.equal(converted.ok, true);
  const commands = converted.scenes.flatMap((scene) => scene.commands);
  const message = commands.find((command) => command.type === 'message');
  assert.ok(message.voiceAssetId);
  assert.equal(commands.filter((command) => command.type === 'audio' && command.kind === 'adpcm').length, 1);
  assert.ok(commands.some((command) => command.type === 'audio' && command.kind === 'psg'));
  assert.ok(commands.some((command) => command.type === 'audio' && command.kind === 'cdda'));
  assert.ok(converted.sourceMap.every((entry) => Number.isInteger(entry.commandIndex)
    && entry.script && Number.isInteger(entry.line)));

  const midiOnly = analyze(['PLAYM 1', 'END']);
  const midiRequirement = midiOnly.requirements[0];
  const wrongPsgType = converter.convertScripts(midiOnly, {
    mapping: { assets: { [midiRequirement.key]: { action: 'map', assetId: 'sfx' } } },
    assetCatalog: [{ id: 'sfx', type: 'psg-sfx' }],
  });
  assert.equal(wrongPsgType.ok, false);
  assert.ok(wrongPsgType.diagnostics.some((entry) => entry.code === 'mapped-asset-type-mismatch'));

  const loopOnly = analyze([
    'PCMDIR \\SE',
    'LPCM 0, LOOP',
    'PLAYP 0, 22050, ON, 1',
    'END',
  ]);
  const loopRequirement = loopOnly.requirements[0];
  const approximatedLoop = converter.convertScripts(loopOnly, {
    mapping: { assets: { [loopRequirement.key]: { action: 'map', assetId: 'nonloop' } } },
    assetCatalog: [{ id: 'nonloop', type: 'adpcm', options: { loop: false } }],
  });
  assert.equal(approximatedLoop.ok, true);
  assert.ok(approximatedLoop.diagnostics.some((entry) => entry.code === 'p04-loop-approximation'));

  const nonLoopOnly = analyze([
    'PCMDIR \\SE',
    'LPCM 0, ONESHOT',
    'PLAYP 0',
    'END',
  ]);
  const nonLoopRequirement = nonLoopOnly.requirements[0];
  const dangerousLoop = converter.convertScripts(nonLoopOnly, {
    mapping: { assets: { [nonLoopRequirement.key]: { action: 'map', assetId: 'loop' } } },
    assetCatalog: [{ id: 'loop', type: 'adpcm', options: { loop: true } }],
  });
  assert.equal(dangerousLoop.ok, false);
  assert.ok(dangerousLoop.diagnostics.some((entry) => entry.code === 'mapped-adpcm-loop-mismatch'));

  const mixedLoopUse = analyze([
    'PCMDIR \\SE',
    'LPCM 0, SHARED',
    'PLAYP 0',
    'PLAYP 0, 22050, ON, 1',
    'END',
  ]);
  const sharedRequirements = mixedLoopUse.requirements.filter((entry) => entry.kind === 'p04');
  assert.equal(sharedRequirements.length, 2);
  assert.notEqual(sharedRequirements[0].key, sharedRequirements[1].key);
  assert.deepEqual(
    sharedRequirements.map((entry) => entry.details.loop).sort(),
    [false, true],
  );
});

test('Kitahe PM STOPP clears pending voice so a later message does not replay it', () => {
  const analysis = analyze([
    'PCMDIR \\VOICE',
    'LPCM 0, V001',
    'PLAYP 0',
    'STOPP 0',
    'MSG WIN_MSG, stopped',
    'WAIT WIN_MSG',
    'END',
  ]);
  const requirement = analysis.requirements[0];
  const converted = converter.convertScripts(analysis, {
    mapping: { speakers: {}, assets: { [requirement.key]: { action: 'map', assetId: 'voice' } } },
    assetCatalog: [{ id: 'voice', type: 'adpcm' }],
  });
  assert.equal(converted.ok, true);
  const commands = converted.scenes.flatMap((scene) => scene.commands);
  assert.ok(commands.some((command) => command.type === 'audio' && command.action === 'play'));
  assert.ok(commands.some((command) => command.type === 'audio' && command.action === 'stop'));
  assert.equal(commands.find((command) => command.type === 'message').voiceAssetId, '');
});

test('Kitahe PM apply confirms mapping omissions and leaves every output unchanged on inspector errors', () => {
  const sourceRoot = tempDir('pce-khpm-gate-source-');
  const projectDir = tempDir('pce-khpm-gate-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetDir = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'A.SCR'), scr([
    'CGDIR DIR, \\BG',
    'LCG 0, TEST, 640, 480',
    'ICG 0, 0, 0',
    'END',
  ].join('\n')));
  const initial = {
    version: 1,
    settings: {},
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [{ type: 'message', speaker: '', text: 'unchanged' }], nextSceneId: '' }],
  };
  const scenePath = path.join(assetDir, 'pce-vn-scenes.json');
  fs.writeFileSync(scenePath, JSON.stringify(initial));
  const context = {
    projectDir,
    assets: [{ id: 'bg', type: 'image' }],
    logger: { info() {}, error() {} },
  };
  const inspection = plugin.inspectKitahePmSource({
    sourceRoot,
    selectedScripts: ['A.SCR'],
    entryScript: 'A.SCR',
    targetMedia: 'cd',
    doc: initial,
    mapping: { speakers: {}, assets: {} },
  }, context);
  const requirementKey = inspection.assetRequirements[0].key;
  const omitMapping = { speakers: {}, assets: { [requirementKey]: { action: 'omit' } } };
  const omitInspection = plugin.inspectKitahePmSource({
    sourceRoot,
    selectedScripts: ['A.SCR'],
    entryScript: 'A.SCR',
    targetMedia: 'cd',
    doc: initial,
    mapping: omitMapping,
    mode: 'replace',
    previewConversion: true,
  }, context);
  const originalScene = fs.readFileSync(scenePath);

  const omission = plugin.applyKitahePmConversion({
    sourceRoot,
    selectedScripts: ['A.SCR'],
    entryScript: 'A.SCR',
    targetMedia: 'cd',
    doc: initial,
    signature: omitInspection.signature,
    mapping: omitMapping,
    mode: 'replace',
    confirmWarnings: false,
  }, context);
  assert.equal(omission.ok, false);
  assert.equal(omission.warningConfirmationRequired, true);
  assert.deepEqual(fs.readFileSync(scenePath), originalScene);
  assert.equal(fs.existsSync(path.join(assetDir, 'kitahe-pm-conversion.json')), false);

  const originalInspector = vnManager.inspectVnSceneDocumentBuild;
  vnManager.inspectVnSceneDocumentBuild = () => ({
    ok: false,
    diagnostics: [{ severity: 'error', code: 'scene_pack_limit', message: 'too large' }],
    sceneBudgets: [{ sceneId: 'x', packBytes: 9000 }],
    totals: {},
  });
  try {
    const mappedMapping = {
      speakers: {},
      assets: { [requirementKey]: { action: 'map', assetId: 'bg', display: 'background' } },
    };
    const mappedInspection = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      mapping: mappedMapping,
      mode: 'replace',
      previewConversion: true,
    }, context);
    const failed = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      signature: mappedInspection.signature,
      mapping: mappedMapping,
      mode: 'replace',
      confirmWarnings: true,
    }, context);
    assert.equal(failed.ok, false);
    assert.ok(failed.diagnostics.some((entry) => entry.code === 'scene_pack_limit'));
    assert.deepEqual(fs.readFileSync(scenePath), originalScene);
    assert.equal(fs.existsSync(path.join(assetDir, 'kitahe-pm-conversion-report.json')), false);
    assert.equal(fs.existsSync(path.join(assetDir, 'pce-vn-scenes.kitahe-backup.json')), false);

    vnManager.inspectVnSceneDocumentBuild = (_projectDir, options) => ({
      ok: true,
      document: vnManager.normalizeSceneDocument(options.doc, options.assetDoc),
      diagnostics: [{ severity: 'warning', code: 'synthetic-build-warning', message: 'confirm me' }],
      sceneBudgets: [{ sceneId: 'preview', packBytes: 1 }],
      totals: { scenePackBytes: 1 },
    });
    const warningPreview = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      mapping: mappedMapping,
      mode: 'replace',
      previewConversion: true,
    }, context);
    assert.ok(warningPreview.diagnostics.some((entry) => entry.code === 'synthetic-build-warning'));
    assert.deepEqual(warningPreview.sceneBudgets, [{ sceneId: 'preview', packBytes: 1 }]);
    const warningApply = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      signature: warningPreview.signature,
      mapping: mappedMapping,
      mode: 'replace',
      confirmWarnings: false,
    }, context);
    assert.equal(warningApply.ok, false);
    assert.equal(warningApply.warningConfirmationRequired, true);
    assert.ok(warningApply.diagnostics.some((entry) => entry.code === 'synthetic-build-warning'));
    assert.deepEqual(fs.readFileSync(scenePath), originalScene);
  } finally {
    vnManager.inspectVnSceneDocumentBuild = originalInspector;
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM append updates only the same import identity, preserves other imports, and rejects unowned collisions', () => {
  const sourceRoot = tempDir('pce-khpm-append-source-');
  const projectDir = tempDir('pce-khpm-append-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetDir = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'A.SCR'), scr('MSG WIN_MSG, Aです。\nWAIT WIN_MSG\nEND'));
  fs.writeFileSync(path.join(scriptDir, 'B.SCR'), scr('MSG WIN_MSG, Bです。\nWAIT WIN_MSG\nEND'));
  const initial = {
    version: 1,
    settings: {},
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [{ type: 'message', speaker: '', text: 'base' }], nextSceneId: '' }],
  };
  fs.writeFileSync(path.join(assetDir, 'pce-vn-scenes.json'), JSON.stringify(initial));
  const context = { projectDir, assets: [], logger: { info() {}, error() {} } };
  const originalInspector = vnManager.inspectVnSceneDocumentBuild;
  vnManager.inspectVnSceneDocumentBuild = (_projectDir, options) => ({
    ok: true,
    document: vnManager.normalizeSceneDocument(options.doc, options.assetDoc),
    diagnostics: [],
    sceneBudgets: [],
    totals: {},
  });

  const inspectAndAppend = (scriptName, doc) => {
    const inspection = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: [scriptName],
      entryScript: scriptName,
      targetMedia: 'cd',
      doc,
      mapping: { speakers: {}, assets: {} },
      mode: 'append',
      previewConversion: true,
    }, context);
    assert.equal(inspection.ok, true);
    const applied = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: [scriptName],
      entryScript: scriptName,
      targetMedia: 'cd',
      doc,
      signature: inspection.signature,
      mapping: { speakers: {}, assets: {} },
      mode: 'append',
      confirmWarnings: true,
    }, context);
    return applied;
  };

  try {
    const importedA = inspectAndAppend('A.SCR', initial);
    assert.equal(importedA.ok, true);
    const importedB = inspectAndAppend('B.SCR', importedA.doc);
    assert.equal(importedB.ok, true);
    assert.ok(importedB.doc.scenes.some((scene) => importedA.importedSceneIds.includes(scene.id)));
    assert.ok(importedB.doc.scenes.some((scene) => importedB.importedSceneIds.includes(scene.id)));

    const updatedB = inspectAndAppend('B.SCR', importedB.doc);
    assert.equal(updatedB.ok, true);
    assert.equal(updatedB.doc.scenes.length, importedB.doc.scenes.length);
    assert.ok(updatedB.doc.scenes.some((scene) => importedA.importedSceneIds.includes(scene.id)));

    const sidecarPath = path.join(assetDir, 'kitahe-pm-conversion.json');
    const poisonedSidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    const aIdentity = Object.keys(poisonedSidecar.imports)
      .find((key) => poisonedSidecar.imports[key].entry === 'A.SCR');
    poisonedSidecar.imports[aIdentity].absoluteSourcePath = 'C:\\private\\SCRIPT';
    poisonedSidecar.imports[aIdentity].scriptBody = 'secret body';
    poisonedSidecar.imports[aIdentity].speakerMappings.EXTRA = {
      mode: 'narration',
      sourceRoot: 'C:\\private',
    };
    fs.writeFileSync(sidecarPath, JSON.stringify(poisonedSidecar, null, 2));
    const sanitizedUpdate = inspectAndAppend('B.SCR', updatedB.doc);
    assert.equal(sanitizedUpdate.ok, true);
    const sanitizedText = fs.readFileSync(sidecarPath, 'utf-8');
    assert.equal(sanitizedText.includes('absoluteSourcePath'), false);
    assert.equal(sanitizedText.includes('scriptBody'), false);
    assert.equal(sanitizedText.includes('C:\\\\private'), false);

    const sidecar = JSON.parse(sanitizedText);
    const bIdentity = Object.keys(sidecar.imports).find((key) => sidecar.imports[key].entry === 'B.SCR');
    sidecar.imports[bIdentity].ownedSceneIds = [];
    sidecar.ownedSceneIds = [];
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
    const beforeCollision = fs.readFileSync(path.join(assetDir, 'pce-vn-scenes.json'));
    const collisionInspection = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['B.SCR'],
      entryScript: 'B.SCR',
      targetMedia: 'cd',
      doc: updatedB.doc,
      mapping: { speakers: {}, assets: {} },
      mode: 'append',
      previewConversion: true,
    }, context);
    const collision = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['B.SCR'],
      entryScript: 'B.SCR',
      targetMedia: 'cd',
      doc: updatedB.doc,
      signature: collisionInspection.signature,
      mapping: { speakers: {}, assets: {} },
      mode: 'append',
      confirmWarnings: true,
    }, context);
    assert.equal(collision.ok, false);
    assert.match(collision.error, /未所有scene ID/);
    assert.deepEqual(fs.readFileSync(path.join(assetDir, 'pce-vn-scenes.json')), beforeCollision);

    sidecar.imports[bIdentity].ownedSceneIds = ['opening'];
    sidecar.ownedSceneIds = ['opening'];
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
    const forgedOwnershipPreview = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['B.SCR'],
      entryScript: 'B.SCR',
      targetMedia: 'cd',
      doc: updatedB.doc,
      mapping: { speakers: {}, assets: {} },
      mode: 'append',
      previewConversion: true,
    }, context);
    assert.ok(forgedOwnershipPreview.diagnostics.some((entry) => entry.code === 'conversion-preview'));
    const forgedOwnership = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['B.SCR'],
      entryScript: 'B.SCR',
      targetMedia: 'cd',
      doc: updatedB.doc,
      signature: forgedOwnershipPreview.signature,
      mapping: { speakers: {}, assets: {} },
      mode: 'append',
      confirmWarnings: true,
    }, context);
    assert.equal(forgedOwnership.ok, false);
    assert.match(forgedOwnership.error, /所有範囲外/);
    assert.deepEqual(fs.readFileSync(path.join(assetDir, 'pce-vn-scenes.json')), beforeCollision);
  } finally {
    vnManager.inspectVnSceneDocumentBuild = originalInspector;
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM apply rejects stale signatures and atomically writes scene backup and reports', () => {
  const sourceRoot = tempDir('pce-khpm-source-');
  const projectDir = tempDir('pce-khpm-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'ADV_TEST.SCR'), scr([
    'LABEL TOP',
    'MSG WIN_MSG, テストです。',
    'WAIT WIN_MSG',
    'END',
  ].join('\n')));
  const initial = {
    version: 1,
    settings: {},
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [{ type: 'message', speaker: '', text: 'old' }], nextSceneId: '' }],
  };
  fs.writeFileSync(path.join(projectDir, 'assets', 'pce-vn-scenes.json'), JSON.stringify(initial));

  const context = { projectDir, assets: [], logger: { info() {}, error() {} } };
  const inspection = plugin.inspectKitahePmSource({
    sourceRoot,
    selectedScripts: ['ADV_TEST.SCR'],
    entryScript: 'ADV_TEST.SCR',
    targetMedia: 'cd',
    doc: initial,
    mapping: { speakers: {}, assets: {} },
    mode: 'replace',
    previewConversion: true,
  }, context);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.canApply, true);

  const originalInspector = vnManager.inspectVnSceneDocumentBuild;
  vnManager.inspectVnSceneDocumentBuild = (_projectDir, options) => ({
    ok: true,
    document: vnManager.normalizeSceneDocument(options.doc, options.assetDoc),
    diagnostics: [],
    sceneBudgets: [],
    totals: {},
  });
  try {
    const applied = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['ADV_TEST.SCR'],
      entryScript: 'ADV_TEST.SCR',
      targetMedia: 'cd',
      doc: initial,
      signature: inspection.signature,
      mapping: { speakers: {}, assets: {} },
      mode: 'replace',
      confirmWarnings: true,
    }, context);
    assert.equal(applied.ok, true);
    const backupPath = path.join(projectDir, 'assets', 'pce-vn-scenes.kitahe-backup.json');
    assert.ok(fs.existsSync(backupPath));
    assert.deepEqual(JSON.parse(fs.readFileSync(backupPath, 'utf-8')), initial);
    assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'kitahe-pm-conversion.json')));
    assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'kitahe-pm-conversion-report.json')));
    const persistedMetadata = [
      fs.readFileSync(path.join(projectDir, 'assets', 'kitahe-pm-conversion.json'), 'utf-8'),
      fs.readFileSync(path.join(projectDir, 'assets', 'kitahe-pm-conversion-report.json'), 'utf-8'),
    ].join('\n');
    assert.equal(persistedMetadata.includes(sourceRoot), false);
    assert.equal(persistedMetadata.includes('テストです。'), false);

    fs.appendFileSync(path.join(scriptDir, 'ADV_TEST.SCR'), scr('\n# changed'));
    const stale = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['ADV_TEST.SCR'],
      entryScript: 'ADV_TEST.SCR',
      targetMedia: 'cd',
      doc: initial,
      signature: inspection.signature,
      mapping: { speakers: {}, assets: {} },
      mode: 'replace',
      confirmWarnings: true,
    }, context);
    assert.equal(stale.ok, false);
    assert.equal(stale.stale, true);
  } finally {
    vnManager.inspectVnSceneDocumentBuild = originalInspector;
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM preview signature covers order-normalized selection, mode, mapping, assets, disk, and sidecar', () => {
  const sourceRoot = tempDir('pce-khpm-signature-source-');
  const projectDir = tempDir('pce-khpm-signature-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetDir = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'A.SCR'), scr('MSG WIN_MSG, A\nWAIT WIN_MSG\nEND'));
  fs.writeFileSync(path.join(scriptDir, 'B.SCR'), scr('END'));
  const initial = {
    version: 1,
    settings: { textSpeed: 2 },
    startScene: 'opening',
    scenes: [{ id: 'opening', customRawField: 'keep', commands: [], nextSceneId: '' }],
  };
  const scenePath = path.join(assetDir, 'pce-vn-scenes.json');
  fs.writeFileSync(scenePath, JSON.stringify(initial));
  const baseContext = {
    projectDir,
    assets: [{ id: 'unused', type: 'image', name: 'metadata-a' }],
    logger: { info() {}, error() {} },
  };
  const payload = {
    sourceRoot,
    selectedScripts: ['B.SCR', 'A.SCR'],
    entryScript: 'A.SCR',
    targetMedia: 'cd',
    doc: initial,
    mapping: { speakers: {}, assets: {} },
    mode: 'replace',
    setStartScene: false,
    previewConversion: true,
  };
  const originalInspector = vnManager.inspectVnSceneDocumentBuild;
  vnManager.inspectVnSceneDocumentBuild = (_projectDir, options) => ({
    ok: true,
    document: vnManager.normalizeSceneDocument(options.doc, options.assetDoc),
    diagnostics: [],
    sceneBudgets: [],
    totals: {},
  });
  try {
    const preview = plugin.inspectKitahePmSource(payload, baseContext);
    const reordered = plugin.inspectKitahePmSource({
      ...payload,
      selectedScripts: ['A.SCR', 'B.SCR'],
    }, baseContext);
    assert.equal(preview.signature, reordered.signature);

    const applyPayload = {
      ...payload,
      previewConversion: undefined,
      signature: preview.signature,
      confirmWarnings: true,
    };
    const changedMode = plugin.applyKitahePmConversion({ ...applyPayload, mode: 'append' }, baseContext);
    assert.equal(changedMode.stale, true);
    const changedMapping = plugin.applyKitahePmConversion({
      ...applyPayload,
      mapping: { speakers: { EXTRA: { mode: 'narration' } }, assets: {} },
    }, baseContext);
    assert.equal(changedMapping.stale, true);
    const changedAssetMetadata = plugin.applyKitahePmConversion(applyPayload, {
      ...baseContext,
      assets: [{ id: 'unused', type: 'image', name: 'metadata-b' }],
    });
    assert.equal(changedAssetMetadata.stale, true);

    fs.writeFileSync(scenePath, JSON.stringify({ ...initial, startScene: 'externally-edited' }));
    const changedDisk = plugin.applyKitahePmConversion(applyPayload, baseContext);
    assert.equal(changedDisk.stale, true);
    assert.equal(JSON.parse(fs.readFileSync(scenePath, 'utf-8')).startScene, 'externally-edited');
    fs.writeFileSync(scenePath, JSON.stringify(initial));

    const sidecarPath = path.join(assetDir, 'kitahe-pm-conversion.json');
    fs.writeFileSync(sidecarPath, JSON.stringify({ version: 1, imports: {} }));
    const changedSidecar = plugin.applyKitahePmConversion(applyPayload, baseContext);
    assert.equal(changedSidecar.stale, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(scenePath, 'utf-8')), initial);
  } finally {
    vnManager.inspectVnSceneDocumentBuild = originalInspector;
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM append namespaces retain the identity suffix for long entry names', () => {
  const sourceRoot = tempDir('pce-khpm-long-name-source-');
  const projectDir = tempDir('pce-khpm-long-name-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetDir = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  const names = [
    'THIS_IS_A_VERY_LONG_COMMON_ENTRY_PREFIX_ALPHA.SCR',
    'THIS_IS_A_VERY_LONG_COMMON_ENTRY_PREFIX_BETA.SCR',
  ];
  names.forEach((name, index) => {
    fs.writeFileSync(path.join(scriptDir, name), scr(`MSG WIN_MSG, ${index}\nWAIT WIN_MSG\nEND`));
  });
  const initial = {
    version: 1,
    settings: {},
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [], nextSceneId: '' }],
  };
  fs.writeFileSync(path.join(assetDir, 'pce-vn-scenes.json'), JSON.stringify(initial));
  const context = { projectDir, assets: [], logger: { info() {}, error() {} } };
  const originalInspector = vnManager.inspectVnSceneDocumentBuild;
  vnManager.inspectVnSceneDocumentBuild = (_projectDir, options) => ({
    ok: true,
    document: vnManager.normalizeSceneDocument(options.doc, options.assetDoc),
    diagnostics: [],
    sceneBudgets: [],
    totals: {},
  });
  try {
    let doc = initial;
    names.forEach((entryScript) => {
      const preview = plugin.inspectKitahePmSource({
        sourceRoot,
        selectedScripts: [entryScript],
        entryScript,
        targetMedia: 'cd',
        doc,
        mapping: { speakers: {}, assets: {} },
        mode: 'append',
        previewConversion: true,
      }, context);
      const applied = plugin.applyKitahePmConversion({
        sourceRoot,
        selectedScripts: [entryScript],
        entryScript,
        targetMedia: 'cd',
        doc,
        mapping: { speakers: {}, assets: {} },
        mode: 'append',
        signature: preview.signature,
        confirmWarnings: true,
      }, context);
      assert.equal(applied.ok, true);
      doc = applied.doc;
    });
    const sidecar = JSON.parse(fs.readFileSync(path.join(assetDir, 'kitahe-pm-conversion.json'), 'utf-8'));
    const entries = Object.entries(sidecar.imports);
    assert.equal(entries.length, 2);
    assert.notEqual(entries[0][1].namespace, entries[1][1].namespace);
    entries.forEach(([identity, record]) => {
      assert.ok(record.namespace.length <= 24);
      assert.ok(record.namespace.endsWith(`_${identity.slice(0, 8)}`));
      assert.ok(record.ownedSceneIds.every((sceneId) => sceneId.startsWith(`${record.namespace}_`)));
    });
  } finally {
    vnManager.inspectVnSceneDocumentBuild = originalInspector;
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM rejects project asset junctions that escape the project root', (t) => {
  const sourceRoot = tempDir('pce-khpm-junction-source-');
  const projectDir = tempDir('pce-khpm-junction-project-');
  const outsideDir = tempDir('pce-khpm-junction-outside-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetLink = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'A.SCR'), scr('END'));
  try {
    fs.symlinkSync(outsideDir, assetLink, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    t.skip(`directory symlink/junctionを作成できません: ${error.code || error.message}`);
    return;
  }
  try {
    const inspected = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      mapping: { speakers: {}, assets: {} },
      mode: 'replace',
      previewConversion: true,
    }, { projectDir, assets: [] });
    assert.equal(inspected.ok, false);
    assert.match(inspected.error, /symlink\/junction|project外/);
    assert.deepEqual(fs.readdirSync(outsideDir), []);
  } finally {
    fs.rmSync(assetLink, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('Kitahe PM replaces unsupported jp-v3 characters with placeholders and keeps the import applicable', () => {
  const sourceRoot = tempDir('pce-khpm-text-encoding-source-');
  const projectDir = tempDir('pce-khpm-text-encoding-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetDir = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'A.SCR'), scr([
    'DEFINE GCOLOR',
    'GCOLOR = 0xFAAA',
    'COLOR WIN_MSG, GCOLOR',
    'MSG WIN_MSG, 綺①A',
    'WAIT WIN_MSG',
    'END',
  ].join('\n')));
  const initial = {
    version: 2,
    settings: {},
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [], nextSceneId: '' }],
  };
  const mapping = {
    speakers: { GCOLOR: { mode: 'speaker', name: '😀' } },
    assets: {},
  };
  const scenePath = path.join(assetDir, 'pce-vn-scenes.json');
  fs.writeFileSync(scenePath, JSON.stringify(initial));
  const context = {
    projectDir,
    assets: [],
    logger: { info() {}, error() {} },
  };

  try {
    const preview = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      mapping,
      mode: 'replace',
      previewConversion: true,
    }, context);

    assert.equal(preview.ok, true);
    assert.equal(preview.canApply, true);
    const replacements = preview.diagnostics.filter((entry) => entry.code === 'font-character-replaced');
    assert.deepEqual(
      replacements.map((entry) => [
        entry.severity,
        entry.script,
        entry.line,
        entry.field,
        entry.characterIndex,
        entry.codePoint,
        entry.replacement,
      ]),
      [
        ['warning', 'A.SCR', 5, 'message', 0, 'U+7DBA', '□'],
        ['warning', 'A.SCR', 5, 'message', 1, 'U+2460', '□'],
      ],
    );
    assert.ok(!preview.diagnostics.some((entry) => entry.code === 'text_encoding'));
    assert.deepEqual(fs.readdirSync(assetDir), ['pce-vn-scenes.json']);

    const unconfirmed = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      signature: preview.signature,
      mapping,
      mode: 'replace',
      confirmWarnings: false,
    }, context);
    assert.equal(unconfirmed.ok, false);
    assert.equal(unconfirmed.warningConfirmationRequired, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(scenePath, 'utf8')), initial);

    const applied = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      signature: preview.signature,
      mapping,
      mode: 'replace',
      confirmWarnings: true,
    }, context);
    assert.equal(applied.ok, true);
    const message = applied.doc.scenes.flatMap((scene) => scene.commands)
      .find((command) => command.type === 'message');
    assert.equal(message.speaker, '');
    assert.equal(message.text, '□□A');
    assert.ok(!applied.diagnostics.some((entry) => entry.code === 'text_encoding'));

    const report = JSON.parse(fs.readFileSync(
      path.join(assetDir, 'kitahe-pm-conversion-report.json'),
      'utf8',
    ));
    assert.equal(report.summary.warningCount, 2);
    assert.equal(report.approximations.filter((entry) => entry.code === 'font-character-replaced').length, 2);
    const sidecar = JSON.parse(fs.readFileSync(
      path.join(assetDir, 'kitahe-pm-conversion.json'),
      'utf8',
    ));
    assert.deepEqual(sidecar.speakerMappings, {});
    assert.ok(Object.values(sidecar.imports).every((record) => (
      record && typeof record === 'object' && Object.keys(record.speakerMappings || {}).length === 0
    )));
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM restores only saved asset mappings for the matching SCR import identity', () => {
  const sourceRoot = tempDir('pce-khpm-mapping-identity-source-');
  const projectDir = tempDir('pce-khpm-mapping-identity-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetDir = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'A.SCR'), scr('MSG WIN_MSG, A\nWAIT WIN_MSG\nEND'));
  fs.writeFileSync(path.join(scriptDir, 'B.SCR'), scr('MSG WIN_MSG, B\nWAIT WIN_MSG\nEND'));

  const savedRecord = {
    selectedScripts: ['A.SCR'],
    entry: 'A.SCR',
    protagonistName: '',
    namespace: 'khpm_a',
    speakerMappings: { A_ONLY: { mode: 'speaker', name: '保存話者' } },
    assetMappings: { 'saved-asset-key': { action: 'omit' } },
    ownedSceneIds: ['khpm_a_entry'],
  };
  const identity = converter.sha256(converter.stableJson({
    selectedScripts: ['A.SCR'],
    entryScript: 'A.SCR',
  })).slice(0, 16);
  fs.writeFileSync(path.join(assetDir, 'kitahe-pm-conversion.json'), JSON.stringify({
    version: 1,
    imports: { [identity]: savedRecord },
    ...savedRecord,
  }, null, 2));
  const doc = {
    version: 2,
    settings: {},
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [], nextSceneId: '' }],
  };
  const context = { projectDir, assets: [], logger: { info() {}, error() {} } };

  try {
    const unrelated = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['B.SCR'],
      entryScript: 'B.SCR',
      targetMedia: 'cd',
      doc,
    }, context);
    assert.deepEqual(unrelated.mapping, { speakers: {}, assets: {} });

    const matching = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc,
    }, context);
    assert.deepEqual(matching.mapping.speakers, {});
    assert.deepEqual(matching.mapping.assets, savedRecord.assetMappings);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Kitahe PM apply rolls back every JSON file after a mid-transaction rename failure', () => {
  const sourceRoot = tempDir('pce-khpm-rollback-source-');
  const projectDir = tempDir('pce-khpm-rollback-project-');
  const scriptDir = path.join(sourceRoot, 'SCRIPT');
  const assetDir = path.join(projectDir, 'assets');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'A.SCR'), scr([
    'MSG WIN_MSG, ロールバック',
    'WAIT WIN_MSG',
    'END',
  ].join('\n')));

  const initial = {
    version: 2,
    settings: { textSpeed: 3 },
    startScene: 'opening',
    scenes: [{ id: 'opening', commands: [], nextSceneId: '' }],
  };
  const paths = [
    path.join(assetDir, 'pce-vn-scenes.kitahe-backup.json'),
    path.join(assetDir, 'kitahe-pm-conversion.json'),
    path.join(assetDir, 'kitahe-pm-conversion-report.json'),
    path.join(assetDir, 'pce-vn-scenes.json'),
  ];
  const sentinels = [
    Buffer.from('{"sentinel":"backup"}\n'),
    Buffer.from('{"version":1,"imports":{},"sentinel":"sidecar"}\n'),
    Buffer.from('{"sentinel":"report"}\n'),
    Buffer.from(`${JSON.stringify(initial)}\n`),
  ];
  paths.forEach((filePath, index) => fs.writeFileSync(filePath, sentinels[index]));

  const context = {
    projectDir,
    assets: [],
    logger: { info() {}, error() {} },
  };
  const originalInspector = vnManager.inspectVnSceneDocumentBuild;
  const originalRenameSync = fs.renameSync;
  vnManager.inspectVnSceneDocumentBuild = (_projectDir, options) => ({
    ok: true,
    document: vnManager.normalizeSceneDocument(options.doc, options.assetDoc),
    diagnostics: [],
    sceneBudgets: [],
    totals: {},
  });
  try {
    const preview = plugin.inspectKitahePmSource({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      mapping: { speakers: {}, assets: {} },
      mode: 'replace',
      previewConversion: true,
    }, context);
    assert.equal(preview.ok, true);
    assert.equal(preview.canApply, true);

    let transactionRenameCount = 0;
    fs.renameSync = (source, destination) => {
      if (String(source).endsWith('.tmp')) {
        transactionRenameCount += 1;
        if (transactionRenameCount === 3) {
          throw new Error('injected transaction rename failure');
        }
      }
      return originalRenameSync(source, destination);
    };

    const applied = plugin.applyKitahePmConversion({
      sourceRoot,
      selectedScripts: ['A.SCR'],
      entryScript: 'A.SCR',
      targetMedia: 'cd',
      doc: initial,
      signature: preview.signature,
      mapping: { speakers: {}, assets: {} },
      mode: 'replace',
      confirmWarnings: true,
    }, context);
    assert.equal(applied.ok, false);
    assert.match(applied.error, /injected transaction rename failure/);
    assert.equal(transactionRenameCount, 3);
    paths.forEach((filePath, index) => {
      assert.deepEqual(fs.readFileSync(filePath), sentinels[index]);
    });
    assert.deepEqual(
      fs.readdirSync(assetDir).filter((name) => /\.(?:tmp|restore)$/.test(name)),
      [],
    );
  } finally {
    fs.renameSync = originalRenameSync;
    vnManager.inspectVnSceneDocumentBuild = originalInspector;
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
