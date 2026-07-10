export const DEFAULT_EXTERNAL_EMULATOR_PATH = '/Applications/Geargrafx.app/Contents/MacOS/geargrafx';

export function normalizeExternalEmulatorSettings(projectConfig = {}, defaultPath = DEFAULT_EXTERNAL_EMULATOR_PATH) {
  const testPlay = projectConfig?.testPlay;
  const external = testPlay && typeof testPlay === 'object'
    && testPlay.externalEmulator && typeof testPlay.externalEmulator === 'object'
    ? testPlay.externalEmulator
    : {};
  return {
    executablePath: String(external.executablePath || defaultPath).trim(),
    extraArgs: String(external.extraArgs || '').trim(),
  };
}

export function buildTestPlaySettingsPatch(projectConfig = {}, externalEmulator = {}) {
  const current = projectConfig?.testPlay && typeof projectConfig.testPlay === 'object'
    ? projectConfig.testPlay
    : {};
  return {
    ...current,
    externalEmulator: {
      executablePath: String(externalEmulator.executablePath || '').trim(),
      extraArgs: String(externalEmulator.extraArgs || '').trim(),
    },
  };
}

export function buildPceProjectSettings(projectConfig = {}, input = {}) {
  const title = String(input.title || projectConfig.title || projectConfig.romName || 'pce_sample').trim();
  return {
    coreId: 'pc-engine',
    platform: 'pce',
    title,
    romName: projectConfig.romName || title,
    toolchain: 'llvm-mos',
    testPlay: buildTestPlaySettingsPatch(projectConfig, input.externalEmulator),
  };
}
