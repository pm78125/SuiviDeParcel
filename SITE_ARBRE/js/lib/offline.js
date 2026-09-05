const CACHE_KEY = 'treetracker_snapshot_v1';

export function isOnline() {
  return navigator.onLine;
}

export function onConnectivityChange(cb) {
  window.addEventListener('online', () => cb(true));
  window.addEventListener('offline', () => cb(false));
}

export function cacheSnapshot(payload) {
  try {
    const data = {
      savedAt: new Date().toISOString(),
      ...payload,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Cache offline saturé', e);
  }
}

export function loadSnapshot() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (e) {
    console.warn('SW non enregistré', e);
    return null;
  }
}
