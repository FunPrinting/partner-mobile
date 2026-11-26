import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Banner, Body, Button, Card, EmptyState, Field, Pill, Screen, Section } from '@/components/ui';
import {
  codOrderAction,
  fetchThreadMessages,
  loadBroadcasts,
  onIncomingChatEvent,
  previewBroadcastRecipients,
  refreshConversations,
  sendPartnerChatMessage,
  sendPickupBroadcast,
  toggleThreadAi,
  type BroadcastItem,
  type ChatMsg,
  type PartnerConversation,
} from '@/lib/chat';
import { radius, space, TOUCH, type, useTheme } from '@/theme';

type TabMode = 'inbox' | 'broadcast';

const QUICK_TEMPLATES = [
  { label: 'On the way (15m)', text: 'On the way to {point} with your orders, reaching in ~15 minutes.' },
  { label: 'Reached point', text: 'Reached {point}! Come collect your printed orders now.' },
  { label: 'Leaving (10m)', text: 'Leaving {point} in 10 minutes — please collect your order soon!' },
];

export default function MessagesScreen() {
  const { colors } = useTheme();
  const [tab, setTab] = useState<TabMode>('inbox');

  // ── Inbox State ─────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<PartnerConversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [convError, setConvError] = useState<string>();
  const [pointFilter, setPointFilter] = useState<string>('__all__');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Thread State ────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // ── Broadcast State ─────────────────────────────────────────────────
  const [points, setPoints] = useState<{ name: string }[]>([]);
  const [bpPoint, setBpPoint] = useState('');
  const [bpDate, setBpDate] = useState('');
  const [bpMessage, setBpMessage] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const loadAll = useCallback(async () => {
    try {
      const [list, bp] = await Promise.all([
        refreshConversations(pointFilter),
        loadBroadcasts().catch(() => null),
      ]);
      setNow(Date.now());
      setConversations(list);
      setConvError(undefined);
      if (bp?.ok && bp.data.success) {
        setBroadcasts(bp.data.broadcasts ?? []);
        const pts = bp.data.deliveryPoints ?? [];
        setPoints(pts);
        setBpPoint((prev) => (prev && pts.some((p) => p.name === prev) ? prev : pts[0]?.name || ''));
      }
    } catch (err) {
      setConvError(err instanceof Error ? err.message : 'Could not load messages');
    } finally {
      setLoadingConvs(false);
    }
  }, [pointFilter]);

  useFocusEffect(
    useCallback(() => {
      void loadAll();
    }, [loadAll])
  );

  const loadThread = useCallback(async (conversationId: string) => {
    try {
      const res = await fetchThreadMessages(conversationId);
      setNow(Date.now());
      if (res.ok && res.data.success && Array.isArray(res.data.messages)) {
        setMessages(res.data.messages);
        if (res.data.conversation) {
          setConversations((prev) =>
            prev.map((c) => (c.conversationId === conversationId ? { ...c, ...res.data.conversation! } : c))
          );
        }
      }
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void fetchThreadMessages(selectedId).then((res) => {
      if (cancelled) return;
      setNow(Date.now());
      setLoadingThread(false);
      if (res.ok && res.data.success && Array.isArray(res.data.messages)) {
        setMessages(res.data.messages);
        if (res.data.conversation) {
          setConversations((prev) =>
            prev.map((c) => (c.conversationId === selectedId ? { ...c, ...res.data.conversation! } : c))
          );
        }
      }
    });
    const t = setInterval(() => void loadThread(selectedId), 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selectedId, loadThread]);

  useEffect(() => {
    return onIncomingChatEvent((payload) => {
      void loadAll();
      if (selectedId && (!payload.conversationId || payload.conversationId === selectedId)) {
        void loadThread(selectedId);
      }
    });
  }, [selectedId, loadAll, loadThread]);

  useEffect(() => {
    if (!bpPoint) return;
    let stale = false;
    previewBroadcastRecipients(bpPoint, bpDate.trim() || undefined)
      .then((res) => {
        if (!stale && res.ok && res.data.success) setPreviewCount(res.data.recipientCount ?? 0);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [bpPoint, bpDate]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.conversationId === selectedId) ?? null,
    [conversations, selectedId]
  );

  const aiPausedUntilMs = activeConv?.aiPausedUntil ? new Date(activeConv.aiPausedUntil).getTime() : 0;
  useEffect(() => {
    if (!aiPausedUntilMs) return;
    const delay = Math.max(0, aiPausedUntilMs - Date.now()) + 50;
    const t = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(t);
  }, [aiPausedUntilMs]);

  const isAiPaused = Boolean(aiPausedUntilMs && aiPausedUntilMs > now);

  const handleSend = async () => {
    const body = draft.trim();
    if (!activeConv || !body || sending) return;
    setSending(true);
    try {
      const res = await sendPartnerChatMessage(activeConv.conversationId, body);
      if (!res.ok || !res.data.success) {
        throw new Error(res.data.error || 'Could not send message');
      }
      setDraft('');
      await loadThread(activeConv.conversationId);
      void loadAll();
    } catch (err) {
      Alert.alert('Could not send', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSending(false);
    }
  };

  const handleCod = async (orderId: string, action: 'approve' | 'decline') => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const res = await codOrderAction(orderId, action);
      if (!res.ok || !res.data.success) {
        throw new Error(res.data.error || `Could not ${action} COD order`);
      }
      Alert.alert(
        action === 'approve' ? 'COD Approved' : 'COD Declined',
        action === 'approve' ? `Order #${orderId} moved to your print queue.` : `Order #${orderId} was declined.`
      );
      if (selectedId) await loadThread(selectedId);
      await loadAll();
    } catch (err) {
      Alert.alert('Action failed', err instanceof Error ? err.message : 'Check connection.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleAi = async () => {
    if (!activeConv || actionBusy) return;
    setActionBusy(true);
    try {
      const res = await toggleThreadAi(activeConv.conversationId, isAiPaused ? 'resume' : 'pause');
      if (!res.ok || !res.data.success) throw new Error(res.data.error || 'Could not update AI');
      await loadAll();
    } catch (err) {
      Alert.alert('Could not update AI', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSendBroadcast = async () => {
    if (!bpPoint || !bpMessage.trim() || sendingBroadcast) return;
    setSendingBroadcast(true);
    try {
      const res = await sendPickupBroadcast({
        pickupPointName: bpPoint,
        ...(bpDate.trim() ? { scheduledDate: bpDate.trim() } : {}),
        message: bpMessage.trim(),
      });
      if (!res.ok || !res.data.success) {
        throw new Error(res.data.error || 'Could not send broadcast');
      }
      Alert.alert(
        'Broadcast Sent',
        `Notified ${res.data.recipientCount ?? 0} order(s) (${res.data.emailsSent ?? 0} email, ${res.data.chatMessagesCreated ?? 0} chat).`
      );
      setBpMessage('');
      await loadAll();
    } catch (err) {
      Alert.alert('Broadcast failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSendingBroadcast(false);
    }
  };

  // ── Active Conversation Thread View ─────────────────────────────────
  if (activeConv) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <View style={{ padding: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
            <Button variant="plain" title="‹ Inbox" onPress={() => setSelectedId(null)} style={{ minHeight: 36, paddingHorizontal: 4 }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: colors.text }]} numberOfLines={1}>
                {activeConv.customerName}
              </Text>
              <Text style={[type.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                {activeConv.orderId ? `#${activeConv.orderId} · ` : ''}
                {activeConv.customerPhone || activeConv.customerEmail}
              </Text>
            </View>
            <Button
              variant="secondary"
              title={isAiPaused ? 'Resume AI' : 'Pause AI'}
              onPress={handleToggleAi}
              disabled={actionBusy}
              style={{ minHeight: 34, paddingHorizontal: space.md }}
            />
          </View>

          {activeConv.needsHumanAttention ? (
            <Banner
              tone="danger"
              title="Needs your reply"
              message={`${activeConv.escalationReason || 'Escalated for partner review'}. Replying pauses AI automatically.`}
            />
          ) : null}

          {activeConv.orderId &&
          activeConv.orderSummary?.paymentMethod === 'cod' &&
          activeConv.orderSummary?.status === 'pending_cod_approval' ? (
            <Card tone="warning" style={{ padding: space.md, gap: space.sm }}>
              <Text style={[type.subhead, { color: colors.text, fontWeight: '600' }]}>
                Cash on Pickup · ₹{Math.round(activeConv.orderSummary.amount || 0)} due at pickup
              </Text>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    variant="secondary"
                    title="Decline COD"
                    onPress={() => handleCod(activeConv.orderId!, 'decline')}
                    disabled={actionBusy}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Approve & Print"
                    onPress={() => handleCod(activeConv.orderId!, 'approve')}
                    loading={actionBusy}
                  />
                </View>
              </View>
            </Card>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.md, gap: space.sm }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingThread ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          ) : messages.length === 0 ? (
            <Body tone="tertiary">No messages yet.</Body>
          ) : (
            messages.map((m) => {
              if (m.senderType === 'system') {
                return (
                  <View
                    key={m._id}
                    style={{
                      alignSelf: 'center',
                      maxWidth: '92%',
                      borderRadius: radius.md,
                      padding: space.sm,
                      backgroundColor: colors.primarySoft,
                    }}
                  >
                    <Text style={[type.caption, { color: colors.primary, fontWeight: '600' }]}>{m.senderName}</Text>
                    <Text style={[type.subhead, { color: colors.text }]}>{m.body}</Text>
                  </View>
                );
              }
              const own = m.senderType === 'partner' || m.senderType === 'ai_bot';
              return (
                <View key={m._id} style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '82%', gap: 2 }}>
                  <Text style={[type.caption, { color: colors.textTertiary, textAlign: own ? 'right' : 'left' }]}>
                    {m.senderType === 'ai_bot' ? `${m.senderName} (AI)` : own ? 'You' : m.senderName} ·{' '}
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <View
                    style={{
                      borderRadius: radius.lg,
                      paddingHorizontal: space.md,
                      paddingVertical: space.sm,
                      backgroundColor: own ? colors.primary : colors.surface,
                      borderWidth: own ? 0 : 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text style={[type.body, { color: own ? colors.onPrimary : colors.text }]}>{m.body}</Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: space.sm,
            padding: space.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Reply to customer…"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={2000}
            style={{
              flex: 1,
              minHeight: TOUCH,
              maxHeight: 110,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surfaceMuted,
              color: colors.text,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
            }}
          />
          <Button
            title={sending ? '...' : 'Send'}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            style={{ paddingHorizontal: space.lg }}
          />
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await loadAll();
        setRefreshing(false);
      }}
    >
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(['inbox', 'broadcast'] as const).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={{
                minHeight: 36,
                paddingHorizontal: space.lg,
                borderRadius: 18,
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text style={[type.subhead, { color: active ? colors.onPrimary : colors.text, fontWeight: '600' }]}>
                {t === 'inbox' ? `Customer Chat (${conversations.length})` : 'Pickup Broadcast'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {convError ? <Banner tone="warning" title="Sync issue" message={convError} /> : null}

      {tab === 'inbox' ? (
        <>
          {points.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
              {[{ name: '__all__', label: 'All locations' }, ...points.map((p) => ({ name: p.name, label: p.name }))].map((pt) => {
                const active = pointFilter === pt.name;
                return (
                  <Pressable
                    key={pt.name}
                    onPress={() => setPointFilter(pt.name)}
                    style={{
                      paddingHorizontal: space.md,
                      paddingVertical: 6,
                      borderRadius: radius.pill,
                      backgroundColor: active ? colors.primarySoft : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={[type.caption, { color: active ? colors.primary : colors.textSecondary, fontWeight: '600' }]}>
                      {pt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {loadingConvs ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={{ ios: 'bubble.left.and.bubble.right', android: 'chat' }}
              title="No customer chats yet"
              message="Customer questions, COD confirmations, and AI handoffs appear here."
            />
          ) : (
            conversations.map((c) => (
              <Pressable
                key={c.conversationId}
                onPress={() => {
                  setLoadingThread(true);
                  setMessages([]);
                  setSelectedId(c.conversationId);
                }}
              >
                <Card tone={c.needsHumanAttention ? 'danger' : c.orderSummary?.status === 'pending_cod_approval' ? 'warning' : undefined}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.xs }}>
                    <Text style={[type.headline, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {c.customerName}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: space.xs }}>
                      {c.needsHumanAttention ? <Pill label="Needs reply" tone="danger" /> : null}
                      {c.orderSummary?.status === 'pending_cod_approval' ? <Pill label="COD Approval" tone="warning" /> : null}
                      {c.unreadPartner > 0 ? <Pill label={`${c.unreadPartner} new`} tone="info" /> : null}
                    </View>
                  </View>
                  <Text style={[type.caption, { color: colors.textTertiary }]}>
                    {c.orderId ? `#${c.orderId}` : 'General shop chat'}
                    {c.pickupPointName ? ` · ${c.pickupPointName}` : ''}
                    {c.scheduledSlot?.date ? ` · ${c.scheduledSlot.date} ${c.scheduledSlot.label}` : ''}
                  </Text>
                  <Text style={[type.subhead, { color: colors.textSecondary }]} numberOfLines={2}>
                    {c.lastMessagePreview}
                  </Text>
                </Card>
              </Pressable>
            ))
          )}
        </>
      ) : (
        <>
          <Section title="Send pickup-point broadcast" footer="Delivers instantly to active pickup orders via In-App Chat and Email.">
            {points.length === 0 ? (
              <Card>
                <Body tone="tertiary">Add a delivery/pickup point in the Shop tab to send pickup-point broadcasts.</Body>
              </Card>
            ) : (
              <Card>
                <Text style={[type.footnote, { color: colors.textSecondary }]}>Pickup point</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  {points.map((pt) => {
                    const active = bpPoint === pt.name;
                    return (
                      <Pressable
                        key={pt.name}
                        onPress={() => setBpPoint(pt.name)}
                        style={{
                          paddingHorizontal: space.md,
                          paddingVertical: 6,
                          borderRadius: radius.pill,
                          backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                        }}
                      >
                        <Text style={[type.caption, { color: active ? colors.primary : colors.text, fontWeight: '600' }]}>
                          {pt.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Field
                  label="Scheduled date (optional YYYY-MM-DD)"
                  placeholder="Leave blank for all active dates"
                  value={bpDate}
                  onChangeText={setBpDate}
                />

                <Text style={[type.caption, { color: colors.primary, fontWeight: '600' }]}>
                  {!bpPoint || previewCount === null ? 'Checking active orders…' : `${previewCount} active order(s) will be notified`}
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  {QUICK_TEMPLATES.map((tpl) => (
                    <Pressable
                      key={tpl.label}
                      onPress={() => bpPoint && setBpMessage(tpl.text.replace(/\{point\}/g, bpPoint))}
                      style={{
                        paddingHorizontal: space.sm,
                        paddingVertical: 5,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceMuted,
                      }}
                    >
                      <Text style={[type.caption, { color: colors.text }]}>{tpl.label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Field
                  label="Announcement message"
                  placeholder="Write your arrival or pickup announcement…"
                  value={bpMessage}
                  onChangeText={setBpMessage}
                  multiline
                  maxLength={1000}
                  style={{ minHeight: 72, textAlignVertical: 'top', paddingTop: space.sm }}
                />

                <Button
                  title="Send broadcast"
                  onPress={handleSendBroadcast}
                  loading={sendingBroadcast}
                  disabled={!bpPoint || bpMessage.trim().length < 3 || sendingBroadcast}
                />
              </Card>
            )}
          </Section>

          {broadcasts.length > 0 ? (
            <Section title="Recent broadcasts">
              <Card>
                {broadcasts.slice(0, 6).map((b, i) => (
                  <View
                    key={b._id}
                    style={{
                      paddingTop: i === 0 ? 0 : space.sm,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                      gap: 2,
                    }}
                  >
                    <Text style={[type.footnote, { color: colors.text, fontWeight: '600' }]}>
                      {b.pickupPointName} · {b.recipientCount} notified
                    </Text>
                    <Text style={[type.caption, { color: colors.textSecondary }]}>{b.message}</Text>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
