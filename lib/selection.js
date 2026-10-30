import { getSettings, saveSettings, getProvider, isProviderReady } from './config.js';
import { SELECTION_ORIGINS } from './permissions.js';

export const SELECTION_SCRIPT_ID = 'pagelingo-selection';
export const SELECTION_FILES = ['lib/themes.js', 'selection.js'];
export { SELECTION_ORIGINS };

export function publicSettings(settings) {
  const provider = getProvider(settings);
  return {
    targetLanguage: settings.targetLanguage, displayMode: settings.displayMode,
    concurrency: settings.concurrency, batchSize: settings.batchSize,
    cacheEnabled: settings.cacheEnabled, translateDynamic: settings.translateDynamic,
    selectionEnabled: settings.selectionEnabled === true,
    theme: settings.theme,
    activeProvider: provider.id, ready: isProviderReady(settings),
    providerName: provider.name, model: settings.providers[provider.id].model,
  };
}

export function supportsSelection(url = '') {
  try {
    const page = new URL(url);
    return ['http:', 'https:'].includes(page.protocol)
      && page.hostname !== 'chromewebstore.google.com'
      && !(page.hostname === 'chrome.google.com' && page.pathname.startsWith('/webstore'));
  } catch { return false; }
}

export function createSelectionManager({ api = globalThis.chrome, read = getSettings, write = saveSettings, onDisable = () => {} } = {}) {
  let queue = Promise.resolve();
  let revision = 0;
  let desiredEnabled = null;

  function serialize(task) {
    const result = queue.catch(() => {}).then(task);
    queue = result.catch(() => {});
    return result;
  }

  function isEnabled(settings) {
    return settings.selectionEnabled === true && desiredEnabled !== false;
  }

  function snapshot(settings) {
    return publicSettings({ ...settings, selectionEnabled: isEnabled(settings) });
  }

  async function broadcast(settings, isCurrent = () => true) {
    if (!api.tabs?.query || !api.tabs?.sendMessage || !isCurrent()) return;
    const tabs = await api.tabs.query({});
    if (!isCurrent()) return;
    const latest = await read();
    if (!isCurrent()) return;
    const payload = { type: 'PAGELINGO_SELECTION_SETTINGS', settings: publicSettings({
      ...latest, selectionEnabled: settings.selectionEnabled === true && isEnabled(latest),
    }) };
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => api.tabs.sendMessage(tab.id, payload)));
  }

  async function unregister(isCurrent = () => true) {
    if (!api.scripting?.getRegisteredContentScripts || !isCurrent()) return;
    const scripts = await api.scripting.getRegisteredContentScripts({ ids: [SELECTION_SCRIPT_ID] });
    if (scripts.length && isCurrent()) await api.scripting.unregisterContentScripts({ ids: [SELECTION_SCRIPT_ID] });
  }

  async function stop(settings, isCurrent) {
    if (!isCurrent()) return snapshot(settings);
    const latest = await read();
    if (!isCurrent()) return snapshot(latest);
    settings = latest.selectionEnabled ? await write({ ...latest, selectionEnabled: false }) : latest;
    if (!isCurrent()) return snapshot(settings);
    onDisable();
    // Update current documents before removing the script for future pages.
    await broadcast({ ...settings, selectionEnabled: false }, isCurrent);
    await unregister(isCurrent);
    return snapshot(settings);
  }

  async function recoverFailedEnable(expectedRevision) {
    if (expectedRevision !== revision || desiredEnabled === false) return;
    desiredEnabled = false;
    onDisable();
    const current = () => expectedRevision === revision && desiredEnabled === false;
    const latest = await read();
    if (!current()) return;
    const settings = latest.selectionEnabled ? await write({ ...latest, selectionEnabled: false }) : latest;
    await broadcast({ ...settings, selectionEnabled: false }, current).catch(() => {});
    await unregister(current).catch(() => {});
  }

  async function synchronize({ injectExisting = false } = {}) {
    const expectedRevision = revision;
    const current = () => expectedRevision === revision;
    let settings = await read();
    if (!current()) return snapshot(settings);
    try {
      const granted = isEnabled(settings) && await api.permissions.contains({ origins: SELECTION_ORIGINS });
      if (!current()) return snapshot(await read());
      if (!granted) return await stop(settings, current);
      if (!api.scripting?.getRegisteredContentScripts) throw new Error('当前浏览器不支持自动划词翻译，请更新 Chrome。');
      const scripts = await api.scripting.getRegisteredContentScripts({ ids: [SELECTION_SCRIPT_ID] });
      if (!current()) return snapshot(await read());
      // Upgrade older registrations so newly opened pages also load the shared
      // theme palette before the classic content script.
      const stale = scripts.some(script => JSON.stringify(script.js) !== JSON.stringify(SELECTION_FILES));
      if (stale) await api.scripting.unregisterContentScripts({ ids: [SELECTION_SCRIPT_ID] });
      if (!current()) return snapshot(await read());
      if (!scripts.length || stale) await api.scripting.registerContentScripts([{
        id: SELECTION_SCRIPT_ID, matches: SELECTION_ORIGINS, js: SELECTION_FILES,
        runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
      }]);
      if (!current()) return snapshot(await read());
      settings = await read();
      if (!current()) return snapshot(settings);
      if (!isEnabled(settings)) return await stop(settings, current);
      if (injectExisting && api.tabs?.query && api.scripting?.executeScript) {
        const tabs = await api.tabs.query({});
        if (!current()) return snapshot(await read());
        settings = await read();
        if (!current()) return snapshot(settings);
        if (!isEnabled(settings)) return await stop(settings, current);
        await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id) && supportsSelection(tab.url)).map(tab => api.scripting.executeScript({ target: { tabId: tab.id }, files: SELECTION_FILES })));
        if (!current()) return snapshot(await read());
      }
      settings = await read();
      if (!current()) return snapshot(settings);
      if (!isEnabled(settings)) return await stop(settings, current);
      await broadcast(settings, () => current() && desiredEnabled !== false);
      return snapshot(settings);
    } catch (error) {
      await recoverFailedEnable(expectedRevision).catch(() => {});
      throw error;
    }
  }

  return {
    async setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('划词翻译开关无效。');
      const requestedRevision = ++revision;
      desiredEnabled = enabled;
      if (!enabled) {
        onDisable();
        // Revision checks also cover this eager broadcast's delayed storage read and tab lookup.
        const currentOff = () => requestedRevision === revision && desiredEnabled === false;
        void read().then(settings => {
          if (currentOff()) return broadcast({ ...settings, selectionEnabled: false }, currentOff);
        }).catch(() => {});
      }
      return serialize(async () => {
        if (requestedRevision !== revision) return snapshot(await read());
        try {
          if (enabled && !await api.permissions.contains({ origins: SELECTION_ORIGINS })) {
            throw new Error('请先允许访问网页，再开启划词翻译。');
          }
          const previous = await read();
          if (requestedRevision !== revision) return snapshot(previous);
          await write({ ...previous, selectionEnabled: enabled });
          return await synchronize({ injectExisting: enabled });
        } catch (error) {
          if (enabled) await recoverFailedEnable(requestedRevision).catch(() => {});
          throw error;
        }
      });
    },
    reconcile(options) { return serialize(() => synchronize(options)); },
    broadcast,
    isEnabled,
  };
}
