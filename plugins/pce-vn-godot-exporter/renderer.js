const CAPABILITY_NAME = 'vn-godot-exporter';

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

export function activatePlugin({ plugin, api, logger, registerCapability }) {
  const exportPackage = async ({ doc } = {}) => {
    const result = await api.plugins.invokeHook(plugin.id, 'exportVnGodotPackage', {
      doc: doc && typeof doc === 'object' ? doc : {},
    });
    if (!result?.ok && !result?.canceled) {
      throw new Error(result?.error || 'Godot再生パッケージを出力できませんでした');
    }
    return result || { ok: false, canceled: false, error: 'Godot出力結果がありません' };
  };

  const runNovelToolbarAction = async (editor = {}) => {
    try {
      if (typeof editor.getSnapshot !== 'function' || typeof editor.saveSnapshot !== 'function') {
        throw new Error('Novel editorのplugin action APIが不足しています');
      }
      const snapshot = await editor.getSnapshot();
      const result = await exportPackage({ doc: snapshot });
      if (result?.canceled) {
        logger?.info?.('Godot再生パッケージ出力をキャンセルしました。');
        return { ok: true, canceled: true };
      }
      try {
        await editor.saveSnapshot(snapshot);
      } catch (error) {
        throw new Error(`Godot再生パッケージは出力しましたが、シーンを保存できませんでした: ${error?.message || error}`);
      }
      const audioSummary = result.transcodedAudioAssetCount > 0
        ? ` / WAV→Ogg ${result.transcodedAudioAssetCount}`
          + ` (${formatBytes(result.audioSourceBytes)}→${formatBytes(result.audioPackageBytes)})`
        : '';
      const message = `Godot再生パッケージを出力しました: ${result.path} `
        + `(Scene ${result.sceneCount} / Command ${result.commandCount} / Asset ${result.assetCount}${audioSummary})`;
      logger?.info?.(message);
      return { ok: true, message };
    } catch (error) {
      logger?.error?.(`Godot出力失敗: ${error?.message || error}`);
      throw error;
    }
  };

  registerCapability(CAPABILITY_NAME, {
    pluginId: plugin.id,
    label: 'Godot出力',
    title: 'Godotネイティブ再生用packageへ出力（WAV音声はOgg Vorbis圧縮）',
    exportPackage,
  });
  registerCapability('novel-toolbar-action', {
    id: 'godot-export',
    pluginId: plugin.id,
    label: 'Godot出力',
    title: 'Godotネイティブ再生用packageへ出力（WAV音声はOgg Vorbis圧縮）',
    priority: 100,
    order: 20,
    placement: 'after-preview',
    run: runNovelToolbarAction,
  });
}
