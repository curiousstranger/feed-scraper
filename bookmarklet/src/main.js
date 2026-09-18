// Bookmarklet entry: the first click opens the picker, a second click closes it.
import { createPicker } from './panel.js';

const KEY = '__feedScraperPicker';

/** Open the picker on win.document, or close it if already open. Returns the picker or null. */
export function toggle(win, options = {}) {
  if (win[KEY]) {
    win[KEY].destroy();
    return null;
  }
  const picker = createPicker(win.document, {
    ...options,
    onDestroy: () => {
      delete win[KEY];
    },
  });
  win[KEY] = picker;
  return picker;
}
