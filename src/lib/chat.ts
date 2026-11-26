import { api } from './session';
import { createStore } from './store';

export interface PartnerConversation {
  conversationId: string;
  orderId?: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  pickupPointName?: string;
  scheduledSlot?: { date: string; label: string };
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadPartner: number;
  aiPausedUntil?: string;
  needsHumanAttention?: boolean;
  escalationReason?: string;
  orderSummary?: {
    status: string;
    paymentMethod: 'online' | 'cod';
    paymentStatus: string;
    amount: number;
    deliveryType?: string;
  };
}

export interface ChatMsg {
  _id: string;
  conversationId: string;
  senderType: 'customer' | 'partner' | 'ai_bot' | 'system';
  senderId: string;
  senderName: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface BroadcastItem {
  _id: string;
  pickupPointName: string;
  scheduledDate?: string;
  message: string;
  recipientCount: number;
  emailsSent: number;
  createdAt: string;
}

export const chatStore = createStore<{
  conversations: PartnerConversation[];
  unreadTotal: number;
  escalatedCount: number;
  loaded: boolean;
}>({
  conversations: [],
  unreadTotal: 0,
  escalatedCount: 0,
  loaded: false,
});

const chatListeners = new Set<(payload: { conversationId?: string }) => void>();

export function onIncomingChatEvent(fn: (payload: { conversationId?: string }) => void) {
  chatListeners.add(fn);
  return () => {
    chatListeners.delete(fn);
  };
}

export function emitIncomingChatEvent(payload: { conversationId?: string }) {
  chatListeners.forEach((fn) => fn(payload));
}

export async function refreshConversations(pickupPoint?: string): Promise<PartnerConversation[]> {
  const qs = new URLSearchParams({ role: 'partner' });
  if (pickupPoint && pickupPoint !== '__all__') qs.set('pickupPoint', pickupPoint);
  const res = await api<{
    success?: boolean;
    conversations?: PartnerConversation[];
    unreadTotal?: number;
    error?: string;
  }>(`/api/chat/conversations?${qs.toString()}`);

  if (!res.ok || !res.data.success) {
    throw new Error(res.data.error || `Could not load messages (${res.status})`);
  }

  const list = res.data.conversations ?? [];
  const escalatedCount = list.filter((c) => c.needsHumanAttention).length;
  const unreadTotal = typeof res.data.unreadTotal === 'number'
    ? res.data.unreadTotal
    : list.reduce((s, c) => s + (c.unreadPartner || 0), 0);

  if (!pickupPoint || pickupPoint === '__all__') {
    chatStore.set({ conversations: list, unreadTotal, escalatedCount, loaded: true });
  }
  return list;
}

export async function fetchThreadMessages(conversationId: string, after?: string) {
  const qs = new URLSearchParams({ role: 'partner' });
  if (after) qs.set('after', after);
  return api<{
    success?: boolean;
    messages?: ChatMsg[];
    conversation?: PartnerConversation;
    error?: string;
  }>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?${qs.toString()}`);
}

export async function sendPartnerChatMessage(conversationId: string, body: string) {
  return api<{
    success?: boolean;
    message?: ChatMsg;
    conversation?: PartnerConversation;
    error?: string;
  }>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?role=partner`, {
    method: 'POST',
    body: { body },
  });
}

export async function toggleThreadAi(conversationId: string, action: 'pause' | 'resume' | 'clear_escalation') {
  return api<{ success?: boolean; conversation?: PartnerConversation; error?: string }>(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/ai?role=partner`,
    { method: 'POST', body: { action } }
  );
}

export async function codOrderAction(
  orderId: string,
  action: 'approve' | 'decline' | 'no_show' | 'mark_collected',
  reason?: string
) {
  return api<{ success?: boolean; error?: string }>(
    `/api/partner/orders/${encodeURIComponent(orderId)}/cod`,
    { method: 'POST', body: reason ? { action, reason } : { action } }
  );
}

export async function loadBroadcasts() {
  return api<{
    success?: boolean;
    broadcasts?: BroadcastItem[];
    deliveryPoints?: { name: string }[];
    error?: string;
  }>('/api/partner/broadcasts');
}

export async function previewBroadcastRecipients(pickupPoint: string, date?: string) {
  const qs = new URLSearchParams({ preview: '1', pickupPoint });
  if (date) qs.set('date', date);
  return api<{ success?: boolean; recipientCount?: number }>(`/api/partner/broadcasts?${qs.toString()}`);
}

export async function sendPickupBroadcast(input: { pickupPointName: string; scheduledDate?: string; message: string }) {
  return api<{
    success?: boolean;
    recipientCount?: number;
    emailsSent?: number;
    chatMessagesCreated?: number;
    error?: string;
  }>('/api/partner/broadcasts', { method: 'POST', body: input });
}

export function resetChatStore() {
  chatStore.set({ conversations: [], unreadTotal: 0, escalatedCount: 0, loaded: false });
}
