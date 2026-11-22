/**
 * Socket to the WSS relay. It only signals changes (jobs:available);
 * job data always comes from the web API. The server closes
 * the socket when the 15-minute token expires or the phone is signed out, so
 * each connection attempt asks for a fresh token.
 */
import { io, type Socket } from 'socket.io-client';
import { WSS_URL } from './config';
import { getAccessToken, NotSignedInError, refresh } from './session';
import { createStore } from './store';

export const connectionStore = createStore<{ connected: boolean }>({ connected: false });

let socket: Socket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let onChange: (reason: string) => void = () => {};

function retryAfterRefresh() {
  refresh()
    .then(() => {
      if (retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        socket?.connect();
      }, 2000);
    })
    .catch((err) => {
      if (!(err instanceof NotSignedInError)) setTimeout(() => socket?.connect(), 15_000);
    });
}

export function connect(handler: (reason: string) => void) {
  onChange = handler;
  disconnect();
  socket = io(WSS_URL, {
    transports: ['websocket'],
    auth: (cb) => {
      getAccessToken()
        .then((token) => cb({ token }))
        .catch(() => cb({}));
    },
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30_000,
    timeout: 10_000,
  });
  socket.on('connect', () => {
    connectionStore.set({ connected: true });
    onChange('connected');
  });
  socket.on('disconnect', (reason) => {
    connectionStore.set({ connected: false });
    if (reason === 'io server disconnect') retryAfterRefresh();
  });
  socket.on('connect_error', () => {
    connectionStore.set({ connected: false });
    if (socket && !socket.active) retryAfterRefresh();
  });
  socket.on('jobs:available', () => onChange('jobs:available'));
  socket.on('signed_out', () => {
    refresh().catch(() => undefined);
  });
}

export function disconnect() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  connectionStore.set({ connected: false });
}

/** Pause or resume printing on the shop's desktop app(s). */
export function sendRemoteControl(action: 'pause' | 'resume') {
  if (!socket?.connected) return false;
  socket.emit('remote_control', { action });
  return true;
}
