export const SELECTION_ORIGINS = ['http://*/*', 'https://*/*'];

export const RELOAD_PERMISSION_MESSAGE = '当前加载的扩展权限尚未更新。请打开 chrome://extensions，点击 PageLingo 的重新加载按钮，确认版本为 1.1.0 或更新版本，再重新打开此页面开启划词翻译。';

function permissionError(error) {
  if (/Only permissions specified in the manifest may be requested/i.test(error?.message || '')) return new Error(RELOAD_PERMISSION_MESSAGE);
  return error;
}

export function requestSelectionPermission(api = globalThis.chrome) {
  // getManifest reads Chrome's loaded declaration, which can lag behind files on disk.
  // Keep this check synchronous so the actual request remains in the checkbox gesture.
  const manifest = api.runtime.getManifest();
  const declared = [...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])];
  const covers = origin => declared.some(pattern => pattern === origin || pattern === '<all_urls>' || pattern === '*://*/*');
  if (!SELECTION_ORIGINS.every(covers)) throw new Error(RELOAD_PERMISSION_MESSAGE);
  try {
    return api.permissions.request({ origins: [...SELECTION_ORIGINS] }).catch(error => { throw permissionError(error); });
  } catch (error) { throw permissionError(error); }
}
