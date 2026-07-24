'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_EXE = 'C:\\homebrew\\emulator\\Geargrafx\\Geargrafx.exe';

function parseArgs(argv) {
  const result = { exe: DEFAULT_EXE, cue: '', frames: 6000, exercise: false, inspectCommand: false, inspectCount: false, inspectSpriteMove: false, inspectCdda: false, inspectCddaStart: false, cddaCommandHit: 1, presses: 180, settle: 0, skipPsgCheck: false, skipForbiddenCheck: false, list: false, search: '', info: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') result.list = true;
    else if (arg === '--search') result.search = String(argv[++i] || '');
    else if (arg === '--info') result.info = String(argv[++i] || '');
    else if (arg === '--exe') result.exe = String(argv[++i] || '');
    else if (arg === '--cue') result.cue = String(argv[++i] || '');
    else if (arg === '--frames') result.frames = Math.max(1, Number(argv[++i]) || 6000);
    else if (arg === '--exercise') result.exercise = true;
    else if (arg === '--inspect-command') { result.exercise = true; result.inspectCommand = true; }
    else if (arg === '--inspect-count') { result.exercise = true; result.inspectCount = true; }
    else if (arg === '--inspect-sprite-move') result.inspectSpriteMove = true;
    else if (arg === '--inspect-cdda') result.inspectCdda = true;
    else if (arg === '--inspect-cdda-start') result.inspectCddaStart = true;
    else if (arg === '--cdda-command-hit') result.cddaCommandHit = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === '--presses') result.presses = Math.max(1, Number(argv[++i]) || 180);
    else if (arg === '--settle') result.settle = Math.max(0, Number(argv[++i]) || 0);
    else if (arg === '--skip-psg-check') result.skipPsgCheck = true;
    else if (arg === '--skip-forbidden-check') result.skipForbiddenCheck = true;
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentPayload(result) {
  const block = Array.isArray(result?.content)
    ? result.content.find((item) => item?.type === 'text' && typeof item.text === 'string')
    : null;
  if (!block) return result;
  try { return JSON.parse(block.text); } catch (_) { return block.text; }
}

function symbolCpuAddress(mapPath, symbol) {
  const source = fs.readFileSync(mapPath, 'utf8');
  const line = source.split(/\r?\n/).find((item) => new RegExp(`\\b${symbol}$`).test(item.trim()));
  if (!line) throw new Error(`Link-map symbol not found: ${symbol}`);
  const match = line.trim().match(/^([0-9a-fA-F]+)\s/);
  if (!match) throw new Error(`Cannot parse link-map symbol: ${line}`);
  return Number.parseInt(match[1], 16) & 0xffff;
}

function optionalSymbolCpuAddress(mapPath, symbol) {
  try { return symbolCpuAddress(mapPath, symbol); } catch (_) { return 0; }
}

function bytesFromPayload(payload) {
  if (Array.isArray(payload)) return payload.map((value) => Number(value) & 0xff);
  if (payload && typeof payload === 'object') {
    for (const key of ['bytes', 'data', 'values', 'hex']) {
      if (payload[key] != null) {
        const parsed = bytesFromPayload(payload[key]);
        if (parsed.length) return parsed;
      }
    }
  }
  const text = String(payload || '');
  const pairs = text.match(/(?:^|\s)([0-9a-fA-F]{2})(?=\s|$)/g) || [];
  return pairs.map((pair) => Number.parseInt(pair.trim(), 16));
}

function mprSnapshot(cpu) {
  const source = cpu?.mpr || cpu?.mprs || cpu?.MPR || cpu?.registers?.mpr || [];
  if (Array.isArray(source)) return source.slice(4, 7).map((item) => String(
    item && typeof item === 'object' ? (item.value ?? item.bank ?? item.mpr ?? '') : item,
  ));
  return [4, 5, 6].map((index) => String(source[index] ?? source[`mpr${index}`] ?? ''));
}

function vdcSnapshot(vdc) {
  const registers = vdc?.registers || vdc?.regs || vdc || {};
  const get = (index) => registers[index]
    ?? registers[String(index)]
    ?? registers[`R${index}`]
    ?? registers[`r${index}`]
    ?? registers[`0x${index.toString(16).padStart(2, '0')}`];
  return {
    r5: get(5),
    r7: get(7),
    r8: get(8),
    r9: get(9),
    r10: get(10),
    r11: get(11),
    r12: get(12),
    r13: get(13),
    r14: get(14),
    r15: get(15),
    r16: get(16),
    r17: get(17),
    r18: get(18),
    r19: get(19),
  };
}

function vdcRegisterValue(value) {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  return String(raw ?? '').replace(/^0x|^\$/i, '').toUpperCase().padStart(4, '0');
}

function vceSnapshot(vce) {
  return {
    blackWhite: Boolean(vce?.black_white),
    blur: Boolean(vce?.blur),
    control: String(vce?.control_reg ?? ''),
    lines: Number(vce?.lines ?? 0),
    speed: String(vce?.speed ?? ''),
  };
}

function digestBytes(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

function screenshotDigest(result) {
  const block = Array.isArray(result?.content)
    ? result.content.find((item) => item?.type === 'image' && typeof item.data === 'string')
    : null;
  if (!block) throw new Error(`Geargrafx screenshot returned no image: ${JSON.stringify(result)}`);
  return digestBytes(Buffer.from(block.data, 'base64'));
}

class McpClient {
  constructor(exe) {
    this.process = spawn(exe, ['--headless', '--mcp-stdio'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.nextId = 1;
    this.pending = new Map();
    readline.createInterface({ input: this.process.stdout }).on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch (_) { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    this.stderr = '';
    this.process.stderr.on('data', (chunk) => { this.stderr += String(chunk); });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Geargrafx MCP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async tool(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  async routed(name, args = {}) {
    return this.tool('execute_tool', { name, arguments: args });
  }

  close() {
    this.process.kill();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = new McpClient(options.exe);
  try {
    await client.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'pce-game-editor-system-card-smoke', version: '1' },
    });
    const listed = await client.request('tools/list');
    if (options.list) {
      process.stdout.write(`${JSON.stringify(listed, null, 2)}\n`);
      return;
    }
    if (options.search) {
      const found = await client.tool('search_tools', { query: options.search });
      process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
      return;
    }
    if (options.info) {
      const info = await client.tool('get_tool_info', { name: options.info });
      process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
      return;
    }
    if (!options.cue) throw new Error('--cue is required unless --list is used');
    const cuePath = path.resolve(options.cue);
    const mapPath = cuePath.replace(/\.cue$/i, '.map');
    const epochAddress = symbolCpuAddress(mapPath, 'vn_frame_epoch');
    const currentSceneAddress = optionalSymbolCpuAddress(mapPath, 'current_scene');
    const currentCommandAddress = optionalSymbolCpuAddress(mapPath, 'current_command');
    const messageCompleteAddress = optionalSymbolCpuAddress(mapPath, 'message_complete');
    const asyncStatusAddress = optionalSymbolCpuAddress(mapPath, 'vn_cd_async_status');
    const asyncStoreRemainingAddress = optionalSymbolCpuAddress(mapPath, 'vn_cd_async_store_remaining');
    const asyncWireRemainingAddress = optionalSymbolCpuAddress(mapPath, 'vn_cd_async_wire_remaining');
    const asyncDestKindAddress = optionalSymbolCpuAddress(mapPath, 'vn_cd_async_dest_kind');
    const cdBusStateAddress = optionalSymbolCpuAddress(mapPath, 'vn_cd_bus_state');
    const commandReaderAddress = optionalSymbolCpuAddress(mapPath, 'scene_pack_read_command_impl');
    const commandCountAddress = optionalSymbolCpuAddress(mapPath, 'scene_pack_command_count');
    const spriteMoveStartAddress = optionalSymbolCpuAddress(mapPath, 'start_sprite_move');
    const spriteMovesAddress = optionalSymbolCpuAddress(mapPath, 'sprite_moves');
    const spriteSlotsAddress = optionalSymbolCpuAddress(mapPath, 'sprite_slots_storage');
    const spriteSatbStartsAddress = optionalSymbolCpuAddress(mapPath, 'sprite_satb_slot_start');
    const spriteSatbCountsAddress = optionalSymbolCpuAddress(mapPath, 'sprite_satb_slot_count');
    const spritetextSlotsAddress = optionalSymbolCpuAddress(mapPath, 'spritetext_slots');
    const syncSpriteMoveAddress = optionalSymbolCpuAddress(mapPath, 'sync_sprite_move_slot');
    const cddaStateAddress = optionalSymbolCpuAddress(mapPath, 'cdda_state');
    const cddaCommandImplAddress = optionalSymbolCpuAddress(mapPath, 'cdda_command_impl');
    const cddaAudioCommandAddress = optionalSymbolCpuAddress(mapPath, 'cdda_audio_command');
    const cddaCommandAddress = cddaCommandImplAddress || cddaAudioCommandAddress;
    const cddaCommandBank = cddaCommandImplAddress ? 133 : 129;
    const cddaSyncAddress = optionalSymbolCpuAddress(mapPath, 'sync_cd_external_irq_after_bios_call');
    const cdTransferScratchAddress = optionalSymbolCpuAddress(mapPath, 'cd_transfer_scratch');
    const spriteMoveBreakpoint = {
      address: (((130 - 128) * 0x2000) + (spriteMoveStartAddress & 0x1fff)).toString(16),
      memory_area: 'cd_ram',
      execute: true,
    };
    const cddaCommandBreakpoint = {
      address: (((cddaCommandBank - 128) * 0x2000) + (cddaCommandAddress & 0x1fff)).toString(16),
      memory_area: 'cd_ram',
      execute: true,
    };
    const cddaSyncBreakpoint = {
      address: (((129 - 128) * 0x2000) + (cddaSyncAddress & 0x1fff)).toString(16),
      memory_area: 'cd_ram',
      execute: true,
    };
    const loadResult = contentPayload(await client.tool('load_media', { file_path: cuePath }));
    if (options.inspectSpriteMove) {
      if (!spriteMoveStartAddress || !spriteMovesAddress || !spriteSlotsAddress
          || !spriteSatbStartsAddress || !syncSpriteMoveAddress) {
        throw new Error('Sprite-move inspection symbols are missing');
      }
      await client.tool('set_breakpoint', spriteMoveBreakpoint);
    }
    if (options.inspectCddaStart) {
      if (!cddaCommandAddress || !cddaSyncAddress || !cddaStateAddress) {
        throw new Error('CD-DA command/BIOS-sync/state inspection symbols are missing');
      }
      await client.tool('set_breakpoint', cddaCommandBreakpoint);
    }
    await client.tool('debug_continue');
    await sleep(1200);
    await client.tool('controller_button', { player: 1, button: 'run', action: 'press_and_release' });
    if (options.inspectSpriteMove || options.inspectCddaStart) {
      const bootDeadline = Date.now() + (options.inspectCddaStart ? 30000 : 15000);
      let bootStatus = {};
      while (Date.now() < bootDeadline) {
        bootStatus = contentPayload(await client.routed('debug_get_status'));
        if (bootStatus?.paused) break;
        await sleep(100);
      }
      if (!bootStatus?.paused) await client.tool('debug_pause');
    } else {
      await sleep(5000);
      await client.tool('debug_pause');
    }

    const media = contentPayload(await client.tool('get_media_info'));
    const bootCpu = contentPayload(await client.tool('get_huc6280_status'));
    const areas = contentPayload(await client.routed('list_memory_areas'));
    const areaList = Array.isArray(areas) ? areas : (areas?.areas || areas?.memory_areas || []);
    const wram = areaList.find((area) => /wram|work ram/i.test(String(area?.name || area?.title || area?.label || '')));
    if (!wram) throw new Error(`Geargrafx WRAM area not found: ${JSON.stringify(areas)}`);
    const vram = areaList.find((area) => /vram|video ram/i.test(String(area?.name || area?.title || area?.label || '')));
    if (!vram) throw new Error(`Geargrafx VRAM area not found: ${JSON.stringify(areas)}`);
    const cardRam = areaList.find((area) => /card ram/i.test(String(area?.name || area?.title || area?.label || '')));
    const cdromRam = areaList.find((area) => /cdrom ram/i.test(String(area?.name || area?.title || area?.label || '')));
    const wramArea = Number(wram.id ?? wram.area ?? wram.index);
    const vramArea = Number(vram.id ?? vram.area ?? vram.index);
    const epochOffset = epochAddress & 0x1fff;
    const readEpoch = async () => {
      const payload = contentPayload(await client.tool('read_memory', {
        area: wramArea,
        offset: epochOffset.toString(16),
        size: 2,
      }));
      const bytes = bytesFromPayload(payload);
      if (bytes.length < 2) throw new Error(`Cannot decode frame epoch: ${JSON.stringify(payload)}`);
      return bytes[0] | (bytes[1] << 8);
    };
    const readWramByte = async (cpuAddress) => {
      const payload = contentPayload(await client.tool('read_memory', {
        area: wramArea,
        offset: (cpuAddress & 0x1fff).toString(16),
        size: 1,
      }));
      const bytes = bytesFromPayload(payload);
      if (!bytes.length) throw new Error(`Cannot decode WRAM byte $${cpuAddress.toString(16)}: ${JSON.stringify(payload)}`);
      return bytes[0];
    };
    const readWramWord = async (cpuAddress) => {
      const payload = contentPayload(await client.tool('read_memory', {
        area: wramArea,
        offset: (cpuAddress & 0x1fff).toString(16),
        size: 2,
      }));
      const bytes = bytesFromPayload(payload);
      if (bytes.length < 2) throw new Error(`Cannot decode WRAM word $${cpuAddress.toString(16)}: ${JSON.stringify(payload)}`);
      return bytes[0] | (bytes[1] << 8);
    };
    const readWramBytes = async (cpuAddress, size) => {
      const payload = contentPayload(await client.tool('read_memory', {
        area: wramArea,
        offset: (cpuAddress & 0x1fff).toString(16),
        size,
      }));
      const bytes = bytesFromPayload(payload);
      if (bytes.length !== size) {
        throw new Error(`Cannot decode WRAM bytes $${cpuAddress.toString(16)}: expected ${size}, got ${bytes.length}`);
      }
      return bytes;
    };
    const readVram = async (wordOffset, byteSize) => {
      const payload = contentPayload(await client.tool('read_memory', {
        area: vramArea,
        offset: wordOffset.toString(16),
        size: byteSize,
      }));
      const bytes = bytesFromPayload(payload);
      if (bytes.length !== byteSize) {
        throw new Error(`Cannot decode VRAM $${wordOffset.toString(16)}: expected ${byteSize}, got ${bytes.length}`);
      }
      return bytes;
    };
    const readCddaState = async () => ({
      state: await readWramByte(cddaStateAddress),
      drive: contentPayload(await client.routed('get_cdrom_status')),
    });
    const readDynamicSatbEntryLimit = async () => {
      if (!spriteSatbStartsAddress || !spriteSatbCountsAddress || !spritetextSlotsAddress) return 64;
      const starts = await readWramBytes(spriteSatbStartsAddress, 4);
      const counts = await readWramBytes(spriteSatbCountsAddress, 4);
      const slots = await readWramBytes(spritetextSlotsAddress, 300);
      let limit = 0;
      for (let i = 0; i < 4; i += 1) limit = Math.max(limit, starts[i] + counts[i]);
      for (let i = 0; i < 4; i += 1) {
        const slotOffset = i * 75;
        if (slots[slotOffset + 74]) limit += slots[slotOffset + 64];
      }
      return Math.min(64, limit);
    };
    const assertReached = async (address) => {
      await client.tool('set_breakpoint', { address, memory_area: 'cpu_addr', execute: true });
      await client.tool('debug_continue');
      await sleep(120);
      const status = contentPayload(await client.routed('debug_get_status'));
      await client.routed('remove_breakpoint', { address, memory_area: 'cpu_addr' });
      const pc = String(status?.pc ?? status?.PC ?? status?.current_pc ?? '').replace(/^0x|^\$/i, '').toLowerCase();
      const expected = address.replace(/^0x|^\$/i, '').toLowerCase();
      if (!status?.paused || !pc.endsWith(expected)) {
        throw new Error(`Expected breakpoint $${expected} was not reached: ${JSON.stringify(status)}`);
      }
      return status;
    };
    const stepFramesAndWait = async (frames, forbiddenAddress = '') => {
      const start = await readEpoch();
      const expected = forbiddenAddress.replace(/^0x|^\$/i, '').toLowerCase();
      let status = {};
      let current = start;
      const stepResults = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const deltaBefore = (current - start) & 0xffff;
        const requested = Math.max(1, frames - deltaBefore);
        stepResults.push(contentPayload(await client.routed('debug_step_frame', { frames: requested })));
        const deadline = Date.now() + Math.max(3000, (requested * 25) + 2000);
        while (Date.now() < deadline) {
          status = contentPayload(await client.routed('debug_get_status'));
          const pc = String(status?.pc ?? status?.PC ?? status?.current_pc ?? '').replace(/^0x|^\$/i, '').toLowerCase();
          const statusText = JSON.stringify(status).toLowerCase();
          if (expected && (status?.breakpoint_hit || status?.breakpoint || pc.endsWith(expected)
              || (statusText.includes('breakpoint') && statusText.includes(expected)))) {
            throw new Error(`Forbidden System Card full handler $${expected.toUpperCase()} executed: ${JSON.stringify(status)}`);
          }
          current = await readEpoch();
          const delta = (current - start) & 0xffff;
          if (delta >= frames) {
            /* The IRQ increments the epoch at VBlank before Geargrafx reaches
               its requested end-of-frame pause.  Wait for that automatic pause
               so main-thread work after RTI is not truncated on every batch. */
            const pauseDeadline = Date.now() + 1000;
            while (!status?.paused && Date.now() < pauseDeadline) {
              await sleep(2);
              status = contentPayload(await client.routed('debug_get_status'));
              const pausePc = String(status?.pc ?? status?.PC ?? status?.current_pc ?? '').replace(/^0x|^\$/i, '').toLowerCase();
              const pauseText = JSON.stringify(status).toLowerCase();
              if (expected && (status?.breakpoint_hit || status?.breakpoint || pausePc.endsWith(expected)
                  || (pauseText.includes('breakpoint') && pauseText.includes(expected)))) {
                throw new Error(`Forbidden System Card full handler $${expected.toUpperCase()} executed: ${JSON.stringify(status)}`);
              }
            }
            if (!status?.paused) await client.tool('debug_pause');
            return { stepResults, status, start, current, delta };
          }
          // debug_step_frame is asynchronous and may briefly report the stale
          // pre-call paused state. Do not submit a second frame request until
          // the epoch has actually advanced, or the verification can overshoot
          // by one VBlank (most visible on longer batches).
          if (status?.paused && delta > deltaBefore) break;
          await sleep(10);
        }
        if (!status?.paused) await client.tool('debug_pause');
        current = await readEpoch();
        if (((current - start) & 0xffff) <= deltaBefore) break;
      }
      await client.tool('debug_pause');
      throw new Error(`Geargrafx frame step timed out: ${JSON.stringify({ frames, start, current, status, stepResults })}`);
    };

    if (options.inspectCddaStart && options.cddaCommandHit > 1) {
      if (options.cddaCommandHit !== 2) {
        throw new Error('--cdda-command-hit currently supports title command hits 1 or 2');
      }
      const status = contentPayload(await client.routed('debug_get_status'));
      const pc = String(status?.pc ?? status?.PC ?? status?.current_pc ?? '').replace(/^0x|^\$/i, '').toLowerCase();
      const expectedPc = cddaCommandAddress.toString(16).toLowerCase();
      if (!status?.paused || !pc.endsWith(expectedPc)) {
        throw new Error(`First CD-DA command entry was not reached: ${JSON.stringify(status)}`);
      }
      await client.routed('remove_breakpoint', cddaCommandBreakpoint);
      await client.tool('set_breakpoint', cddaSyncBreakpoint);
      const firstBiosDeadline = Date.now() + 20000;
      let firstBiosStatus = status;
      let firstBiosState = 0;
      let firstBiosSyncHits = 0;
      const expectedBiosPc = cddaSyncAddress.toString(16).toLowerCase();
      while (Date.now() < firstBiosDeadline) {
        await client.tool('debug_continue');
        while (Date.now() < firstBiosDeadline) {
          firstBiosStatus = contentPayload(await client.routed('debug_get_status'));
          const currentPc = String(firstBiosStatus?.pc ?? firstBiosStatus?.PC ?? firstBiosStatus?.current_pc ?? '')
            .replace(/^0x|^\$/i, '').toLowerCase();
          if (firstBiosStatus?.paused && currentPc.endsWith(expectedBiosPc)) break;
          await sleep(10);
        }
        const currentPc = String(firstBiosStatus?.pc ?? firstBiosStatus?.PC ?? firstBiosStatus?.current_pc ?? '')
          .replace(/^0x|^\$/i, '').toLowerCase();
        if (!firstBiosStatus?.paused || !currentPc.endsWith(expectedBiosPc)) break;
        firstBiosSyncHits += 1;
        firstBiosState = await readWramByte(cddaStateAddress);
        if (firstBiosState & 0x01) break;
      }
      await client.routed('remove_breakpoint', cddaSyncBreakpoint);
      if (!(firstBiosState & 0x01)) {
        throw new Error(`First CD-DA command did not reach its BIOS return: ${JSON.stringify({ firstBiosStatus, firstBiosState, firstBiosSyncHits })}`);
      }
      const beforeCdda = contentPayload(await client.routed('get_cdrom_audio_status'));
      const macro = contentPayload(await client.routed('controller_macro', {
        player: 1,
        commands: [{ wait: 90 }, { tap: 'run' }, { wait: 1 }],
      }));
      let afterStatus = contentPayload(await client.routed('debug_get_status'));
      if (afterStatus?.paused) await client.tool('debug_continue');
      await sleep(2000);
      await client.tool('debug_pause');
      afterStatus = contentPayload(await client.routed('debug_get_status'));
      const afterCdda = contentPayload(await client.routed('get_cdrom_audio_status'));
      let cddaMetaBytes = [];
      if (cdromRam && cdTransferScratchAddress) {
        const payload = contentPayload(await client.tool('read_memory', {
          area: Number(cdromRam.id ?? cdromRam.area ?? cdromRam.index),
          offset: (((132 - 128) * 0x2000) + (cdTransferScratchAddress & 0x1fff)).toString(16),
          size: 96,
        }));
        cddaMetaBytes = bytesFromPayload(payload);
      }
      const cddaMetaRecords = [];
      for (let offset = 0; offset + 8 <= cddaMetaBytes.length; offset += 32) {
        cddaMetaRecords.push({
          track: cddaMetaBytes[offset],
          startLba: cddaMetaBytes[offset + 2] | (cddaMetaBytes[offset + 3] << 8) | (cddaMetaBytes[offset + 4] << 16),
          stopLba: cddaMetaBytes[offset + 5] | (cddaMetaBytes[offset + 6] << 8) | (cddaMetaBytes[offset + 7] << 16),
        });
      }
      const vm = {
        scene: currentSceneAddress ? await readWramByte(currentSceneAddress) : null,
        command: currentCommandAddress ? await readWramByte(currentCommandAddress) : null,
        cddaState: await readWramByte(cddaStateAddress),
      };
      const afterDriveState = String(afterCdda?.state || '').toUpperCase();
      const selectedMeta = cddaMetaRecords.find((record) => record.startLba === Number(afterCdda?.start_lba)) || null;
      if (!['PLAYING', 'STOPPED'].includes(afterDriveState)
          || Number(afterCdda?.start_lba) === Number(beforeCdda?.start_lba)
          || !selectedMeta) {
        throw new Error(`Second CD-DA command did not switch tracks after title input: ${JSON.stringify({ firstBiosStatus, firstBiosState, firstBiosSyncHits, beforeCdda, macro, afterStatus, afterCdda, cddaMetaRecords, vm })}`);
      }
      process.stdout.write(`${JSON.stringify({
        ok: true,
        mode: 'inspect-cdda-start',
        cue: cuePath,
        media,
        command: {
          address: `0x${cddaCommandAddress.toString(16)}`,
          bank: cddaCommandBank,
          hit: 2,
          scene: vm.scene,
          command: vm.command,
          cddaState: vm.cddaState,
        },
        firstCommand: { biosStatus: firstBiosStatus, biosSyncHits: firstBiosSyncHits, cddaState: firstBiosState },
        titleInput: { macro, status: afterStatus },
        cdda: { before: beforeCdda, after: afterCdda, selectedMeta },
        cddaMetaRecords,
      }, null, 2)}\n`);
      return;
    }

    if (options.inspectCddaStart) {
      const status = contentPayload(await client.routed('debug_get_status'));
      const pc = String(status?.pc ?? status?.PC ?? status?.current_pc ?? '').replace(/^0x|^\$/i, '').toLowerCase();
      const expectedPc = cddaCommandAddress.toString(16).toLowerCase();
      if (!status?.paused || !pc.endsWith(expectedPc)) {
        throw new Error(`CD-DA command entry was not reached: ${JSON.stringify(status)}`);
      }
      const beforeVdc = vdcSnapshot(contentPayload(await client.routed('get_huc6270_registers', { vdc: 1 })));
      const beforeVce = contentPayload(await client.routed('get_huc6260_status'));
      const beforeScreen = screenshotDigest(await client.tool('get_screenshot'));
      await client.routed('remove_breakpoint', cddaCommandBreakpoint);

      await client.tool('set_breakpoint', cddaSyncBreakpoint);
      const biosDeadline = Date.now() + 20000;
      let biosStatus = status;
      let biosState = 0;
      let biosSyncHits = 0;
      const expectedBiosPc = cddaSyncAddress.toString(16).toLowerCase();
      while (Date.now() < biosDeadline) {
        await client.tool('debug_continue');
        while (Date.now() < biosDeadline) {
          biosStatus = contentPayload(await client.routed('debug_get_status'));
          const currentPc = String(biosStatus?.pc ?? biosStatus?.PC ?? biosStatus?.current_pc ?? '')
            .replace(/^0x|^\$/i, '').toLowerCase();
          if (biosStatus?.paused && currentPc.endsWith(expectedBiosPc)) break;
          await sleep(10);
        }
        const currentPc = String(biosStatus?.pc ?? biosStatus?.PC ?? biosStatus?.current_pc ?? '')
          .replace(/^0x|^\$/i, '').toLowerCase();
        if (!biosStatus?.paused || !currentPc.endsWith(expectedBiosPc)) break;
        biosSyncHits += 1;
        biosState = await readWramByte(cddaStateAddress);
        /* The command first reads its metadata sector, which also passes this
           generic BIOS sync point.  Only the hit after cdda_state becomes
           active is the actual CD-DA play return. */
        if (biosState & 0x01) break;
      }
      const biosPc = String(biosStatus?.pc ?? biosStatus?.PC ?? biosStatus?.current_pc ?? '')
        .replace(/^0x|^\$/i, '').toLowerCase();
      if (!biosStatus?.paused || !biosPc.endsWith(expectedBiosPc) || !(biosState & 0x01)) {
        throw new Error(`Actual CD-DA BIOS return checkpoint was not reached: ${JSON.stringify({ biosStatus, biosState, biosSyncHits })}`);
      }
      const biosVdc = vdcSnapshot(contentPayload(await client.routed('get_huc6270_registers', { vdc: 1 })));
      const biosVce = contentPayload(await client.routed('get_huc6260_status'));
      const biosCdda = contentPayload(await client.routed('get_cdrom_audio_status'));
      if (String(biosCdda?.state || '').toUpperCase() !== 'PLAYING') {
        throw new Error(`CD-DA BIOS call returned without starting audio playback: ${JSON.stringify(biosCdda)}`);
      }
      const biosScreen = screenshotDigest(await client.tool('get_screenshot'));
      await client.routed('remove_breakpoint', cddaSyncBreakpoint);

      /* A same-value write to R10-R14 during active display resets internal
         video timing even though a later register read looks unchanged.  Arm
         R10 before leaving the real CD-DA BIOS return and require one complete
         frame without a timing write. */
      const timingBreakpoint = { address: 'a', memory_area: 'huc6270_reg', write: true };
      const timingStartEpoch = await readEpoch();
      await client.tool('set_breakpoint', timingBreakpoint);
      await client.routed('debug_step_frame', { frames: 1 });
      const timingDeadline = Date.now() + 3000;
      let timingStatus = biosStatus;
      let timingEpoch = timingStartEpoch;
      while (Date.now() < timingDeadline) {
        timingStatus = contentPayload(await client.routed('debug_get_status'));
        timingEpoch = await readEpoch();
        const timingPc = String(timingStatus?.pc ?? timingStatus?.PC ?? timingStatus?.current_pc ?? '')
          .replace(/^0x|^\$/i, '').toLowerCase();
        if (timingStatus?.paused && !timingPc.endsWith(expectedBiosPc)) break;
        await sleep(2);
      }
      const timingDelta = (timingEpoch - timingStartEpoch) & 0xffff;
      if (timingStatus?.paused && timingDelta === 0) {
        const timingWrite = {
          status: timingStatus,
          vdc: vdcSnapshot(contentPayload(await client.routed('get_huc6270_registers', { vdc: 1 }))),
          vce: contentPayload(await client.routed('get_huc6260_status')),
          screen: screenshotDigest(await client.tool('get_screenshot')),
        };
        await client.routed('remove_breakpoint', timingBreakpoint);
        throw new Error(`CD-DA start wrote VDC R10 during the visible frame: ${JSON.stringify(timingWrite)}`);
      }
      if (!timingStatus?.paused) await client.tool('debug_pause');
      await client.routed('remove_breakpoint', timingBreakpoint);
      if (timingDelta < 1) {
        throw new Error(`CD-DA start did not complete the guarded frame: ${JSON.stringify({ timingStatus, timingStartEpoch, timingEpoch })}`);
      }

      const frames = [];
      for (let index = 0; index < 3; index += 1) {
        if (index) await stepFramesAndWait(1);
        frames.push({
          vdc: vdcSnapshot(contentPayload(await client.routed('get_huc6270_registers', { vdc: 1 }))),
          vce: contentPayload(await client.routed('get_huc6260_status')),
          screen: screenshotDigest(await client.tool('get_screenshot')),
        });
      }
      const stableVce = vceSnapshot(beforeVce);
      const vdcRestored = JSON.stringify(beforeVdc) === JSON.stringify(biosVdc)
        && frames.every((frame) => JSON.stringify(frame.vdc) === JSON.stringify(beforeVdc));
      const vceRestored = JSON.stringify(vceSnapshot(biosVce)) === JSON.stringify(stableVce)
        && frames.every((frame) => JSON.stringify(vceSnapshot(frame.vce)) === JSON.stringify(stableVce));
      const screenStable = biosScreen === beforeScreen && frames.every((frame) => frame.screen === beforeScreen);
      if (!vdcRestored || !vceRestored || !screenStable) {
        throw new Error(`CD-DA start changed video state or a completed frame: ${JSON.stringify({ beforeVdc, beforeVce, beforeScreen, biosVdc, biosVce, biosScreen, frames })}`);
      }
      process.stdout.write(`${JSON.stringify({
        ok: true,
        mode: 'inspect-cdda-start',
        cue: cuePath,
        media,
        command: {
          address: `0x${cddaCommandAddress.toString(16)}`,
          bank: cddaCommandBank,
          hit: options.cddaCommandHit,
          scene: currentSceneAddress ? await readWramByte(currentSceneAddress) : null,
          command: currentCommandAddress ? await readWramByte(currentCommandAddress) : null,
          biosSyncAddress: `0x${cddaSyncAddress.toString(16)}`,
          biosSyncHits,
          cddaState: biosState,
        },
        frame: { before: beforeScreen, after: frames.map((frame) => frame.screen), stable: screenStable },
        biosReturn: { status: biosStatus, cdda: biosCdda, vdc: biosVdc, vce: biosVce, screen: biosScreen },
        vdc: { before: beforeVdc, after: frames.map((frame) => frame.vdc), restored: vdcRestored },
        vce: { before: beforeVce, after: frames.map((frame) => frame.vce), restored: vceRestored },
        visibleTimingWrites: 0,
      }, null, 2)}\n`);
      return;
    }

    if (options.inspectSpriteMove) {
      const status = contentPayload(await client.routed('debug_get_status'));
      const pc = String(status?.pc ?? status?.PC ?? status?.current_pc ?? '').replace(/^0x|^\$/i, '').toLowerCase();
      const expectedPc = spriteMoveStartAddress.toString(16).toLowerCase();
      if (!status?.paused || !pc.endsWith(expectedPc)) {
        throw new Error(`First sprite move was not reached: ${JSON.stringify(status)}`);
      }
      await client.routed('remove_breakpoint', spriteMoveBreakpoint);
      await client.routed('debug_step_out');
      const stepOutDeadline = Date.now() + 3000;
      let stepOutStatus = status;
      while (Date.now() < stepOutDeadline) {
        stepOutStatus = contentPayload(await client.routed('debug_get_status'));
        const stepOutPc = String(stepOutStatus?.pc ?? stepOutStatus?.PC ?? stepOutStatus?.current_pc ?? '')
          .replace(/^0x|^\$/i, '').toLowerCase();
        if (stepOutStatus?.paused && !stepOutPc.endsWith(expectedPc)) break;
        await sleep(10);
      }
      const returnedPc = String(stepOutStatus?.pc ?? stepOutStatus?.PC ?? stepOutStatus?.current_pc ?? '')
        .replace(/^0x|^\$/i, '').toLowerCase();
      if (!stepOutStatus?.paused || returnedPc.endsWith(expectedPc)) {
        throw new Error(`Sprite move step-out did not complete: ${JSON.stringify(stepOutStatus)}`);
      }

      const word = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
      const signedByte = (value) => (value & 0x80 ? value - 0x100 : value);
      const snapshotMove = async () => {
        const move = await readWramBytes(spriteMovesAddress, 19);
        const slot = await readWramBytes(spriteSlotsAddress, 21);
        const satbIndex = await readWramByte(spriteSatbStartsAddress);
        const satb = await readVram(0x7f00 + (satbIndex * 4), 8);
        return {
          slot: { x: word(slot, 4), y: word(slot, 6) },
          move: {
            targetX: word(move, 0), targetY: word(move, 2),
            distanceX: word(move, 4), distanceY: word(move, 6),
            errorX: word(move, 8), errorY: word(move, 10),
            total: word(move, 12), remaining: word(move, 14),
            directionX: signedByte(move[16]), directionY: signedByte(move[17]), active: move[18],
          },
          syncSlot: await readWramByte(syncSpriteMoveAddress),
          satb: { index: satbIndex, x: word(satb, 2), y: word(satb, 0) },
        };
      };

      const start = await snapshotMove();
      await stepFramesAndWait(15);
      const syncMid1 = await snapshotMove();
      await stepFramesAndWait(15);
      const syncMid2 = await snapshotMove();
      await stepFramesAndWait(15);

      let asyncStart = await snapshotMove();
      for (let i = 0; i < 5 && !(asyncStart.move.active && asyncStart.move.targetX === 96); i += 1) {
        await stepFramesAndWait(1);
        asyncStart = await snapshotMove();
      }
      if (start.slot.x !== 96 || start.slot.y !== 24 || start.move.targetX !== 144 || start.move.targetY !== 56
          || start.move.total !== 45 || start.move.remaining !== 45
          || start.move.directionX !== 1 || start.move.directionY !== 1 || !start.move.active || start.syncSlot !== 0) {
        throw new Error(`Unexpected synchronous sprite move start: ${JSON.stringify(start)}`);
      }
      if (!(syncMid1.slot.x > start.slot.x && syncMid1.slot.x < 144
          && syncMid2.slot.x > syncMid1.slot.x && syncMid2.slot.x < 144
          && syncMid1.slot.y > start.slot.y && syncMid1.slot.y < 56
          && syncMid2.slot.y > syncMid1.slot.y && syncMid2.slot.y < 56
          && syncMid1.move.remaining < start.move.remaining
          && syncMid2.move.remaining < syncMid1.move.remaining
          && syncMid2.satb.x > syncMid1.satb.x && syncMid2.satb.y > syncMid1.satb.y)) {
        throw new Error(`Synchronous sprite move did not advance smoothly: ${JSON.stringify({ start, syncMid1, syncMid2 })}`);
      }
      if (!(asyncStart.move.active && asyncStart.move.targetX === 96 && asyncStart.move.targetY === 24
          && asyncStart.move.total === 90 && asyncStart.move.directionX === -1
          && asyncStart.move.directionY === -1 && asyncStart.syncSlot === 0xff)) {
        throw new Error(`Asynchronous sprite move did not start: ${JSON.stringify(asyncStart)}`);
      }

      await stepFramesAndWait(30);
      const asyncMid = await snapshotMove();
      if (!(asyncMid.slot.x < asyncStart.slot.x && asyncMid.slot.x > 96
          && asyncMid.slot.y < asyncStart.slot.y && asyncMid.slot.y > 24
          && asyncMid.move.remaining < asyncStart.move.remaining
          && asyncMid.satb.x < asyncStart.satb.x && asyncMid.satb.y < asyncStart.satb.y)) {
        throw new Error(`Asynchronous sprite move did not advance with the script unlocked: ${JSON.stringify({ asyncStart, asyncMid })}`);
      }
      await stepFramesAndWait(asyncMid.move.remaining);
      let complete = await snapshotMove();
      if (complete.move.active) {
        await stepFramesAndWait(1);
        complete = await snapshotMove();
      }
      if (complete.slot.x !== 96 || complete.slot.y !== 24 || complete.move.active || complete.syncSlot !== 0xff) {
        throw new Error(`Asynchronous sprite move did not finish at its target: ${JSON.stringify(complete)}`);
      }
      process.stdout.write(`${JSON.stringify({
        ok: true,
        mode: 'inspect-sprite-move',
        cue: cuePath,
        snapshots: { start, syncMid1, syncMid2, asyncStart, asyncMid, complete },
      }, null, 2)}\n`);
      return;
    }

    const driveDispatchHit = await assertReached('e86d');
    const psgDriveHit = options.skipPsgCheck ? null : await assertReached('e6cf');
    await stepFramesAndWait(1);

    if (options.exercise) {
      if (!options.skipForbiddenCheck) {
        await client.tool('set_breakpoint', { address: 'e873', memory_area: 'cpu_addr', execute: true });
      }
      if (options.settle) {
        await client.tool('debug_continue');
        await sleep(options.settle);
        await client.tool('debug_pause');
      }
      if (options.inspectCommand || options.inspectCount) {
        const inspectAddress = options.inspectCount ? commandCountAddress : commandReaderAddress;
        if (!inspectAddress) throw new Error('Requested scene-pack inspection symbol is missing');
        const commandReaderPhysical = ((133 - 128) * 0x2000) + (inspectAddress & 0x1fff);
        const breakpoint = options.inspectCount
          ? { address: (inspectAddress & 0x1fff).toString(16), memory_area: 'cd_ram', execute: true }
          : { address: commandReaderPhysical.toString(16), memory_area: 'cd_ram', execute: true };
        await client.tool('set_breakpoint', {
          ...breakpoint,
        });
        const macro = contentPayload(await client.routed('controller_macro', { commands: [{ wait: 200 }] }));
        const hit = contentPayload(await client.routed('debug_get_status'));
        await client.routed('remove_breakpoint', breakpoint);
        const stepped = contentPayload(await client.routed('debug_step_out'));
        const returned = contentPayload(await client.tool('get_huc6280_status'));
        const scratchAddress = optionalSymbolCpuAddress(mapPath, 'vn_command_scratch_storage');
        let scratch = [];
        if (scratchAddress) {
          const payload = contentPayload(await client.tool('read_memory', {
            area: wramArea, offset: (scratchAddress & 0x1fff).toString(16), size: 19,
          }));
          scratch = bytesFromPayload(payload);
        }
        process.stdout.write(`${JSON.stringify({ ok: true, mode: options.inspectCount ? 'inspect-count' : 'inspect-command', macro, hit, stepped, returned, scratch }, null, 2)}\n`);
        return;
      }
      let maxEnabledChannels = 0;
      let observedAtPress = -1;
      let observedPsg = null;
      const irqMasks = [];
      const controllerResults = [];
      const vmStates = [];
      const exerciseStartEpoch = await readEpoch();
      for (let press = 0; press < options.presses; press += 1) {
        const button = press % 3 === 2 ? 'run' : 'I';
        const macro = contentPayload(await client.routed('controller_macro', {
          player: 1,
          commands: [{ tap: button }, { wait: 14 }],
        }));
        controllerResults.push({ button, macro });
        const status = contentPayload(await client.routed('debug_get_status'));
        const pc = String(status?.pc ?? status?.PC ?? status?.current_pc ?? '').replace(/^0x|^\$/i, '').toLowerCase();
        const statusText = JSON.stringify(status).toLowerCase();
        if (!options.skipForbiddenCheck && (status?.breakpoint_hit || status?.breakpoint || pc.endsWith('e873')
            || (statusText.includes('breakpoint') && statusText.includes('e873')))) {
          throw new Error(`Forbidden System Card full handler $E873 executed during VN exercise: ${JSON.stringify(status)}`);
        }
        const irqMask = await readWramByte(0x20f5);
        irqMasks.push(irqMask);
        if (!(irqMask & 0x02) || (irqMask & 0xc0)) {
          throw new Error(`BIOS user-vector contract changed during VN exercise: $${irqMask.toString(16)}`);
        }
        const psg = contentPayload(await client.routed('get_psg_status'));
        const vmState = {
          scene: currentSceneAddress ? await readWramByte(currentSceneAddress) : null,
          command: currentCommandAddress ? await readWramByte(currentCommandAddress) : null,
          messageComplete: messageCompleteAddress ? await readWramByte(messageCompleteAddress) : null,
        };
        if (!vmStates.length || JSON.stringify(vmStates[vmStates.length - 1]) !== JSON.stringify(vmState)) vmStates.push(vmState);
        const channels = Array.isArray(psg?.channels) ? psg.channels : [];
        const enabledChannels = channels.filter((channel) => Number(channel?.enabled) !== 0).length;
        if (enabledChannels > maxEnabledChannels) {
          maxEnabledChannels = enabledChannels;
          observedAtPress = press;
          observedPsg = psg;
        }
      }
      if (!options.skipForbiddenCheck) {
        await client.routed('remove_breakpoint', { address: 'e873', memory_area: 'cpu_addr' });
      }
      if (maxEnabledChannels < 2) {
        const exerciseEndEpoch = await readEpoch();
        const exerciseCpu = contentPayload(await client.tool('get_huc6280_status'));
        const cdrom = contentPayload(await client.routed('get_cdrom_status'));
        const callStack = contentPayload(await client.routed('get_call_stack'));
        const asyncState = {
          status: asyncStatusAddress ? await readWramByte(asyncStatusAddress) : null,
          storeRemaining: asyncStoreRemainingAddress ? await readWramWord(asyncStoreRemainingAddress) : null,
          wireRemaining: asyncWireRemainingAddress ? await readWramWord(asyncWireRemainingAddress) : null,
          destKind: asyncDestKindAddress ? await readWramByte(asyncDestKindAddress) : null,
          cdBusState: cdBusStateAddress ? await readWramByte(cdBusStateAddress) : null,
        };
        const sceneCacheState = {
          basePresent: await readWramByte(0x205b),
          size: await readWramWord(0x205c),
          scene: await readWramByte(0x205e),
          valid: await readWramByte(0x205f),
        };
        let scenePackBytes = null;
        if (cardRam) {
          const payload = contentPayload(await client.tool('read_memory', {
            area: Number(cardRam.id ?? cardRam.area ?? cardRam.index),
            offset: ((123 - 0x68) * 0x2000).toString(16),
            size: 32,
          }));
          scenePackBytes = bytesFromPayload(payload);
        }
        const expectedScenePath = path.join(path.dirname(path.dirname(cuePath)), 'assets', 'generated', 'vn', 'scenes', '000_opening.bin');
        const expectedSceneBytes = fs.existsSync(expectedScenePath)
          ? Array.from(fs.readFileSync(expectedScenePath).subarray(0, 32))
          : null;
        let overlayBytes = null;
        if (cdromRam) {
          const payload = contentPayload(await client.tool('read_memory', {
            area: Number(cdromRam.id ?? cdromRam.area ?? cdromRam.index),
            offset: ((133 - 128) * 0x2000).toString(16),
            size: 32,
          }));
          overlayBytes = bytesFromPayload(payload);
        }
        const expectedOverlayPath = path.join(path.dirname(path.dirname(cuePath)), 'assets', 'generated', 'vn', 'overlay.bin');
        const expectedOverlayBytes = fs.existsSync(expectedOverlayPath)
          ? Array.from(fs.readFileSync(expectedOverlayPath).subarray(0, 32))
          : null;
        throw new Error(`BGM + SFX concurrency was not observed: ${JSON.stringify({
          presses: options.presses,
          maxEnabledChannels,
          epoch: { start: exerciseStartEpoch, end: exerciseEndEpoch, delta: (exerciseEndEpoch - exerciseStartEpoch) & 0xffff },
          vmStates,
          cpu: exerciseCpu,
          cdrom,
          callStack,
          memoryAreas: areaList,
          asyncState,
          sceneCacheState,
          scenePackBytes,
          expectedSceneBytes,
          overlayBytes,
          expectedOverlayBytes,
          controllerResults: controllerResults.slice(0, 3),
          lastPsg: observedPsg,
        })}`);
      }
      const observedScenes = [...new Set(vmStates.map((state) => state.scene).filter((scene) => scene != null))];
      if (options.presses >= 180 && ![0, 1, 2, 3].every((scene) => observedScenes.includes(scene))) {
        throw new Error(`Full VN exercise did not reach every sample scene: ${JSON.stringify({ observedScenes, vmStates })}`);
      }
      const exerciseCpu = contentPayload(await client.tool('get_huc6280_status'));
      process.stdout.write(`${JSON.stringify({
        ok: true,
        mode: 'exercise',
        cue: cuePath,
        media,
        addresses: { driveDispatch: '$E86D', psgDrive: '$E6CF', forbiddenFullHandler: '$E873' },
        breakpointHits: { driveDispatchHit, psgDriveHit, forbiddenFullHandler: 0 },
        observedAtPress,
        maxEnabledChannels,
        mpr456: mprSnapshot(exerciseCpu),
        biosIrqMasks: [...new Set(irqMasks)],
        vmStateTransitions: vmStates.length,
        observedScenes,
        psg: observedPsg,
      }, null, 2)}\n`);
      return;
    }

    /* Let initial scene loading and the first message's typewriter complete before
       taking the non-destructive IRQ snapshots.  BAT changes during that work are
       application writes, not BIOS-handler corruption. */
    await client.tool('set_breakpoint', { address: 'e873', memory_area: 'cpu_addr', execute: true });
    const settleStatus = await stepFramesAndWait(600, 'e873');

    const beforeEpoch = await readEpoch();
    const beforeCpu = contentPayload(await client.tool('get_huc6280_status'));
    const beforeVdc = contentPayload(await client.routed('get_huc6270_registers', { vdc: 1 }));
    const beforePsg = contentPayload(await client.routed('get_psg_status'));
    const beforeBiosIrqMask = await readWramByte(0x20f5);
    const beforeBat = await readVram(0x0000, 2048);
    const beforeSatb = await readVram(0x7f00, 512);
    const dynamicSatbEntryLimit = options.inspectCdda ? await readDynamicSatbEntryLimit() : 0;
    let beforeCdda = null;
    if (options.inspectCdda) {
      if (!cddaStateAddress) {
        throw new Error('CD-DA inspection symbols are missing');
      }
      beforeCdda = await readCddaState();
      if ((beforeCdda.state & 0x05) !== 0x05) {
        throw new Error(`Looping CD-DA is not active before inspection: ${JSON.stringify(beforeCdda)}`);
      }
    }

    let remaining = options.frames;
    let cddaRealTimeWaitMs = 0;
    const batchStatuses = [];
    if (options.inspectCdda) {
      /* CD playback and repeat are drive-time operations. Continue in real time
         for the requested duration, matching the emulator validation guidance
         instead of trying to advance the CD unit with frame-step calls. */
      cddaRealTimeWaitMs = Math.ceil((options.frames * 1000) / 60);
      await client.tool('debug_continue');
      await sleep(cddaRealTimeWaitMs);
      const cddaRunStatus = contentPayload(await client.routed('debug_get_status'));
      const cddaRunPc = String(cddaRunStatus?.pc ?? cddaRunStatus?.PC ?? cddaRunStatus?.current_pc ?? '')
        .replace(/^0x|^\$/i, '').toLowerCase();
      if (cddaRunStatus?.breakpoint_hit || cddaRunStatus?.breakpoint || cddaRunPc.endsWith('e873')) {
        throw new Error(`Forbidden System Card full handler $E873 executed during CD-DA inspection: ${JSON.stringify(cddaRunStatus)}`);
      }
      if (!cddaRunStatus?.paused) await client.tool('debug_pause');
    } else {
      while (remaining > 0) {
        const batch = Math.min(1000, remaining);
        const batchStatus = await stepFramesAndWait(batch, 'e873');
        batchStatuses.push(batchStatus);
        remaining -= batch;
      }
    }
    await client.routed('remove_breakpoint', { address: 'e873', memory_area: 'cpu_addr' });

    const afterEpoch = await readEpoch();
    const afterCpu = contentPayload(await client.tool('get_huc6280_status'));
    const afterVdc = contentPayload(await client.routed('get_huc6270_registers', { vdc: 1 }));
    const afterPsg = contentPayload(await client.routed('get_psg_status'));
    const afterBiosIrqMask = await readWramByte(0x20f5);
    const afterBat = await readVram(0x0000, 2048);
    const afterSatb = await readVram(0x7f00, 512);
    const afterCdda = options.inspectCdda ? await readCddaState() : null;
    const epochDelta = (afterEpoch - beforeEpoch) & 0xffff;
    const beforeMpr = mprSnapshot(beforeCpu);
    const afterMpr = mprSnapshot(afterCpu);
    const beforeVdcKey = vdcSnapshot(beforeVdc);
    const afterVdcKey = vdcSnapshot(afterVdc);
    const vdcStable = options.inspectCdda
      ? vdcRegisterValue(afterVdcKey.r5) === '04C8'
        && vdcRegisterValue(afterVdcKey.r19) === '7F00'
        && JSON.stringify({ r7: beforeVdcKey.r7, r8: beforeVdcKey.r8, r13: beforeVdcKey.r13 })
          === JSON.stringify({ r7: afterVdcKey.r7, r8: afterVdcKey.r8, r13: afterVdcKey.r13 })
      : JSON.stringify(beforeVdcKey) === JSON.stringify(afterVdcKey);
    const mprStable = JSON.stringify(beforeMpr) === JSON.stringify(afterMpr);
    const batStable = Buffer.from(beforeBat).equals(Buffer.from(afterBat));
    const satbStable = Buffer.from(beforeSatb).equals(Buffer.from(afterSatb))
      || (options.inspectCdda && Buffer.from(beforeSatb.slice(dynamicSatbEntryLimit * 8))
        .equals(Buffer.from(afterSatb.slice(dynamicSatbEntryLimit * 8))));
    if (!options.inspectCdda && epochDelta !== options.frames) {
      throw new Error(`VSync epoch delta ${epochDelta} != requested ${options.frames}: ${JSON.stringify({
        beforeEpoch,
        afterEpoch,
        beforeCpu,
        afterCpu,
        beforeVdc: vdcSnapshot(beforeVdc),
        afterVdc: vdcSnapshot(afterVdc),
        beforeBiosIrqMask,
        afterBiosIrqMask,
        batStable,
        satbStable,
        batches: batchStatuses,
      })}`);
    }
    if (!mprStable) throw new Error(`MPR4/5/6 changed: ${JSON.stringify({ beforeMpr, afterMpr })}`);
    if (!vdcStable) throw new Error(`VDC R5/R7/R8/R13 changed: ${JSON.stringify({ beforeVdcKey, afterVdcKey })}`);
    if (!batStable) throw new Error(`BG BAT changed: ${JSON.stringify({ before: digestBytes(beforeBat), after: digestBytes(afterBat) })}`);
    if (!satbStable) throw new Error(`SATB changed: ${JSON.stringify({ before: digestBytes(beforeSatb), after: digestBytes(afterSatb) })}`);
    if (options.inspectCdda) {
      if (epochDelta < Math.floor(options.frames * 0.9)
          || (afterCdda.state & 0x05) !== 0x05
          || /"(?:scsi_)?phase"\s*:\s*"?command/i.test(JSON.stringify(afterCdda.drive))) {
        throw new Error(`Bounded looping CD-DA did not remain healthy for the requested duration: ${JSON.stringify({ epochDelta, requestedFrames: options.frames, beforeCdda, afterCdda })}`);
      }
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cue: cuePath,
      loadResult,
      media,
      bootPc: bootCpu?.pc ?? bootCpu?.PC,
      addresses: { driveDispatch: '$E86D', psgDrive: '$E6CF', forbiddenFullHandler: '$E873' },
      breakpointHits: { driveDispatchHit, psgDriveHit, forbiddenFullHandler: 0 },
      settle: { frames: 600, epochDelta: settleStatus.delta },
      frames: options.inspectCdda ? epochDelta : options.frames,
      epoch: { address: `0x${epochAddress.toString(16)}`, before: beforeEpoch, after: afterEpoch, delta: epochDelta },
      mpr456: { before: beforeMpr, after: afterMpr, stable: mprStable },
      vdc: { before: beforeVdcKey, after: afterVdcKey, stable: vdcStable },
      biosIrqMask: { before: beforeBiosIrqMask, after: afterBiosIrqMask },
      vram: {
        bgBat: { before: digestBytes(beforeBat), after: digestBytes(afterBat), stable: batStable },
        satb: { before: digestBytes(beforeSatb), after: digestBytes(afterSatb), stable: satbStable, dynamicEntryLimit: dynamicSatbEntryLimit },
      },
      cdda: options.inspectCdda ? { before: beforeCdda, after: afterCdda, durationCompleted: true, realTimeWaitMs: cddaRealTimeWaitMs } : null,
      psg: { before: beforePsg, after: afterPsg },
    }, null, 2)}\n`);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
