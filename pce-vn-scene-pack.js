'use strict';

function createVnScenePackCodec(options = {}) {
  const { clampInt, clampSignedInt, constants = {} } = options;
  const {
    cacheBytes, magic, version, headerSize, commandSize, messageSize, choiceSize, switchSize,
    spriteTextCommand, instantGlyphMax, mouthSlotMask, mouthSlotBits,
  } = constants;
  if (typeof clampInt !== 'function' || typeof clampSignedInt !== 'function' || !Buffer.isBuffer(magic)) {
    throw new Error('VN scene pack codec dependencies are required');
  }

  const pushU8 = (bytes, value) => bytes.push(clampInt(value, 0, 255, 0) & 0xff);
  function pushU16(bytes, value) {
    const encoded = clampInt(value, 0, 0xffff, 0) & 0xffff;
    bytes.push(encoded & 0xff, (encoded >> 8) & 0xff);
  }
  function pushS16(bytes, value) {
    const encoded = clampSignedInt(value, 0) & 0xffff;
    bytes.push(encoded & 0xff, (encoded >> 8) & 0xff);
  }
  function appendData(chunks, state, buffer) {
    const chunk = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    const offset = state.offset;
    state.offset += chunk.length;
    chunks.push(chunk);
    return offset;
  }
  function encodeCommand(command = {}) {
    const bytes = [];
    pushU8(bytes, command.type); pushS16(bytes, command.assetIndex); pushU8(bytes, command.slot);
    pushU8(bytes, command.flags); pushU8(bytes, command.arg0); pushU8(bytes, command.arg1);
    pushU16(bytes, command.x); pushU16(bytes, command.y); pushS16(bytes, command.messageIndex);
    pushS16(bytes, command.animationIndex); pushS16(bytes, command.sceneIndex); pushS16(bytes, command.choiceIndex);
    return Buffer.from(bytes);
  }
  function encodeMessage(message = {}) {
    const bytes = [];
    const instantCount = clampInt(message.instantGlyphCount, 0, instantGlyphMax, 0);
    const mouthSlot = (clampInt(message.mouthSlot, 0, mouthSlotMask, 0) & mouthSlotMask) | (instantCount << mouthSlotBits);
    pushU16(bytes, message.glyphOffset); pushU8(bytes, message.glyphCount); pushS16(bytes, message.voiceIndex);
    pushU8(bytes, message.textSpeedFrames); pushU8(bytes, message.advanceMode); pushU8(bytes, message.autoWaitFrames);
    pushS16(bytes, message.mouthAnimationIndex); pushU8(bytes, mouthSlot); pushU16(bytes, message.textColor);
    return Buffer.from(bytes);
  }
  function encodeChoice(choice = {}) {
    const bytes = [];
    pushU16(bytes, choice.optionOffset); pushU8(bytes, choice.optionCount); pushU8(bytes, choice.defaultIndex);
    pushS16(bytes, choice.variableIndex);
    return Buffer.from(bytes);
  }
  function encodeChoiceOption(option = {}) {
    const bytes = [];
    pushU16(bytes, option.glyphOffset); pushU8(bytes, option.glyphCount); pushS16(bytes, option.value);
    pushS16(bytes, option.targetScene);
    return Buffer.from(bytes);
  }
  function encodeSwitch(branch = {}) {
    const bytes = [];
    pushU16(bytes, branch.caseOffset); pushU8(bytes, branch.caseCount); pushU16(bytes, branch.defaultCommand);
    return Buffer.from(bytes);
  }
  function encodeSwitchCase(branchCase = {}) {
    const bytes = [];
    pushS16(bytes, branchCase.value); pushU16(bytes, branchCase.command);
    return Buffer.from(bytes);
  }

  function buildScenePack(sceneBuild = {}) {
    const commands = sceneBuild.commands || [];
    const messages = sceneBuild.messages || [];
    const choices = sceneBuild.choices || [];
    const switches = sceneBuild.switches || [];
    const commandOffset = headerSize;
    const messageOffset = commandOffset + (commands.length * commandSize);
    const choiceOffset = messageOffset + (messages.length * messageSize);
    const switchOffset = choiceOffset + (choices.length * choiceSize);
    const dataOffset = switchOffset + (switches.length * switchSize);
    const dataChunks = [];
    const state = { offset: dataOffset };

    messages.forEach((message) => { message.glyphOffset = appendData(dataChunks, state, message.glyphs); });
    choices.forEach((choice) => {
      const records = choice.options.map((option) => {
        option.glyphOffset = appendData(dataChunks, state, option.glyphs);
        return encodeChoiceOption(option);
      });
      choice.optionOffset = records.length ? appendData(dataChunks, state, Buffer.concat(records)) : 0;
    });
    switches.forEach((branch) => {
      const records = branch.cases.map(encodeSwitchCase);
      branch.caseOffset = records.length ? appendData(dataChunks, state, Buffer.concat(records)) : 0;
    });
    commands.forEach((command) => {
      if (command.type !== spriteTextCommand) return;
      const glyphs = Buffer.isBuffer(command.spriteTextGlyphs) ? command.spriteTextGlyphs : Buffer.alloc(0);
      command.assetIndex = glyphs.length ? appendData(dataChunks, state, glyphs) : 0;
    });

    const header = Buffer.alloc(headerSize);
    magic.copy(header, 0);
    header.writeUInt8(version, 4); header.writeUInt8(commands.length, 5); header.writeUInt8(messages.length, 6);
    header.writeUInt8(choices.length, 7); header.writeUInt8(switches.length, 8); header.writeUInt8(sceneBuild.flags || 0, 9);
    header.writeUInt16LE(commandOffset, 10); header.writeUInt16LE(messageOffset, 12); header.writeUInt16LE(choiceOffset, 14);
    header.writeUInt16LE(switchOffset, 16); header.writeUInt16LE(dataOffset, 18);

    const pack = Buffer.concat([
      header, ...commands.map(encodeCommand), ...messages.map(encodeMessage), ...choices.map(encodeChoice),
      ...switches.map(encodeSwitch), ...dataChunks,
    ]);
    if (pack.length > cacheBytes) {
      throw new Error(`PCE VN scene pack "${sceneBuild.sceneId}" is ${pack.length} bytes; split the scene to stay within ${cacheBytes} bytes`);
    }
    return pack;
  }

  return { buildScenePack };
}

module.exports = { createVnScenePackCodec };
