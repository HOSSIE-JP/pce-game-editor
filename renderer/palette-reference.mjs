const PALETTE_REFERENCE_TYPES = new Set(['image', 'sprite']);
const PALETTE_REFERENCE_EXTENSIONS = new Set(['.png', '.bmp']);

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function isAbsolutePath(value) {
  return /^(?:[a-zA-Z]:\/|\/)/.test(value);
}

function resolveSourcePath(sourcePath, projectDir) {
  const source = normalizePath(sourcePath);
  if (!source || isAbsolutePath(source)) return source;
  const root = normalizePath(projectDir).replace(/\/+$/, '');
  return root ? `${root}/${source.replace(/^\.\//, '')}` : source;
}

function comparisonKey(value) {
  const normalized = normalizePath(value);
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function extensionOf(sourcePath) {
  const normalized = normalizePath(sourcePath);
  const dot = normalized.lastIndexOf('.');
  return dot >= 0 ? normalized.slice(dot).toLowerCase() : '';
}

export function getPaletteReferenceCandidates(assets = [], options = {}) {
  const projectDir = String(options.projectDir || '');
  const exclude = comparisonKey(options.excludeSourcePath || '');
  const seen = new Set();
  const candidates = [];

  for (const asset of Array.isArray(assets) ? assets : []) {
    const type = String(asset?.type || '').trim().toLowerCase();
    const source = normalizePath(asset?.source || '');
    if (!PALETTE_REFERENCE_TYPES.has(type) || !source || asset?.exists === false) continue;
    if (!PALETTE_REFERENCE_EXTENSIONS.has(extensionOf(source))) continue;

    const resolvedSource = resolveSourcePath(source, projectDir);
    const key = comparisonKey(resolvedSource);
    if (!key || (exclude && (exclude === key || exclude === comparisonKey(source))) || seen.has(key)) continue;
    seen.add(key);

    const name = String(asset?.name || asset?.id || source).trim() || source;
    candidates.push({
      sourcePath: resolvedSource,
      label: `${name} (${source})`,
    });
  }

  return candidates.sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}
