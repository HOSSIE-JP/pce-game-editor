#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { generateGbStudioProject, inspectGbStudioExport } = require('../../pce-vn-gb-studio-exporter');

function usage() {
  return `PCE VN -> GB Studio 4.3.1/4.3.2 exporter\n\nUsage:\n  node tools/dev/pce-vn-gb-studio-export.js --project <dir> --out <dir> --gb-studio <exe> [options]\n\nOptions:\n  --font <builtin:misaki-gothic-8x8|font.bdf|font.ttf|font.otf|font.ttc>\n  --target <dual|gbc|gb>\n  --portrait-mode <baked|actor>\n  --mode <inspect|generate|verify>\n  --confirm-visual-omissions\n  --ack-warnings\n  --cdda-map <sourceCddaId=targetPsgSongId>  (repeatable)\n  --cdda-mod <sourceCddaId=file.mod>          (repeatable)\n  --audio-sub <assetId=omit|tone[:Hz[:seconds]]> (repeatable)\n  --json\n`;
}

function parsePair(value, label) { const index = String(value || '').indexOf('='); if (index < 1) throw new Error(`${label}はid=value形式です`); return [value.slice(0, index), value.slice(index + 1)]; }
function parseArgs(argv) {
  const options = { mode: 'generate', cddaMappings: {}, audioSubstitutions: {}, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]; const next = () => { if (index + 1 >= argv.length) throw new Error(`${arg}に値が必要です`); return argv[++index]; };
    if (arg === '--project') options.projectDir = next(); else if (arg === '--out') options.outputDir = next(); else if (arg === '--gb-studio') options.gbStudio = next(); else if (arg === '--font') options.font = next(); else if (arg === '--target') options.targetMode = next(); else if (arg === '--portrait-mode') options.portraitRenderMode = next(); else if (arg === '--mode') options.mode = next(); else if (arg === '--confirm-visual-omissions') options.visualOmissionsConfirmed = true; else if (arg === '--ack-warnings') options.warningsAcknowledged = true; else if (arg === '--json') options.json = true; else if (arg === '--cdda-map') { const [source, target] = parsePair(next(), '--cdda-map'); options.cddaMappings[source] = target; } else if (arg === '--cdda-mod') { const [source, file] = parsePair(next(), '--cdda-mod'); options.cddaMappings[source] = { type: 'external-mod', source: path.resolve(file) }; } else if (arg === '--audio-sub') { const [assetId, spec] = parsePair(next(), '--audio-sub'); const [type, frequency, duration] = spec.split(':'); options.audioSubstitutions[assetId] = type === 'omit' ? { type: 'omit' } : { type: 'tone', frequency: Number(frequency) || 440, duration: Number(duration) || 0.08 }; } else if (arg === '--help' || arg === '-h') options.help = true; else throw new Error(`不明なoptionです: ${arg}`);
  }
  if (!['inspect', 'generate', 'verify'].includes(options.mode)) throw new Error('--modeはinspect/generate/verifyです'); if (options.targetMode && !['dual', 'gbc', 'gb'].includes(options.targetMode)) throw new Error('--targetはdual/gbc/gbです'); if (options.portraitRenderMode && !['baked', 'actor'].includes(options.portraitRenderMode)) throw new Error('--portrait-modeはbaked/actorです'); return options;
}

function publicInspection(inspection) { return { ok: inspection.ok, format: inspection.format, version: inspection.version, project: inspection.project, gbStudio: inspection.gbStudio, sourceSignature: inspection.sourceSignature, summary: inspection.summary, requirements: inspection.requirements, omissions: inspection.omissions, errors: inspection.errors, warnings: inspection.warnings, audits: inspection.audits }; }
function printHuman(inspection) { const summary = inspection.summary || {}; process.stdout.write(`Preflight: ${inspection.ok ? 'OK' : 'BLOCKED'} / target ${summary.targetMode || 'dual'} / scene ${summary.sourceScenes || 0} -> ${summary.outputScenes || 0} / BG ${summary.backgroundVariants || 0} / font ${summary.fontPages || 0} page / BGM ${summary.musicTracks || 0}\n`); [...inspection.errors, ...inspection.warnings].forEach((entry) => process.stdout.write(`${entry.severity.toUpperCase()} ${entry.code} ${entry.location}: ${entry.message}\n`)); }

function main() {
  let options; try { options = parseArgs(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n\n${usage()}`); process.exitCode = 2; return; }
  if (options.help) { process.stdout.write(usage()); return; } if (!options.projectDir || !options.gbStudio || (options.mode !== 'inspect' && !options.outputDir)) { process.stderr.write(usage()); process.exitCode = 2; return; }
  const projectDir = path.resolve(options.projectDir); const settings = { cddaMappings: options.cddaMappings, audioSubstitutions: options.audioSubstitutions }; for (const key of ['font', 'targetMode', 'portraitRenderMode', 'visualOmissionsConfirmed', 'warningsAcknowledged']) if (options[key] !== undefined) settings[key] = options[key]; const inspection = inspectGbStudioExport({ projectDir, settings, gbStudio: options.gbStudio });
  if (options.json) process.stdout.write(`${JSON.stringify(publicInspection(inspection), null, 2)}\n`); else printHuman(inspection); if (!inspection.ok) { process.exitCode = 2; return; } if (options.mode === 'inspect') return;
  try { const result = generateGbStudioProject({ inspection, outputDir: path.resolve(options.outputDir), mode: options.mode }); if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); else process.stdout.write(`Generated: ${result.outputDir}\nProject: ${result.descriptorPath}\nValidation: ${result.validation.ok ? 'OK' : 'FAILED'}\n`); if (!result.ok) process.exitCode = 3; }
  catch (error) { process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message || error}\n`); process.exitCode = 3; }
}

if (require.main === module) main();
module.exports = { main, parseArgs, publicInspection };
