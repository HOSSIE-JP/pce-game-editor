const IMAGE_EXTS = ['.png', '.bmp', '.webp'];

function extname(filePath = '') {
  const match = String(filePath).toLowerCase().match(/(\.[^.\\/]+)$/);
  return match ? match[1] : '';
}

function dataUrlToPng(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('画像をPNGへ変換できませんでした'));
    image.src = dataUrl;
  });
}

function snapChannelToPce(value) {
  const n = Math.max(0, Math.min(255, Number(value) || 0));
  return Math.round(n / 36) * 36;
}

function countUniquePceColors(imageData) {
  const data = imageData?.data;
  if (!data) return 0;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    seen.add(`${snapChannelToPce(data[i])},${snapChannelToPce(data[i + 1])},${snapChannelToPce(data[i + 2])}`);
  }
  return seen.size;
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした'));
    image.src = dataUrl;
  });
}

async function imageDataFromDataUrl(dataUrl) {
  const image = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  return {
    image,
    imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
  };
}

async function convertImageToIndexed16(api, options = {}) {
  const sourcePath = String(options.sourcePath || '').trim();
  let sourceDataUrl = String(options.sourceDataUrl || '').trim();
  const sourceExt = extname(sourcePath);
  if (!IMAGE_EXTS.includes(sourceExt)) {
    return { canceled: true, warning: 'PNG / BMP / WebP を選択してください' };
  }
  if (!sourceDataUrl) {
    const read = await api.electronAPI.readFileAsDataUrl(sourcePath);
    if (!read?.ok || !read.dataUrl) {
      return { canceled: true, warning: read?.error || '画像を読み込めません' };
    }
    sourceDataUrl = read.dataUrl;
  }

  const resizeCapability = api.capabilities.get('image-resize');
  if (!resizeCapability?.openResizeModal) {
    return {
      canceled: true,
      warning: '画像リサイズコンバータープラグインが無効または未インストールです',
    };
  }

  const sourceImage = await loadImageFromDataUrl(sourceDataUrl);
  let workingDataUrl = sourceDataUrl;
  const notes = [];
  const resizeResult = await resizeCapability.openResizeModal(
    sourceDataUrl,
    sourceImage.naturalWidth || sourceImage.width,
    sourceImage.naturalHeight || sourceImage.height,
    { targetSize: options.targetSize || null },
  );
  if (!resizeResult?.ok) {
    return { canceled: true, warning: 'リサイズ/クリッピングをキャンセルしました' };
  }
  if (resizeResult.dataUrl && resizeResult.dataUrl !== sourceDataUrl) {
    workingDataUrl = resizeResult.dataUrl;
    notes.push('リサイズ/クリッピングを適用しました');
  }

  const { image, imageData } = await imageDataFromDataUrl(workingDataUrl);
  const quantizeCapability = api.capabilities.get('image-quantize');
  const countColors = quantizeCapability?.countUniqueColors || countUniquePceColors;
  const uniqueColors = countColors(imageData);
  if (uniqueColors > 16) {
    if (!quantizeCapability?.openQuantizeModal) {
      return {
        canceled: true,
        warning: '画像減色コンバータープラグインが無効または未インストールです',
      };
    }
    const quantized = await quantizeCapability.openQuantizeModal(workingDataUrl, { sourcePath });
    if (!quantized?.ok || !quantized.dataUrl) {
      return { canceled: true, warning: '減色変換をキャンセルしました' };
    }
    workingDataUrl = quantized.dataUrl;
    notes.push(`減色変換を適用しました (${uniqueColors} colors -> 16 colors)`);
  }

  const finalImage = await loadImageFromDataUrl(workingDataUrl);
  const shouldStorePng = workingDataUrl !== sourceDataUrl || sourceExt === '.bmp' || sourceExt === '.webp';
  const convertedDataUrl = shouldStorePng && !String(workingDataUrl).startsWith('data:image/png')
    ? await dataUrlToPng(workingDataUrl)
    : shouldStorePng ? workingDataUrl : '';
  return {
    canceled: false,
    convertedDataUrl,
    targetExtension: '.png',
    width: finalImage.naturalWidth || finalImage.width || image.naturalWidth || image.width || 0,
    height: finalImage.naturalHeight || finalImage.height || image.naturalHeight || image.height || 0,
    warning: notes.join(' / '),
  };
}

export function activatePlugin({ api, registerCapability }) {
  registerCapability('pce-image-converter', {
    id: 'pce-image-converter',
    label: 'PCE BG/Sprite Internal',
    priority: 30,
    canConvert(file = {}) {
      const ext = extname(file.ext || file.sourcePath || file.path || '');
      return IMAGE_EXTS.includes(ext);
    },
    async convert(file = {}) {
      const handler = api.capabilities.get('asset-import-handler');
      if (!handler?.handleImport) return null;
      return handler.handleImport(file);
    },
  });
  registerCapability('image-import-pipeline', {
    id: 'pce-image-converter',
    priority: 30,
    convertToIndexed16(options = {}) {
      return convertImageToIndexed16(api, options);
    },
  });
  return { deactivate() {} };
}
