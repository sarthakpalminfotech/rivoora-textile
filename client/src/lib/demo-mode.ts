import { useSyncExternalStore } from 'react';

/**
 * Sprint 26 — is the server running on the local DEMO database? Read once from the public `/api/health` (so the login
 * screen knows too). Drives the DEMO DATA ribbon, so screenshots can never be mistaken for live data.
 */
let demo = false;
const listeners = new Set<() => void>();

export function loadDemoMode() {
  fetch('/api/health', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { demo?: boolean } | null) => {
      demo = !!j?.demo;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      /* offline / no server: no ribbon */
    });
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => demo,
  );
}
