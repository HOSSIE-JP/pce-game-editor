'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_EXE = 'C:\\homebrew\\emulator\\Geargrafx\\Geargrafx.exe';

function parseArgs(argv) {
  const result = { exe: DEFAULT_EXE, cue: '', frames: 6000, exercise: false, inspectCommand: false, inspectCount: false, presses: 180, settle: 0, skipPsgCheck: false, skipForbiddenCheck: false, list: false, search: '', info: '' };
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
  return { r5: get(5), r7: get(7), r8: get(8), r13: get(13), r19: get(19) };
}

function digestBytes(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
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

    const loadResult = contentPayload(await client.tool('load_media', { file_path: cuePath }));
    await client.tool('debug_continue');
    await sleep(1200);
    await client.tool('controller_button', { player: 1, button: 'run', action: 'press_and_release' });
    await sleep(5000);
    await client.tool('debug_pause');

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
          if (status?.paused) break;
          await sleep(10);
        }
        if (!status?.paused) await client.tool('debug_pause');
        current = await readEpoch();
        if (((current - start) & 0xffff) <= deltaBefore) break;
      }
      await client.tool('debug_pause');
      throw new Error(`Geargrafx frame step timed out: ${JSON.stringify({ frames, start, current, status, stepResults })}`);
    };

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

    let remaining = options.frames;
    const batchStatuses = [];
    while (remaining > 0) {
      const batch = Math.min(1000, remaining);
      const batchStatus = await stepFramesAndWait(batch, 'e873');
      batchStatuses.push(batchStatus);
      remaining -= batch;
    }
    await client.routed('remove_breakpoint', { address: 'e873', memory_area: 'cpu_addr' });

    const afterEpoch = await readEpoch();
    const afterCpu = contentPayload(await client.tool('get_huc6280_status'));
    const afterVdc = contentPayload(await client.routed('get_huc6270_registers', { vdc: 1 }));
    const afterPsg = contentPayload(await client.routed('get_psg_status'));
    const afterBiosIrqMask = await readWramByte(0x20f5);
    const afterBat = await readVram(0x0000, 2048);
    const afterSatb = await readVram(0x7f00, 512);
    const epochDelta = (afterEpoch - beforeEpoch) & 0xffff;
    const beforeMpr = mprSnapshot(beforeCpu);
    const afterMpr = mprSnapshot(afterCpu);
    const beforeVdcKey = vdcSnapshot(beforeVdc);
    const afterVdcKey = vdcSnapshot(afterVdc);
    const vdcStable = JSON.stringify(beforeVdcKey) === JSON.stringify(afterVdcKey);
    const mprStable = JSON.stringify(beforeMpr) === JSON.stringify(afterMpr);
    const batStable = Buffer.from(beforeBat).equals(Buffer.from(afterBat));
    const satbStable = Buffer.from(beforeSatb).equals(Buffer.from(afterSatb));
    if (epochDelta !== options.frames) {
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

    process.stdout.write(`${JSON.stringify({
      ok: true,
      cue: cuePath,
      loadResult,
      media,
      bootPc: bootCpu?.pc ?? bootCpu?.PC,
      addresses: { driveDispatch: '$E86D', psgDrive: '$E6CF', forbiddenFullHandler: '$E873' },
      breakpointHits: { driveDispatchHit, psgDriveHit, forbiddenFullHandler: 0 },
      settle: { frames: 600, epochDelta: settleStatus.delta },
      frames: options.frames,
      epoch: { address: `0x${epochAddress.toString(16)}`, before: beforeEpoch, after: afterEpoch, delta: epochDelta },
      mpr456: { before: beforeMpr, after: afterMpr, stable: mprStable },
      vdc: { before: beforeVdcKey, after: afterVdcKey, stable: vdcStable },
      biosIrqMask: { before: beforeBiosIrqMask, after: afterBiosIrqMask },
      vram: {
        bgBat: { before: digestBytes(beforeBat), after: digestBytes(afterBat), stable: batStable },
        satb: { before: digestBytes(beforeSatb), after: digestBytes(afterSatb), stable: satbStable },
      },
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
