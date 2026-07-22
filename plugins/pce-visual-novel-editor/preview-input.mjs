export const PREVIEW_KEYBOARD_BUTTON_BY_CODE = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'run',
  Enter: 'run',
  NumpadEnter: 'run',
  KeyS: 'run',
  ShiftLeft: 'select',
  ShiftRight: 'select',
  KeyA: 'select',
  KeyZ: 'i',
  KeyX: 'ii',
});

export function pcePreviewButtonForKeyboardEvent(event) {
  return PREVIEW_KEYBOARD_BUTTON_BY_CODE[String(event?.code || '')] || '';
}
