export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem('ekt-session-id');
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem('ekt-session-id', created);
    return created;
  } catch {
    return globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
