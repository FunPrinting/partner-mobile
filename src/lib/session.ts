/**
 * Partner sign-in (one-time code + PKCE), token storage and API calls.
 * Server side: FunPrinting-Web docs/PARTNER_AUTH.md.
 *
 * - The browser sign-in returns only a one-time code; tokens are fetched with the
 *   PKCE verifier, so a code intercepted from the redirect is useless.
 * - Tokens live in SecureStore (Keychain / Android Keystore), not restored to a new phone.
 * - Access tokens (15 min) are refreshed a minute before expiry and once on 401.
 *   The refresh token rotates on every use; refreshes are single-flight.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { WEB_URL } from './config';
import { base64ToBase64url, base64url, safeEqual } from './encoding';
import { createStore } from './store';

const KEY = 'fp.session.v2';
const LEGACY_KEYS = ['partnerId', 'token'];
const STORE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const REFRESH_MARGIN_MS = 60_000;
const TIMEOUT_MS = 20_000;

type Tokens = {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt?: number;
  deviceId: string;
  partnerId: string;
};

export type SessionState = { status: 'loading' | 'signed-out' | 'signed-in'; partnerId?: string; deviceId?: string; message?: string };

export const sessionStore = createStore<SessionState>({ status: 'loading' });

export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'NotSignedInError';
  }
}

let tokens: Tokens | null = null;
let refreshing: Promise<string> | null = null;

async function save(next: Tokens | null) {
  tokens = next;
  if (next) await SecureStore.setItemAsync(KEY, JSON.stringify(next), STORE_OPTS);
  else await SecureStore.deleteItemAsync(KEY, STORE_OPTS).catch(() => undefined);
}

async function loadSaved(): Promise<Tokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, STORE_OPTS);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

function fromResponse(data: any): Tokens {
  if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
    throw new Error('Unexpected sign-in response');
  }
  return {
    accessToken: data.access_token,
    accessExpiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 900) * 1000,
    refreshToken: data.refresh_token,
    refreshExpiresAt: data.refresh_token_expires_at ? new Date(data.refresh_token_expires_at).getTime() : undefined,
    deviceId: data.device_id,
    partnerId: data.partner_id,
  };
}

async function postToken(body: object) {
  const res = await fetch(`${WEB_URL}/api/partner/device-auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const signedOutListeners = new Set<(reason: string) => void>();
export function onSignedOut(fn: (reason: string) => void) {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}

async function endSession(reason: string) {
  await save(null);
  sessionStore.set({ status: 'signed-out', partnerId: undefined, deviceId: undefined, message: reason });
  signedOutListeners.forEach((fn) => fn(reason));
}

// ── Startup ─────────────────────────────────────────────────────────────

export async function restore() {
  // Tokens from the earlier app version are not used any more
  await Promise.all(LEGACY_KEYS.map((k) => SecureStore.deleteItemAsync(k).catch(() => undefined)));
  const saved = await loadSaved();
  if (saved && (!saved.refreshExpiresAt || saved.refreshExpiresAt > Date.now())) {
    tokens = saved;
    sessionStore.set({ status: 'signed-in', partnerId: saved.partnerId, deviceId: saved.deviceId, message: undefined });
  } else {
    if (saved) await save(null);
    sessionStore.set({ status: 'signed-out' });
  }
}

// ── Sign-in ─────────────────────────────────────────────────────────────

function callbackUrl() {
  // Expo Go uses exp:// links (accepted by the server in development only)
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? Linking.createURL('callback') : 'funprintingpartner://callback';
}

export async function signIn(): Promise<{ ok: true } | { ok: false; error?: string }> {
  const verifier = base64url(Crypto.getRandomBytes(48));
  const challenge = base64ToBase64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = base64url(Crypto.getRandomBytes(24));
  const callback = callbackUrl();
  const url = new URL(`${WEB_URL}/partner/desktop-auth`);
  url.searchParams.set('callback', callback);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  const result = await WebBrowser.openAuthSessionAsync(url.toString(), callback);
  if (result.type !== 'success') return { ok: false };

  const params = Linking.parse(result.url).queryParams ?? {};
  const code = typeof params.code === 'string' ? params.code : '';
  const returnedState = typeof params.state === 'string' ? params.state : '';
  if (!code || !safeEqual(returnedState, state)) return { ok: false, error: 'The sign-in link was not valid. Please try again.' };

  try {
    const { res, data } = await postToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      device_name: (Constants.deviceName || `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} phone`).slice(0, 100),
      platform: 'mobile',
      app_version: Constants.expoConfig?.version,
    });
    if (!res.ok) return { ok: false, error: data.error_description || 'Sign-in failed. Please try again.' };
    const next = fromResponse(data);
    await save(next);
    sessionStore.set({ status: 'signed-in', partnerId: next.partnerId, deviceId: next.deviceId, message: undefined });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach FunPrinting. Check your internet connection.' };
  }
}

// ── Tokens ──────────────────────────────────────────────────────────────

async function doRefresh(): Promise<string> {
  if (!tokens) throw new NotSignedInError();
  const sent = tokens.refreshToken;
  const { res, data } = await postToken({ grant_type: 'refresh_token', refresh_token: sent });
  if (res.ok) {
    await save(fromResponse(data));
    return tokens!.accessToken;
  }
  if (res.status === 409 && data.error === 'refresh_in_progress') {
    const saved = await loadSaved();
    if (saved && saved.refreshToken !== sent && saved.accessExpiresAt > Date.now()) {
      tokens = saved;
      return saved.accessToken;
    }
    await endSession('Your sign-in was refreshed elsewhere. Please sign in again.');
    throw new NotSignedInError();
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    await endSession(data.error_description || 'Your session has ended. Please sign in again.');
    throw new NotSignedInError();
  }
  throw new Error(`Could not refresh sign-in (${res.status})`);
}

export function refresh(): Promise<string> {
  if (!tokens) return Promise.reject(new NotSignedInError());
  if (!refreshing) refreshing = doRefresh().finally(() => (refreshing = null));
  return refreshing;
}

export async function getAccessToken(): Promise<string> {
  if (!tokens) throw new NotSignedInError();
  if (refreshing) return refreshing;
  if (tokens.accessExpiresAt - Date.now() > REFRESH_MARGIN_MS) return tokens.accessToken;
  return refresh();
}

export function currentToken() {
  return tokens?.accessToken;
}

export function deviceId() {
  return tokens?.deviceId;
}

export type ApiResult<T = any> = { ok: boolean; status: number; data: T };

/** Partner API call with the access token; refreshes once on 401. Network errors throw. */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<ApiResult<T>> {
  const send = async (token: string) => {
    const res = await fetch(`${WEB_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };
  let result = await send(await getAccessToken());
  if (result.status === 401 && tokens) result = await send(await refresh());
  return result;
}

export async function signOut() {
  if (!tokens) return;
  try {
    // Revoke this device so its tokens can't be used again
    await api('/api/partner/devices', { method: 'DELETE', body: { deviceId: tokens.deviceId }, timeoutMs: 5000 });
  } catch {
    // offline: sign out locally anyway
  }
  await endSession('Signed out on this phone.');
}
