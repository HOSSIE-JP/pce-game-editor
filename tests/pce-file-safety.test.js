'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  findExistingAncestor,
  isPathInside,
  normalizeRelativePath,
  resolveUnderRoot,
} = require('../pce-file-safety');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pce-file-safety-'));
  const projectDir = path.join(root, 'project');
  const outsideDir = path.join(root, 'outside');
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'main.c'), 'int main(void) { return 0; }\n');
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside\n');
  return { root, projectDir, outsideDir };
}

test('pce file safety recognizes resolved children and rejects resolved escapes', () => {
  const { projectDir, outsideDir } = makeTempProject();
  assert.equal(isPathInside(projectDir, path.join(projectDir, 'src', '..', 'src', 'main.c')), true);
  assert.equal(isPathInside(projectDir, path.join(outsideDir, 'secret.txt')), false);
});

test('pce file safety normalizes slash style without accepting absolute paths', () => {
  assert.equal(normalizeRelativePath('\\src\\main.c'), 'src/main.c');
  assert.equal(normalizeRelativePath('/src/main.c'), 'src/main.c');
});

test('pce file safety resolves existing and not-yet-created project paths', () => {
  const { projectDir } = makeTempProject();
  assert.equal(resolveUnderRoot(projectDir, 'src/main.c').absPath, path.join(projectDir, 'src', 'main.c'));
  assert.equal(resolveUnderRoot(projectDir, 'src/generated/new.c').absPath, path.join(projectDir, 'src', 'generated', 'new.c'));
  assert.equal(findExistingAncestor(path.join(projectDir, 'src', 'generated', 'new.c')), path.join(projectDir, 'src'));
});

test('pce file safety rejects relative traversal and absolute paths', () => {
  const { projectDir, outsideDir } = makeTempProject();
  assert.throws(() => resolveUnderRoot(projectDir, '../outside/secret.txt'), /project 配下のみアクセス可能です/);
  assert.throws(() => resolveUnderRoot(projectDir, path.join(outsideDir, 'secret.txt')), /project 配下のみアクセス可能です/);
});

test('pce file safety rejects symlink escapes for existing and missing targets', { skip: process.platform === 'win32' }, () => {
  const { projectDir, outsideDir } = makeTempProject();
  fs.symlinkSync(outsideDir, path.join(projectDir, 'linked-outside'), 'dir');

  assert.throws(
    () => resolveUnderRoot(projectDir, 'linked-outside/secret.txt'),
    /path escapes root/
  );
  assert.throws(
    () => resolveUnderRoot(projectDir, 'linked-outside/new-file.txt'),
    /path escapes root/
  );
});
