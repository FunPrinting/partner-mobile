/**
 * Sends errors to the web app's error log (/api/errors → /admin/errors), with the
 * partner token when signed in. Never throws; at most one report per message a
 * minute and 30 an hour.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { WEB_URL } from './config';
import { currentToken } from './session';

const recent = new Map<string, number>();
let sentThisHour = 0;
let hourStart = Date.now();

function allowed(key: string) {
  const now = Date.now();
  if (now - hourStart > 3_600_000) {
    hourStart = now;
    sentThisHour = 0;
    recent.clear();
  }
  if (sentThisHour >= 30) return false;
  const last = recent.get(key);
  if (last && now - last < 60_000) return false;
  recent.set(key, now);
  sentThisHour++;
  return true;
}

export function reportError(error: unknown, opts: { level?: 'error' | 'warning'; context?: Record<string, unknown> } = {}) {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const level = opts.level ?? 'error';
    const message = String(err.message || 'Unknown error').slice(0, 5000);
    if (!allowed(`${level}:${message}`)) return;
    const token = currentToken();
    fetch(`${WEB_URL}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        source: 'mobile',
        level,
        name: err.name,
        message,
        stack: err.stack?.slice(0, 20000),
        appVersion: Constants.expoConfig?.version,
        platform: `${Platform.OS}-${Platform.Version}`.slice(0, 50),
        context: opts.context,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  } catch {
    // reporting must never break the app
  }
}

declare const ErrorUtils: {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
};

let installed = false;
export function installGlobalErrorHandler() {
  if (installed || typeof ErrorUtils === 'undefined') return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error, { context: { fatal: Boolean(isFatal) } });
    previous(error, isFatal);
  });
}
