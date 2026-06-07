'use strict';

const fs = require('fs');
const path = require('path');

function isPathInside(parentPath, childPath) {
  const rel = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function findExistingAncestor(targetPath) {
  let current = path.resolve(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function normalizeRelativePath(relativePath = '') {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveUnderRoot(rootDir, relativePath = '', label = 'project') {
  const root = path.resolve(rootDir);
  const cleaned = normalizeRelativePath(relativePath);
  if (path.isAbsolute(String(relativePath || ''))) {
    throw new Error(`${label} 配下のみアクセス可能です: ${relativePath}`);
  }

  const absPath = path.resolve(root, cleaned);
  if (!isPathInside(root, absPath)) {
    throw new Error(`${label} 配下のみアクセス可能です: ${relativePath}`);
  }

  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const checkBase = fs.existsSync(absPath)
    ? absPath
    : findExistingAncestor(path.dirname(absPath));
  const realCheck = fs.existsSync(checkBase) ? fs.realpathSync(checkBase) : checkBase;
  if (!isPathInside(realRoot, realCheck)) {
    throw new Error(`${label} path escapes root: ${relativePath}`);
  }

  return { root, absPath, relativePath: cleaned };
}

module.exports = {
  findExistingAncestor,
  isPathInside,
  normalizeRelativePath,
  resolveUnderRoot,
};
