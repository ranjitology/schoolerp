/**
 * Thin wrapper around the Tauri v2 bridge.
 *
 * The web build is served from the same Vite bundle that the desktop shell
 * loads, so every cache call has to degrade to "not available" in a browser.
 * Keep this file free of imports from the offline cache: it is the boundary
 * between the web app and the native shell.
 */

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

/** True when the page is running inside the SchoolERP desktop shell. */
export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.__TAURI_INTERNALS__?.invoke === 'function'
  );
}

/**
 * Invokes a native command. Throws a plain `Error` (not `ApiError`) so callers
 * can distinguish a missing desktop from a failed HTTP request.
 */
export async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const bridge = typeof window === 'undefined' ? undefined : window.__TAURI_INTERNALS__;
  if (!bridge?.invoke) {
    throw new Error('The offline cache is only available in the desktop app.');
  }
  return bridge.invoke<T>(command, args);
}
