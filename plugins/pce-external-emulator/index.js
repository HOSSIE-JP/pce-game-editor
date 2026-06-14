'use strict';

const DEFAULT_EXTERNAL_EMULATOR_PATH = process.platform === 'darwin'
  ? '/Applications/Geargrafx.app/Contents/MacOS/geargrafx'
  : '';

function splitCommandLineArgs(input) {
  const args = [];
  const text = String(input || '');
  let current = '';
  let quote = '';
  let escaping = false;

  for (const ch of text) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (escaping) current += '\\';
  if (current) args.push(current);
  return args;
}

function buildLaunchArgs(extraArgs, romPath) {
  const args = splitCommandLineArgs(extraArgs);
  let insertedRomPath = false;
  const placeholders = ['{rom}', '{romPath}', '{file}', '%ROM%'];
  const nextArgs = args.map((arg) => {
    let next = arg;
    placeholders.forEach((placeholder) => {
      if (next.includes(placeholder)) {
        insertedRomPath = true;
        next = next.split(placeholder).join(romPath);
      }
    });
    return next;
  });
  if (!insertedRomPath) nextArgs.push(romPath);
  return nextArgs;
}

async function onTestPlay(payload, context = {}) {
  if (!context.testPlay || typeof context.testPlay.launchExternalEmulator !== 'function') {
    return { ok: false, error: 'Test Play host API is unavailable' };
  }

  const romPath = String(payload?.romPath || '').trim();
  if (!romPath) {
    return { ok: false, error: 'ROM が未生成です。Build を成功させてから Test Play を実行してください。' };
  }

  const projectConfig = typeof context.testPlay.getProjectConfig === 'function'
    ? await context.testPlay.getProjectConfig()
    : {};
  const external = projectConfig?.testPlay?.externalEmulator || {};
  const executablePath = String(external.executablePath || external.path || DEFAULT_EXTERNAL_EMULATOR_PATH).trim();
  const args = buildLaunchArgs(external.extraArgs || '', romPath);

  const result = await context.testPlay.launchExternalEmulator({
    executablePath,
    args,
    romPath,
  });
  if (!result?.ok) {
    return { ok: false, handled: false, error: result?.error || '外部エミュレーター起動に失敗しました' };
  }
  return { ok: true, handled: true, result };
}

module.exports = {
  buildLaunchArgs,
  onTestPlay,
  splitCommandLineArgs,
};
