#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUTTON_BITS = Object.freeze({
  a: 0x01, b: 0x02, select: 0x04, start: 0x08,
  right: 0x10, left: 0x20, up: 0x40, down: 0x80
});

function usage() {
  return `GB Studio ROM BGB headless smoke\n\nUsage:\n  node tools/dev/pce-vn-gb-studio-bgb-smoke.js --bgb <bgb.exe> --rom <game.gb> --out <folder> --mode <gbc|dmg> --frames <count> [--pulse frame:A+Down] [--pulse-every start:interval:end:A] [--breakpoint symbol/condition] [--summary]\n`;
}

function parseArgs(argv) {
  const options = { mode: 'gbc', frames: 600, pulses: [], pulseEvery: [], breakpoint: '', summary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { if (index + 1 >= argv.length) throw new Error(`${arg}に値が必要です`); return argv[++index]; };
    if (arg === '--bgb') options.bgb = next();
    else if (arg === '--rom') options.rom = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--mode') options.mode = next().toLowerCase();
    else if (arg === '--frames') options.frames = Number(next());
    else if (arg === '--pulse') options.pulses.push(next());
    else if (arg === '--pulse-every') options.pulseEvery.push(next());
    else if (arg === '--breakpoint') options.breakpoint = next();
    else if (arg === '--summary') options.summary = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`不明なoptionです: ${arg}`);
  }
  if (!['gbc', 'dmg'].includes(options.mode)) throw new Error('--modeはgbcまたはdmgです');
  if (!Number.isInteger(options.frames) || options.frames < 1 || options.frames > 360000) throw new Error('--framesは1～360000の整数です');
  return options;
}

function buttonByte(spec) {
  let value = 0;
  for (const name of String(spec || '').split('+').filter(Boolean)) {
    const bit = BUTTON_BITS[name.toLowerCase()];
    if (bit == null) throw new Error(`不明なbuttonです: ${name}`);
    value |= bit;
  }
  if (value === 0xff) throw new Error('0xffはBGB demoのhard reset予約値なので指定できません');
  return value;
}

function addPulse(demo, frameText, buttons, audit) {
  const frame = Number(frameText);
  if (!Number.isInteger(frame) || frame < 0 || frame >= demo.length) throw new Error(`pulse frameが範囲外です: ${frameText}`);
  demo[frame] |= buttonByte(buttons);
  if (demo[frame] === 0xff) throw new Error(`frame ${frame}がBGB demo hard reset予約値0xffになります`);
  audit.push({ frame, buttons });
}

function makeDemo(frames, pulses, pulseEvery) {
  const demo = Buffer.alloc(frames);
  const audit = [];
  for (const pulse of pulses) {
    const match = /^(\d+):(.+)$/.exec(pulse);
    if (!match) throw new Error(`--pulseはframe:buttons形式です: ${pulse}`);
    addPulse(demo, match[1], match[2], audit);
  }
  for (const spec of pulseEvery) {
    const match = /^(\d+):(\d+):(\d+):(.+)$/.exec(spec);
    if (!match || Number(match[2]) < 1) throw new Error(`--pulse-everyはstart:interval:end:buttons形式です: ${spec}`);
    for (let frame = Number(match[1]); frame <= Number(match[3]); frame += Number(match[2])) addPulse(demo, frame, match[4], audit);
  }
  audit.sort((a, b) => a.frame - b.frame || a.buttons.localeCompare(b.buttons));
  return { demo, audit };
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function clearRunOutputs(files) { for (const file of files) if (fs.existsSync(file)) { if (!fs.statSync(file).isFile()) throw new Error(`runtime出力pathがfileではありません: ${file}`); fs.unlinkSync(file); } }

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n\n${usage()}`); process.exitCode = 2; return; }
  if (options.help) { process.stdout.write(usage()); return; }
  if (!options.bgb || !options.rom || !options.out) { process.stderr.write(usage()); process.exitCode = 2; return; }
  const bgb = path.resolve(options.bgb); const rom = path.resolve(options.rom); const out = path.resolve(options.out);
  if (!fs.existsSync(bgb) || !fs.statSync(bgb).isFile()) throw new Error(`BGBがありません: ${bgb}`);
  if (!fs.existsSync(rom) || !fs.statSync(rom).isFile()) throw new Error(`ROMがありません: ${rom}`);
  fs.mkdirSync(out, { recursive: true });
  const { demo, audit } = makeDemo(options.frames, options.pulses, options.pulseEvery);
  const demoPath = path.join(out, `${options.mode}.dem`);
  const screenshotPath = path.join(out, `${options.mode}.png`);
  const statePath = path.join(out, `${options.mode}.sna`);
  const reportPath = path.join(out, `${options.mode}.runtime-smoke.json`);
  clearRunOutputs([screenshotPath, statePath, reportPath]);
  fs.writeFileSync(demoPath, demo);
  const systemMode = options.mode === 'dmg' ? 0 : 1;
  const args = ['-hf', '-rom', rom, '-demoplay', demoPath, '-demonoreset', '-screenonexit', screenshotPath, '-stateonexit', statePath, '-nobatt', '-set', `SystemMode=${systemMode}`, '-set', 'ScreenshotExt=png']; if (options.breakpoint) args.push('-br', options.breakpoint);
  const result = spawnSync(bgb, args, { cwd: path.dirname(bgb), windowsHide: true, timeout: 180000 });
  const failures = [];
  if (result.error) failures.push(String(result.error.message || result.error));
  if (result.status !== 0) failures.push(`BGB exit ${result.status}`);
  if (!fs.existsSync(screenshotPath)) failures.push('終了screenが保存されませんでした');
  if (!fs.existsSync(statePath)) failures.push('終了stateが保存されませんでした');
  const report = {
    format: 'pce-vn-gb-studio-bgb-runtime-smoke', version: 1, status: failures.length ? 'fail' : 'pass',
    mode: options.mode, systemMode, frames: options.frames, breakpoint: options.breakpoint || null, inputs: audit, rom: { path: rom, sha256: sha256(rom) },
    demo: { path: demoPath, bytes: demo.length, sha256: sha256(demoPath) },
    screenshot: fs.existsSync(screenshotPath) ? { path: screenshotPath, bytes: fs.statSync(screenshotPath).size, sha256: sha256(screenshotPath) } : null,
    state: fs.existsSync(statePath) ? { path: statePath, bytes: fs.statSync(statePath).size, sha256: sha256(statePath) } : null,
    process: { exitCode: result.status, signal: result.signal || null }, failures
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  process.stdout.write(options.summary ? `${report.status.toUpperCase()} ${report.mode} ${report.frames} ${reportPath}\n` : `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { BUTTON_BITS, buttonByte, clearRunOutputs, makeDemo, parseArgs };

