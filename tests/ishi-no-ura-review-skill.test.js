'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const modulePath = path.resolve(__dirname,
  '../.agents/skills/review-ishi-no-ura-pce-vn-scripts/scripts/episode-review.mjs');
const reviewModule = import(pathToFileURL(modulePath).href);

function makeProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ishi-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const doc = {
    version: 2,
    startScene: 'ep03_start',
    scenes: [
      {
        id: 'ep03_start',
        name: 'レビューfixture',
        commands: [
          {
            type: 'message',
            speaker: 'チカ',
            text: 'お店で買いやすことです',
            mouthSlot: 1,
            voiceAssetId: 'voice_0001',
          },
          {
            type: 'choice',
            variableName: 'choice1',
            choices: [
              { label: 'そのまま', targetSceneId: 'ep03_end' },
              { label: '買いやすこと', targetSceneId: 'ep03_end' },
            ],
          },
          { type: 'jump', sceneId: 'ep03_end' },
        ],
      },
      {
        id: 'ep03_end',
        name: 'スチルfixture',
        commands: [
          {
            type: 'message',
            speaker: 'レン',
            text: '古い文や',
            mouthSlot: null,
            voiceAssetId: 'voice_0002',
          },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(assets, 'pce-vn-scenes.json'),
    JSON.stringify(doc, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(assets, 'pce-assets.json'), '{"assets":[]}\n', 'utf8');
  return root;
}

function makeChangeSet(project) {
  return {
    schemaVersion: 1,
    episodeId: 'ep03',
    source: {
      project: path.basename(project.projectDir),
      sceneFile: 'assets/pce-vn-scenes.json',
      sha256: project.sourceHash,
    },
    reviewer: 'test',
    reviewSummary: {
      episodeTitle: 'fixture',
      premise: 'fixture',
      strengths: [],
      structuralFindings: [],
      continuityFindings: [],
      coverage: {
        messagesRead: 2,
        messagesTotal: 2,
        scenesRead: 2,
        scenesTotal: 2,
        choicesChecked: 1,
        notes: '',
      },
    },
    changes: [
      {
        changeId: 'EP03-R001',
        locationId: 'EP03::ep03_start::C001',
        operation: 'replace',
        category: ['unnatural-japanese'],
        severity: 'high',
        decision: 'proposed',
        before: { speaker: 'チカ', text: 'お店で買いやすことです', mouthSlot: 1 },
        after: { speaker: 'チカ', text: 'お店で買いやすいことです', mouthSlot: 1 },
        context: '選択肢直前',
        reason: '脱字修正',
      },
      {
        changeId: 'EP03-R002',
        locationId: 'EP03::ep03_start::C002',
        operation: 'replace-choice-label',
        choiceNumber: 2,
        category: ['unnatural-japanese'],
        severity: 'high',
        decision: 'proposed',
        before: { label: '買いやすこと' },
        after: { label: '買いやすいこと' },
        context: '二番目の選択肢',
        reason: '脱字修正',
      },
      {
        changeId: 'EP03-R003',
        locationId: 'EP03::ep03_end::C001',
        operation: 'replace',
        category: ['unnatural-japanese'],
        severity: 'medium',
        decision: 'proposed',
        before: { speaker: 'レン', text: '古い文や', mouthSlot: null },
        after: { speaker: 'レン', text: '新しい文や', mouthSlot: null },
        context: 'スチル中の台詞',
        reason: '本文だけを修正',
      },
    ],
  };
}

test('review skill validates and renders message and choice-label diffs', async (t) => {
  const review = await reviewModule;
  const root = makeProject(t);
  const project = await review.loadProject(root);
  const set = makeChangeSet(project);

  assert.equal(review.deriveEpisodeId(project.doc), 'ep03');
  assert.equal(review.locationId('ep03', 'ep03_start', 1), 'EP03::ep03_start::C002');
  const validation = review.validateChangeSet(project, set);
  assert.deepEqual(validation, { errors: [], warnings: [] });

  const report = review.renderDiffReport(project, set, validation);
  assert.match(report, /\| 修正前 \| 修正後 \|/);
  assert.match(report, /選択肢ラベル/);
  assert.match(report, /お店で買いやすいことです/);
});

test('review skill rejects drift and safely applies approved changes', async (t) => {
  const review = await reviewModule;
  const root = makeProject(t);
  const project = await review.loadProject(root);
  const set = makeChangeSet(project);

  const drifted = structuredClone(set);
  drifted.source.sha256 = '0'.repeat(64);
  assert.match(review.validateChangeSet(project, drifted).errors.join('\n'),
    /source\.sha256 does not match/);

  set.changes.forEach((change) => { change.decision = 'approved'; });
  assert.throws(() => review.applyApprovedChanges(project, set, false),
    /stale voiceAssetId; use --clear-voices/);

  const output = review.applyApprovedChanges(project, set, true);
  assert.equal(output.scenes[0].commands[0].text, 'お店で買いやすいことです');
  assert.equal(output.scenes[0].commands[0].voiceAssetId, '');
  assert.equal(output.scenes[0].commands[1].choices[1].label, '買いやすいこと');
  assert.equal(output.scenes[1].commands[0].text, '新しい文や');
  assert.equal(output.scenes[1].commands[0].mouthSlot, null);
  assert.equal(output.scenes[1].commands[0].voiceAssetId, '');
});