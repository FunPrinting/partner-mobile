/**
 * The shop's active print jobs from /api/partner/v1/jobs, refreshed on
 * connect, on jobs:available, when the app comes to the foreground and every
 * minute while it is open.
 */
import type { Job } from './jobLogic';
import { api, NotSignedInError } from './session';
import { createStore } from './store';

export type JobsState = { jobs: Job[]; loaded: boolean; lastSyncAt?: number; error?: string };

export const jobsStore = createStore<JobsState>({ jobs: [], loaded: false });

let inflight: Promise<void> | null = null;
let again = false;
const afterSync = new Set<() => void>();

export function onJobsSynced(fn: () => void) {
  afterSync.add(fn);
  return () => afterSync.delete(fn);
}

async function load() {
  try {
    const res = await api<{ jobs?: Job[]; error?: string }>('/api/partner/v1/jobs?scope=active');
    if (!res.ok) throw new Error(res.data.error || `Could not load jobs (${res.status})`);
    jobsStore.set({ jobs: Array.isArray(res.data.jobs) ? res.data.jobs : [], loaded: true, lastSyncAt: Date.now(), error: undefined });
  } catch (err) {
    if (err instanceof NotSignedInError) return;
    jobsStore.set({ loaded: true, error: err instanceof Error && err.message !== 'Network request failed' ? err.message : 'No connection' });
  }
}

/** Single-flight; a call during a sync runs one more sync after it. */
export function syncJobs(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      await load();
      afterSync.forEach((fn) => fn());
    } while (again);
  })().finally(() => (inflight = null));
  return inflight;
}

export async function jobAction(jobId: string, action: 'accept' | 'reject', reason?: string) {
  const res = await api(`/api/partner/v1/jobs/${encodeURIComponent(jobId)}`, {
    method: 'POST',
    body: action === 'reject' ? { action, ...(reason ? { reason: reason.slice(0, 200) } : {}) } : { action },
  });
  syncJobs();
  return res.ok ? { ok: true as const } : { ok: false as const, error: (res.data as any).error || `Request failed (${res.status})` };
}

export function resetJobs() {
  jobsStore.set({ jobs: [], loaded: false, lastSyncAt: undefined, error: undefined });
}
