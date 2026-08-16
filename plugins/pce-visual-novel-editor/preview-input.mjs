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

export function pcePreviewRegisterAsyncInputWatcher(asyncWatchers, watcher) {
  const current = Array.isArray(asyncWatchers) ? asyncWatchers : [];
  const incomingButtons = [...new Set(
    Array.isArray(watcher?.buttons) ? watcher.buttons.map((button) => String(button || '')) : [],
  )].filter(Boolean);
  if (!incomingButtons.length) return current.slice();

  const incomingButtonSet = new Set(incomingButtons);
  const next = [];
  current.forEach((entry) => {
    const remainingButtons = (Array.isArray(entry?.buttons) ? entry.buttons : [])
      .map((button) => String(button || ''))
      .filter((button) => button && !incomingButtonSet.has(button));
    if (!remainingButtons.length) return;
    next.push({
      buttons: remainingButtons,
      targetLabel: String(entry?.targetLabel || ''),
    });
  });
  next.push({
    buttons: incomingButtons,
    targetLabel: String(watcher?.targetLabel || ''),
  });
  return next;
}

export function pcePreviewInputMatch(syncWatcher, asyncWatchers, button) {
  const pressed = String(button || '');
  const matches = (watcher) => Boolean(
    watcher
    && pressed
    && Array.isArray(watcher.buttons)
    && watcher.buttons.includes(pressed),
  );
  const asyncWatcher = (Array.isArray(asyncWatchers) ? asyncWatchers : [asyncWatchers])
    .find((watcher) => matches(watcher));
  if (asyncWatcher) {
    return { mode: 'async', targetLabel: String(asyncWatcher.targetLabel || '') };
  }
  if (matches(syncWatcher)) {
    return { mode: 'sync', targetLabel: String(syncWatcher.targetLabel || '') };
  }
  return null;
}
