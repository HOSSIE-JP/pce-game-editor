'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');

const APP_DIRS = new Set(['renderer', 'node_modules', 'licenses', 'third_party', 'build']);
const RESOURCE_DIRS = new Set(['plugins', 'template', 'licenses', 'app.asar.unpacked']);
const ROOT_FILES = new Set(['package.json', 'build-meta.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
const RESOURCE_FILES = new Set(['app.asar', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
const PRIVATE_DIRS = /(^|\/)(?:\.git|\.codex|\.agents|\.env(?:\.[^/]*)?|data|projects|dev_pce|sdk|toolchains?|dist|out|tmp|__pycache__)(\/|$)/i;
const PRIVATE_MEDIA = /(?:^|\/)(?:syscard[^/]*|bios[^/]*|ipl)\.(?:pce|rom|bin)$|\.(?:pce|rom|iso|cue|chd|zip|7z)$/i;

function validateEntry(name, section) {
  const relative = name.replace(/\\/g, '/').replace(/^\/+/, '');
  assert.ok(relative && !relative.split('/').includes('..'), `Invalid distribution path: ${name}`);
  const top = relative.split('/')[0];
  const inDependency = (section === 'app' && top === 'node_modules')
    || (section === 'resources' && top === 'app.asar.unpacked');
  const allowed = section === 'app'
    ? APP_DIRS.has(top) || ROOT_FILES.has(relative) || /^[^/]+\.js$/.test(relative)
    : RESOURCE_DIRS.has(top) || RESOURCE_FILES.has(relative);
  assert.ok(allowed, `Unexpected ${section} distribution entry: ${relative}`);
  // Dependency packages can legitimately use directories called dist or data.
  // Our own resources must never carry development state or prebuilt game media.
  if (!inDependency) {
    assert.ok(!PRIVATE_DIRS.test(relative), `Private/build directory in distribution: ${relative}`);
    assert.ok(!PRIVATE_MEDIA.test(relative), `SDK/BIOS/game media in distribution: ${relative}`);
  }
  if (section === 'app' && top === 'build') {
    assert.ok(relative === 'build' || /^build\/icon\.(?:png|ico)$/.test(relative), `Unexpected build asset: ${relative}`);
  }
}

function walkFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.ok(!entry.isSymbolicLink(), `Symlink in distribution resources: ${relative}`);
    return entry.isDirectory()
      ? walkFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}

function verifyDistribution(appOutDir, resourcesDir = path.join(appOutDir, 'resources'), sourceDir = path.resolve(__dirname, '..')) {
  for (const name of ['portable', 'data', 'projects', 'dev_pce', '.git', '.codex', '.agents']) {
    assert.ok(!fs.existsSync(path.join(appOutDir, name)), `Forbidden distribution root entry: ${name}`);
  }
  const archive = path.join(resourcesDir, 'app.asar');
  const appEntries = asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''));
  appEntries.forEach((entry) => validateEntry(entry, 'app'));
  const resourceEntries = walkFiles(resourcesDir);
  resourceEntries.forEach((entry) => validateEntry(entry, 'resources'));

  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  const expectedPkg = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
  assert.equal(pkg.version, expectedPkg.version, 'Packaged application version is stale');
  for (const entry of ['main.js', 'renderer/index.html', 'renderer/log-viewer.html', 'renderer/setup.html', 'renderer/testplay-settings.html', 'build-meta.json', 'third_party/misaki-font/LICENSE.txt']) {
    assert.ok(appEntries.includes(entry), `Missing required app asset: ${entry}`);
  }
  const metadata = JSON.parse(asar.extractFile(archive, 'build-meta.json').toString());
  assert.match(metadata.buildNumber, /^\d{8}\.\d{6}$/);
  assert.ok(Number.isFinite(Date.parse(metadata.buildAt)), 'Invalid packaged build timestamp');

  const licenseFiles = ['LICENSE', 'THIRD_PARTY_NOTICES.md', ...walkFiles(path.join(sourceDir, 'licenses')).map((entry) => `licenses/${entry}`)];
  for (const entry of licenseFiles) {
    const expected = fs.readFileSync(path.join(sourceDir, entry));
    assert.deepEqual(fs.readFileSync(path.join(resourcesDir, entry)), expected, `Missing or altered external license: ${entry}`);
    // Root notices are copied to extraResources and opened there by main.js.
    // electron-builder omits those exact file copies from the ASAR archive.
    if (entry.startsWith('licenses/')) {
      assert.deepEqual(asar.extractFile(archive, entry), expected, `Missing or altered app license: ${entry}`);
    }
  }
  for (const entry of ['plugins/pc-engine-core/manifest.json', 'template/template_pce_vn_cd/project.json', 'template/template_pce_vn_hucard/project.json']) {
    assert.ok(resourceEntries.includes(entry), `Missing required resource: ${entry}`);
  }
  return { version: pkg.version, appEntries: appEntries.length, resourceFiles: resourceEntries.length, licenseFiles: licenseFiles.length };
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const result = verifyDistribution(context.appOutDir, context.packager.getResourcesDir(context.appOutDir));
  console.log(`Distribution verified: ${JSON.stringify(result)}`);
};
module.exports.verifyDistribution = verifyDistribution;
module.exports.validateEntry = validateEntry;

if (require.main === module) {
  const appOutDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked'));
  console.log(JSON.stringify(verifyDistribution(appOutDir), null, 2));
}
