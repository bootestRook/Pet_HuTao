/** Private browsing or restrictive storage policies must not prevent joining a match. */
export function readStorage(scope: 'local' | 'session', key: string): string | null {
  try { return (scope === 'local' ? localStorage : sessionStorage).getItem(key); } catch { return null; }
}
export function writeStorage(scope: 'local' | 'session', key: string, value: string | null) {
  try {
    const storage = scope === 'local' ? localStorage : sessionStorage;
    if (value === null) storage.removeItem(key); else storage.setItem(key, value);
  } catch { /* The active connection still works; only persistence is unavailable. */ }
}
