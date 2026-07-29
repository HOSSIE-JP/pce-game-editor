'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CD_PAYLOAD_MAX_BYTES,
  CD_PAYLOAD_PACK_FORMAT,
  CD_PAYLOAD_PACK_VERSION,
  CD_SECTOR_BYTES,
  readCdPayloadPackIndex,
  writeCdPayloadPack,
} = require('../pce-cd-payload-pack');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pce-cd-payload-pack-'));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeSource(dir, name, bytes) {
  const sourcePath = path.join(dir, 'sources', name);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, bytes);
  return sourcePath;
}

function outputPaths(dir, suffix = '') {
  return {
    packPath: path.join(dir, `output${suffix}`, 'vn_payload.bin'),
    indexPath: path.join(dir, `output${suffix}`, 'vn_payload-index.json'),
  };
}

test('payload pack preserves input order and aligns every file to a 2048-byte sector', () => {
  const dir = makeTempDir();
  const first = Buffer.from([0x11, 0x22, 0x33]);
  const second = Buffer.alloc(CD_SECTOR_BYTES + 1, 0x44);
  const third = Buffer.alloc(CD_SECTOR_BYTES, 0x55);
  const paths = outputPaths(dir);

  const index = writeCdPayloadPack({
    entries: [
      { logicalPath: 'z-last-name.bin', sourcePath: writeSource(dir, 'first.bin', first) },
      { logicalPath: 'a-first-name.bin', sourcePath: writeSource(dir, 'second.bin', second) },
      { logicalPath: 'nested\\third.bin', sourcePath: writeSource(dir, 'third.bin', third) },
    ],
    ...paths,
  });

  assert.equal(index.format, CD_PAYLOAD_PACK_FORMAT);
  assert.equal(index.version, CD_PAYLOAD_PACK_VERSION);
  assert.equal(index.sectorBytes, CD_SECTOR_BYTES);
  assert.deepEqual(index.entries, [
    {
      logicalPath: 'z-last-name.bin',
      sectorOffset: 0,
      byteSize: first.length,
      sectorCount: 1,
      hash: sha256(first),
    },
    {
      logicalPath: 'a-first-name.bin',
      sectorOffset: 1,
      byteSize: second.length,
      sectorCount: 2,
      hash: sha256(second),
    },
    {
      logicalPath: 'nested/third.bin',
      sectorOffset: 3,
      byteSize: third.length,
      sectorCount: 1,
      hash: sha256(third),
    },
  ]);
  assert.equal(index.byteSize, CD_SECTOR_BYTES * 4);
  assert.equal(index.sectorCount, 4);

  const pack = fs.readFileSync(paths.packPath);
  assert.equal(pack.length, CD_SECTOR_BYTES * 4);
  assert.deepEqual(pack.subarray(0, first.length), first);
  assert.equal(pack.subarray(first.length, CD_SECTOR_BYTES).every((byte) => byte === 0), true);
  assert.deepEqual(
    pack.subarray(CD_SECTOR_BYTES, CD_SECTOR_BYTES + second.length),
    second,
  );
  assert.equal(
    pack.subarray(CD_SECTOR_BYTES + second.length, CD_SECTOR_BYTES * 3)
      .every((byte) => byte === 0),
    true,
  );
  assert.deepEqual(pack.subarray(CD_SECTOR_BYTES * 3), third);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.indexPath, 'utf8')), index);
});

test('payload pack is deterministic and does not use whole-file read helpers', () => {
  const dir = makeTempDir();
  const entries = [
    {
      logicalPath: 'assets/voice.bin',
      sourcePath: writeSource(dir, 'voice.bin', Buffer.alloc(CD_PAYLOAD_MAX_BYTES, 0x81)),
    },
    {
      logicalPath: 'assets/bg.bin',
      sourcePath: writeSource(dir, 'bg.bin', Buffer.from('background')),
    },
  ];
  const firstPaths = outputPaths(dir, '-first');
  const secondPaths = outputPaths(dir, '-second');
  const originalReadFileSync = fs.readFileSync;
  const originalReadFile = fs.promises.readFile;
  try {
    fs.readFileSync = () => {
      throw new Error('whole-file synchronous read is forbidden');
    };
    fs.promises.readFile = async () => {
      throw new Error('whole-file asynchronous read is forbidden');
    };
    writeCdPayloadPack({ entries, ...firstPaths });
    writeCdPayloadPack({ entries, ...secondPaths });
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.promises.readFile = originalReadFile;
  }

  assert.deepEqual(
    originalReadFileSync(firstPaths.packPath),
    originalReadFileSync(secondPaths.packPath),
  );
  assert.deepEqual(
    originalReadFileSync(firstPaths.indexPath),
    originalReadFileSync(secondPaths.indexPath),
  );
});

