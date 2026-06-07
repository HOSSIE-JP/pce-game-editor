export function snapChannelTo3Bit(value) {
  const n = Math.max(0, Math.min(255, Number(value) || 0));
  return Math.round(n / 36) * 36;
}

export function snapColorToPce(color) {
  return {
    r: snapChannelTo3Bit(color?.r),
    g: snapChannelTo3Bit(color?.g),
    b: snapChannelTo3Bit(color?.b),
  };
}

export const snapColorToMegaDrive = snapColorToPce;

export function colorDistanceSq(a, b) {
  const dr = Number(a?.r || 0) - Number(b?.r || 0);
  const dg = Number(a?.g || 0) - Number(b?.g || 0);
  const db = Number(a?.b || 0) - Number(b?.b || 0);
  return dr * dr + dg * dg + db * db;
}

export function countUniqueColors(imageData) {
  const seen = new Set();
  const data = imageData?.data;
  if (!data) return 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const snapped = snapColorToPce({ r: data[i], g: data[i + 1], b: data[i + 2] });
    seen.add(`${snapped.r},${snapped.g},${snapped.b}`);
  }
  return seen.size;
}

export function nearestColorIndex(color, palette) {
  let best = 0;
  let bestDist = Infinity;
  palette.forEach((candidate, index) => {
    const dist = colorDistanceSq(color, candidate);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  });
  return best;
}

export function quantizeToIndexed16(imageData, options = {}) {
  const data = imageData?.data;
  const width = Number(imageData?.width || 0);
  const height = Number(imageData?.height || 0);
  if (!data || width <= 0 || height <= 0) {
    return { indices: new Uint8Array(), palette: [], transparentIndex: -1 };
  }

  const maxColors = Math.max(1, Math.min(16, Number(options.maxColors || 16)));
  const transparentIndex = options.reserveTransparent ? 0 : -1;
  const palette = transparentIndex === 0 ? [{ r: 0, g: 0, b: 0 }] : [];
  const counts = new Map();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const c = snapColorToPce({ r: data[i], g: data[i + 1], b: data[i + 2] });
    const key = `${c.r},${c.g},${c.b}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors - palette.length)
    .forEach(([key]) => {
      const [r, g, b] = key.split(',').map(Number);
      palette.push({ r, g, b });
    });

  if (palette.length === 0) {
    palette.push({ r: 0, g: 0, b: 0 });
  }

  const indices = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
    if (data[i + 3] < 128 && transparentIndex >= 0) {
      indices[p] = transparentIndex;
      continue;
    }
    const c = snapColorToPce({ r: data[i], g: data[i + 1], b: data[i + 2] });
    indices[p] = nearestColorIndex(c, palette);
  }

  return { indices, palette, transparentIndex };
}
