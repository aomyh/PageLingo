export const TEXT_WINDOW_STORAGE_KEY = 'pagelingo.manualWindow.v1';

const validId = value => Number.isInteger(value) && value >= 0;

export function createTextTranslatorWindowManager({ windows, storage, url }) {
  let windowId;
  let restored = false;
  let opening;
  let writes = Promise.resolve();

  function persist(id) {
    // A removed old window must not overwrite a subsequently created window's
    // ID if session storage completes its operations at different speeds.
    writes = writes.catch(() => {}).then(() => storage?.set({ [TEXT_WINDOW_STORAGE_KEY]: id })).catch(() => {});
    return writes;
  }
  async function restore() {
    if (restored) return;
    restored = true;
    try {
      const value = (await storage?.get(TEXT_WINDOW_STORAGE_KEY))?.[TEXT_WINDOW_STORAGE_KEY];
      if (validId(value)) windowId = value;
    } catch { /* Memory reuse remains available if session storage is unavailable. */ }
  }
  function onRemoved(id) {
    if (windowId !== id) return;
    windowId = undefined;
    void persist(null);
  }
  windows.onRemoved?.addListener(onRemoved);

  function open() {
    if (!opening) opening = (async () => {
      await restore();
      if (validId(windowId)) {
        const existingId = windowId;
        try {
          // Window IDs are kept only for this browser session. No tabs or page
          // URLs are inspected, and no additional tabs permission is needed.
          const existing = await windows.get(existingId);
          if (!existing || existing.id !== existingId || (existing.type && existing.type !== 'popup')) throw new Error('Window unavailable');
          await windows.update(existingId, { focused: true, ...(existing.state === 'minimized' ? { state: 'normal' } : {}) });
          return existingId;
        } catch {
          if (windowId === existingId) windowId = undefined;
        }
      }
      const created = await windows.create({ type: 'popup', url, width: 460, height: 680, focused: true });
      if (!validId(created?.id)) throw new Error('Unable to open the translation window');
      windowId = created.id;
      await persist(windowId);
      return windowId;
    })().finally(() => { opening = undefined; });
    return opening;
  }
  return { open };
}