test('payload pack rejects duplicate normalized logical paths', () => {
  const dir = makeTempDir();
  const source = writeSource(dir, 'same.bin', Buffer.from('same'));
  assert.throws(
    () => writeCdPayloadPack({
      entries: [
        { logicalPath: 'assets\\same.bin', sourcePath: source },
        { logicalPath: 'assets/same.bin', sourcePath: source },
      ],
      ...outputPaths(dir),
    }),
    /Duplicate CD payload logicalPath: assets\/same\.bin/,
  );
});

test('missing and oversized payload errors keep existing outputs unchanged', () => {
  const dir = makeTempDir();
  const paths = outputPaths(dir);
  fs.mkdirSync(path.dirname(paths.packPath), { recursive: true });
  fs.writeFileSync(paths.packPath, 'old-pack');
  fs.writeFileSync(paths.indexPath, 'old-index');

  assert.throws(
    () => writeCdPayloadPack({
      entries: [{
        logicalPath: 'assets/missing.bin',
        sourcePath: path.join(dir, 'missing.bin'),
      }],
      ...paths,
    }),
    /CD payload is missing: assets\/missing\.bin/,
  );
  assert.equal(fs.readFileSync(paths.packPath, 'utf8'), 'old-pack');
  assert.equal(fs.readFileSync(paths.indexPath, 'utf8'), 'old-index');

  const oversized = writeSource(
    dir,
    'oversized.bin',
    Buffer.alloc(CD_PAYLOAD_MAX_BYTES + 1),
  );
  assert.throws(
    () => writeCdPayloadPack({
      entries: [{ logicalPath: 'assets/oversized.bin', sourcePath: oversized }],
      ...paths,
    }),
    new RegExp(`exceeds ${CD_PAYLOAD_MAX_BYTES} bytes.*assets/oversized\\.bin`),
  );
  assert.equal(fs.readFileSync(paths.packPath, 'utf8'), 'old-pack');
  assert.equal(fs.readFileSync(paths.indexPath, 'utf8'), 'old-index');
  assert.deepEqual(
    fs.readdirSync(path.dirname(paths.packPath)).filter((name) => name.includes('.tmp-')),
    [],
  );
});

test('copy failure removes temporary files and leaves existing outputs intact', () => {
  const dir = makeTempDir();
  const paths = outputPaths(dir);
  fs.mkdirSync(path.dirname(paths.packPath), { recursive: true });
  fs.writeFileSync(paths.packPath, 'old-pack');
  fs.writeFileSync(paths.indexPath, 'old-index');
  const sourcePath = writeSource(
    dir,
    'interrupted.bin',
    Buffer.alloc((16 * 1024) + 1, 0x62),
  );

  const originalReadSync = fs.readSync;
  let reads = 0;
  try {
    fs.readSync = (...args) => {
      reads += 1;
      if (reads === 2) throw new Error('injected copy failure');
      return originalReadSync(...args);
    };
    assert.throws(
      () => writeCdPayloadPack({
        entries: [{ logicalPath: 'assets/interrupted.bin', sourcePath }],
        ...paths,
      }),
      /injected copy failure/,
    );
  } finally {
    fs.readSync = originalReadSync;
  }

  assert.equal(fs.readFileSync(paths.packPath, 'utf8'), 'old-pack');
  assert.equal(fs.readFileSync(paths.indexPath, 'utf8'), 'old-index');
  assert.deepEqual(
    fs.readdirSync(path.dirname(paths.packPath)).filter((name) => name.includes('.tmp-')),
    [],
  );
});

