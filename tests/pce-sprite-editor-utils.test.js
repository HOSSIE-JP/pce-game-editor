'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('PCE sprite editor maps animation rows to PCE sprite cell metadata', async () => {
  const utils = await import('../plugins/pce-sprite-manager/sprite-editor-utils.mjs');
  const asset = {
    id: 'hero',
    type: 'sprite',
    options: {
      kind: 'sprite',
      width: 48,
      height: 32,
      cellWidth: 16,
      cellHeight: 16,
    },
  };

  const animations = utils.buildAnimationsFromEditorState({
    asset,
    frameWidth: 16,
    frameHeight: 16,
    time: '[[4,4,4][6,6]]',
    rowFrameCounts: [3, 2],
    rowDefaultTimes: ['4', '6'],
  });

  assert.deepEqual(animations.map((animation) => ({
    id: animation.id,
    firstCell: animation.firstCell,
    frameCount: animation.frameCount,
    frameDelay: animation.frameDelay,
    frameDelays: animation.frameDelays,
    frameStrideCells: animation.frameStrideCells,
  })), [
    { id: 'default', firstCell: 0, frameCount: 3, frameDelay: 4, frameDelays: [4, 4, 4], frameStrideCells: 1 },
    { id: 'row_1', firstCell: 3, frameCount: 2, frameDelay: 6, frameDelays: [6, 6], frameStrideCells: 1 },
  ]);
});

test('PCE sprite editor restores per-frame animation delays from assets', async () => {
  const utils = await import('../plugins/pce-sprite-manager/sprite-editor-utils.mjs');
  const state = utils.editorStateFromAsset({
    id: 'hero',
    type: 'sprite',
    options: {
      kind: 'sprite',
      width: 80,
      height: 32,
      cellWidth: 16,
      cellHeight: 16,
      animations: [
        { id: 'default', frameWidth: 16, frameHeight: 16, firstCell: 0, frameCount: 3, frameDelay: 8, frameDelays: [8, 3, 2], frameStrideCells: 1 },
        { id: 'row_1', frameWidth: 16, frameHeight: 16, firstCell: 5, frameCount: 5, frameDelay: 40, frameDelays: [40, 40, 40, 1, 1], frameStrideCells: 1 },
      ],
    },
  });

  assert.equal(state.time, '[[8,3,2][40,40,40,1,1]]');
  assert.deepEqual(state.rowFrameCounts, [3, 5]);
  assert.deepEqual(state.rowDefaultTimes, ['8', '40']);
});

test('PCE sprite editor preserves editor metadata shape from assets', async () => {
  const utils = await import('../plugins/pce-sprite-manager/sprite-editor-utils.mjs');
  const state = utils.editorStateFromAsset({
    id: 'hero',
    type: 'sprite',
    options: {
      kind: 'sprite',
      width: 64,
      height: 32,
      cellWidth: 16,
      cellHeight: 16,
      spriteEditor: {
        frameWidth: 32,
        frameHeight: 16,
        time: '[[5,5][7]]',
        rowFrameCounts: [2, 1],
        rowDefaultTimes: ['5', '7'],
        compression: 'FAST',
        collision: 'BOX',
        optType: 'SPRITE',
        optLevel: 'MEDIUM',
        optDuplicate: 'TRUE',
        comment: 'System sprites',
      },
    },
  });

  assert.equal(state.frameWidth, 32);
  assert.equal(state.frameHeight, 16);
  assert.deepEqual(state.rowFrameCounts, [2, 1]);
  assert.deepEqual(state.rowDefaultTimes, ['5', '7']);
  assert.equal(state.compression, 'AUTO');
  assert.equal(state.collision, 'BOX');
  assert.equal(state.optType, 'SPRITE');
  assert.equal(state.optLevel, 'MEDIUM');
  assert.equal(state.optDuplicate, 'TRUE');
  assert.equal(state.comment, 'System sprites');
});
