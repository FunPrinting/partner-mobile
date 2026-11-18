/**
 * Starts and stops the background work for a signed-in phone: socket, job
 * list refreshes and the print station. Runs while the app is in the
 * foreground; when it returns to the foreground everything is refreshed.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { connect, disconnect } from './connection';
import { installGlobalErrorHandler } from './errors';
import { onJobsSynced, resetJobs, syncJobs } from './jobs';
import { runStation } from './printStation';
import { onSignedOut, restore, sessionStore } from './session';
import { settingsStore } from './settings';
import { useStore } from './store';

const POLL_MS = 60_000;
const KEEP_AWAKE_TAG = 'print-station';

let started = false;
let stop: (() => void) | null = null;

function updateKeepAwake() {
  const s = settingsStore.get();
  if (s.mode === 'station' && s.printer && AppState.currentState === 'active') activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
  else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
}

function start() {
  if (stop) return;
  const unsubSynced = onJobsSynced(() => {
    runStation();
  });
  connect(() => {
    syncJobs();
  });
  syncJobs();
  let poll: ReturnType<typeof setInterval> | null = setInterval(() => syncJobs(), POLL_MS);
  const appState = AppState.addEventListener('change', (state) => {
    updateKeepAwake();
    if (state === 'active') {
      connect(() => {
        syncJobs();
      });
      syncJobs();
      if (!poll) poll = setInterval(() => syncJobs(), POLL_MS);
    } else if (state === 'background') {
      // The OS suspends the app soon anyway; drop the socket cleanly
      if (poll) clearInterval(poll);
      poll = null;
      disconnect();
    }
  });
  const unsubSettings = settingsStore.subscribe(() => {
    updateKeepAwake();
    runStation();
  });
  updateKeepAwake();
  stop = () => {
    unsubSynced();
    unsubSettings();
    appState.remove();
    if (poll) clearInterval(poll);
    disconnect();
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    resetJobs();
    stop = null;
  };
}

/** Call once from the root layout. */
export function useAppServices() {
  const session = useStore(sessionStore);
  useEffect(() => {
    if (started) return;
    started = true;
    installGlobalErrorHandler();
    restore();
    onSignedOut(() => stop?.());
  }, []);
  useEffect(() => {
    if (session.status === 'signed-in') start();
    else if (session.status === 'signed-out') stop?.();
  }, [session.status]);
  return session;
}