test('successful rebuild atomically replaces existing outputs without temp leftovers', () => {
  const dir = makeTempDir();
  const paths = outputPaths(dir);
  fs.mkdirSync(path.dirname(paths.packPath), { recursive: true });
  fs.writeFileSync(paths.packPath, 'old-pack');
  fs.writeFileSync(paths.indexPath, 'old-index');

  const payload = Buffer.from('new payload');
  const index = writeCdPayloadPack({
    entries: [{
      logicalPath: 'assets/new.bin',
      sourcePath: writeSource(dir, 'new.bin', payload),
    }],
    ...paths,
  });

  const pack = fs.readFileSync(paths.packPath);
  assert.deepEqual(pack.subarray(0, payload.length), payload);
  assert.equal(pack.length, CD_SECTOR_BYTES);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.indexPath, 'utf8')), index);
  assert.deepEqual(
    fs.readdirSync(path.dirname(paths.packPath)).filter((name) => name.includes('.tmp-')),
    [],
  );
});

test('empty logical payload still owns one sector and index reader validates the pack', () => {
  const dir = makeTempDir();
  const paths = outputPaths(dir);
  const index = writeCdPayloadPack({
    entries: [{
      logicalPath: 'assets/empty.bin',
      sourcePath: writeSource(dir, 'empty.bin', Buffer.alloc(0)),
    }],
    ...paths,
  });
  assert.equal(index.byteSize, CD_SECTOR_BYTES);
  assert.deepEqual(index.entries[0], {
    logicalPath: 'assets/empty.bin',
    sectorOffset: 0,
    byteSize: 0,
    sectorCount: 1,
    hash: sha256(Buffer.alloc(0)),
  });
  assert.deepEqual(readCdPayloadPackIndex(paths), index);
});

test('unchanged payload rebuild keeps existing outputs instead of replacing them', () => {
  const dir = makeTempDir();
  const paths = outputPaths(dir);
  const entries = [{
    logicalPath: 'assets/stable.bin',
    sourcePath: writeSource(dir, 'stable.bin', Buffer.from('stable')),
  }];
  writeCdPayloadPack({ entries, ...paths });

  const originalRenameSync = fs.renameSync;
  try {
    fs.renameSync = () => {
      throw new Error('unchanged outputs must not be replaced');
    };
    writeCdPayloadPack({ entries, ...paths });
  } finally {
    fs.renameSync = originalRenameSync;
  }
});

test('same-size pack corruption is repaired even when the existing index still matches', () => {
  const dir = makeTempDir();
  const paths = outputPaths(dir);
  const payload = Buffer.from('stable payload');
  const entries = [{
    logicalPath: 'assets/stable.bin',
    sourcePath: writeSource(dir, 'stable.bin', payload),
  }];
  writeCdPayloadPack({ entries, ...paths });

  const corrupt = fs.readFileSync(paths.packPath);
  corrupt[0] ^= 0xff;
  fs.writeFileSync(paths.packPath, corrupt);
  writeCdPayloadPack({ entries, ...paths });

  const repaired = fs.readFileSync(paths.packPath);
  assert.deepEqual(repaired.subarray(0, payload.length), payload);
  assert.equal(repaired.subarray(payload.length).every((byte) => byte === 0), true);
});

test('metadata payloads can explicitly raise the default 65535-byte entry guard', () => {
  const dir = makeTempDir();
  const paths = outputPaths(dir);
  const sourcePath = writeSource(dir, 'large-meta.bin', Buffer.alloc(CD_PAYLOAD_MAX_BYTES + 1, 0x5a));
  const index = writeCdPayloadPack({
    entries: [{
      logicalPath: 'assets/generated/meta/asset_meta.bin',
      sourcePath,
      maxBytes: Number.MAX_SAFE_INTEGER,
    }],
    ...paths,
  });
  assert.equal(index.entries[0].byteSize, CD_PAYLOAD_MAX_BYTES + 1);
  assert.equal(index.entries[0].sectorCount, 32);
  assert.deepEqual(readCdPayloadPackIndex(paths), index);
});
