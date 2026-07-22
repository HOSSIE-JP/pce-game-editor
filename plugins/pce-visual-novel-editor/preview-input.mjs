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

export function pcePreviewInputMatch(syncWatcher, asyncWatcher, button) {
  const pressed = String(button || '');
  const matches = (watcher) => Boolean(
    watcher
    && pressed
    && Array.isArray(watcher.buttons)
    && watcher.buttons.includes(pressed),
  );
  if (matches(asyncWatcher)) {
    return { mode: 'async', targetLabel: String(asyncWatcher.targetLabel || '') };
  }
  if (matches(syncWatcher)) {
    return { mode: 'sync', targetLabel: String(syncWatcher.targetLabel || '') };
  }
  return null;
}
