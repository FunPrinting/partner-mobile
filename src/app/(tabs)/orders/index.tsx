import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from 'react-native';
import { Banner, Button, Card, EmptyState, Pill, Screen } from '@/components/ui';
import { HandoverCodeModal } from '@/components/HandoverCodeModal';
import { codOrderAction } from '@/lib/chat';
import { canBookCourier, fulfilmentLabel, fulfilmentOf, nextStatuses, partnerShare, STATUS_LABEL } from '@/lib/jobLogic';
import { api } from '@/lib/session';
import { space, type, useTheme, type Tone } from '@/theme';

type Order = {
  orderId: string;
  status: string;
  paymentMethod?: 'online' | 'cod';
  paymentStatus?: string;
  amount?: number;
  createdAt: string;
  originalFileName?: string;
  originalFileNames?: string[];
  customerInfo?: { name?: string; phone?: string };
  deliveryOption?: {
    type?: string;
    method?: string;
    deliveryCharge?: number;
    distance?: number;
    partnerDeliveryPoint?: string;
    scheduledSlot?: { date: string; label: string };
  };
  shiprocket?: { awbCode?: string; courierName?: string };
  job?: { printedBy?: { deviceName?: string; printer?: string } };
};

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const DONE = new Set(['completed', 'delivered', 'cancelled', 'refunded']);

function toneFor(status: string): Tone {
  if (status === 'completed' || status === 'delivered') return 'success';
  if (status === 'ready_for_pickup' || status === 'printed' || status === 'pending_cod_approval') return 'warning';
  if (status === 'printing' || status === 'processing') return 'info';
  if (status === 'cancelled' || status === 'refunded') return 'danger';
  return 'neutral';
}

const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OrdersScreen() {
  const { colors } = useTheme();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('open');
  const [handover, setHandover] = useState<Order | null>(null);
  const [codeError, setCodeError] = useState<string>();
  const [codeBusy, setCodeBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ orders?: Order[]; error?: string }>('/api/partner/orders');
      if (!res.ok) throw new Error(res.data.error || `Could not load orders (${res.status})`);
      setOrders(res.data.orders ?? []);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No connection');
    } finally {
      setLoaded(true);
    }
  }, []);

  // Reload whenever the tab is opened
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toApproveCod = useMemo(
    () => orders.filter((o) => o.paymentMethod === 'cod' && o.status === 'pending_cod_approval'),
    [orders]
  );

  const visible = useMemo(
    () => orders.filter((o) => (filter === 'all' ? true : filter === 'done' ? DONE.has(o.status) : !DONE.has(o.status) && o.status !== 'pending_payment')),
    [orders, filter]
  );

  const handleCodAction = async (order: Order, action: 'approve' | 'decline' | 'no_show') => {
    const res = await codOrderAction(order.orderId, action).catch(() => null);
    if (!res?.ok || !res.data.success) {
      Alert.alert('Action failed', res?.data?.error || 'Could not update COD order.');
    } else {
      Alert.alert(
        action === 'approve' ? 'COD Approved' : action === 'no_show' ? 'Marked No-Show' : 'COD Declined',
        action === 'approve'
          ? `Order #${order.orderId} added to print queue.`
          : action === 'no_show'
            ? `Order #${order.orderId} cancelled and future COD disabled for customer.`
            : `COD request #${order.orderId} declined.`
      );
    }
    load();
  };

  const move = async (order: Order, status: string, cashCollected = false) => {
    // Shop delivery: the customer's code proves the handover
    if (status === 'delivered' && fulfilmentOf(order) === 'shop') {
      setCodeError(undefined);
      setHandover(order);
      return;
    }
    if (status === 'completed' && order.paymentMethod === 'cod' && order.paymentStatus !== 'completed' && !cashCollected) {
      Alert.alert(
        `Confirm cash payment for #${order.orderId}`,
        `Ask the customer to scan the Order Summary QR slip to auto-complete, or confirm you collected ₹${Math.round(order.amount || 0)} cash.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: `Cash ₹${Math.round(order.amount || 0)} collected`, onPress: () => void move(order, 'completed', true) },
        ]
      );
      return;
    }
    const body = cashCollected ? { status, cashCollected: true } : { status };
    const res = await api(`/api/partner/orders/${encodeURIComponent(order.orderId)}`, { method: 'PATCH', body }).catch(() => null);
    if (!res?.ok) Alert.alert('Could not update the order', (res?.data as { error?: string })?.error || 'Check your connection and try again.');
    load();
  };

  const submitCode = async (code: string) => {
    if (!handover) return;
    setCodeBusy(true);
    const res = await api<{ error?: string }>(`/api/partner/orders/${encodeURIComponent(handover.orderId)}`, { method: 'PATCH', body: { status: 'delivered', code } }).catch(() => null);
    setCodeBusy(false);
    if (!res?.ok) return setCodeError(res?.data?.error || 'Check your connection and try again.');
    setHandover(null);
    load();
  };

  const bookCourier = (order: Order) => {
    Alert.alert(`Book a courier for ${order.orderId}?`, 'A courier will come to your shop to collect the parcel. Pack it with the order number on it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Book courier',
        onPress: async () => {
          const res = await api<{ error?: string; courierName?: string; awbCode?: string }>(`/api/partner/orders/${encodeURIComponent(order.orderId)}/ship`, { method: 'POST' }).catch(() => null);
          if (!res?.ok) Alert.alert('Could not book the courier', res?.data?.error || 'Check your connection and try again.');
          else Alert.alert('Courier booked', `${res.data.courierName ?? 'Courier'} will collect it. AWB ${res.data.awbCode ?? ''}`);
          load();
        },
      },
    ]);
  };

  const chooseStatus = (order: Order) => {
    if (canBookCourier(order)) return bookCourier(order);
    const next = nextStatuses(order);
    const canNoShow =
      order.paymentMethod === 'cod' &&
      order.paymentStatus !== 'completed' &&
      !DONE.has(order.status) &&
      order.status !== 'pending_cod_approval';

    if (!next.length && !canNoShow) return;
    if (next.length === 1 && !canNoShow) return move(order, next[0]);

    const actions: Array<{ text: string; style?: 'destructive' | 'cancel'; onPress: () => void }> = next.map((s) => ({
      text: STATUS_LABEL[s] ?? s,
      onPress: () => void move(order, s),
    }));
    if (canNoShow) {
      actions.push({
        text: 'Mark No-Show & Block COD',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            `Mark #${order.orderId} as No-Show?`,
            'This cancels the COD order and blocks future Cash on Pickup for this customer.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Mark No-Show', style: 'destructive', onPress: () => void handleCodAction(order, 'no_show') },
            ]
          ),
      });
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Order ${order.orderId}`,
          options: [...actions.map((a) => a.text), 'Cancel'],
          cancelButtonIndex: actions.length,
          destructiveButtonIndex: canNoShow ? actions.length - 1 : undefined,
        },
        (i) => {
          if (i < actions.length) actions[i].onPress();
        }
      );
    } else {
      Alert.alert(`Order ${order.orderId}`, 'Choose an action', [
        ...actions.map((a) => ({ text: a.text, style: a.style, onPress: a.onPress })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="tablist">
        {FILTERS.map((f) => {
          const selected = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={{ minHeight: 36, paddingHorizontal: space.lg, borderRadius: 18, justifyContent: 'center', backgroundColor: selected ? colors.primary : colors.surface, borderWidth: 1, borderColor: selected ? colors.primary : colors.border }}
            >
              <Text style={[type.subhead, { color: selected ? colors.onPrimary : colors.text, fontWeight: '600' }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Banner tone="warning" title="Can't load orders" message={`${error}. Pull down to try again.`} /> : null}

      {toApproveCod.map((o) => (
        <Card key={`cod-${o.orderId}`} tone="warning">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <Text style={[type.headline, { color: colors.text }]}>COD #{o.orderId}</Text>
            <Pill label={`Cash ₹${Math.round(o.amount || 0)}`} tone="warning" />
          </View>
          <Text style={[type.subhead, { color: colors.textSecondary }]}>
            {o.customerInfo?.name || 'Customer'} ({o.customerInfo?.phone || 'no phone'}) · Confirm in Messages tab before printing.
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" title="Decline" onPress={() => handleCodAction(o, 'decline')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Approve & Print" onPress={() => handleCodAction(o, 'approve')} />
            </View>
          </View>
        </Card>
      ))}

      {visible.map((o) => {
        const next = nextStatuses(o);
        const book = canBookCourier(o);
        const canNoShow =
          o.paymentMethod === 'cod' &&
          o.paymentStatus !== 'completed' &&
          !DONE.has(o.status) &&
          o.status !== 'pending_cod_approval';
        const name = o.originalFileName || o.originalFileNames?.[0] || 'Document';
        const files = o.originalFileNames?.length ?? 1;
        return (
          <Pressable
            key={o.orderId}
            onPress={() => chooseStatus(o)}
            disabled={!next.length && !book && !canNoShow}
            accessibilityRole="button"
            accessibilityLabel={`Order ${o.orderId}, ${STATUS_LABEL[o.status] ?? o.status}`}
            accessibilityHint={book ? 'Book the courier pickup' : next.length === 1 ? `Mark as ${STATUS_LABEL[next[0]] ?? next[0]}` : next.length ? 'Change the order status' : undefined}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          >
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
                <Text style={[type.headline, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {o.orderId}
                </Text>
                <View style={{ flexDirection: 'row', gap: space.xs }}>
                  {o.paymentMethod === 'cod' ? (
                    <Pill label={o.paymentStatus === 'completed' ? 'Cash paid' : 'Cash COD'} tone={o.paymentStatus === 'completed' ? 'success' : 'warning'} />
                  ) : null}
                  <Pill label={STATUS_LABEL[o.status] ?? o.status} tone={toneFor(o.status)} />
                </View>
              </View>
              <Text style={[type.callout, { color: colors.text }]} numberOfLines={1}>
                {name}
                {files > 1 ? `  +${files - 1} more` : ''}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.footnote, { color: colors.textTertiary }]}>
                  {o.customerInfo?.name ? `${o.customerInfo.name} · ` : ''}
                  {new Date(o.createdAt).toLocaleDateString()}
                </Text>
                {typeof o.amount === 'number' ? <Text style={[type.footnote, { color: colors.success, fontWeight: '600' }]}>{money(partnerShare(o))} to you</Text> : null}
              </View>
              <Text style={[type.footnote, { color: colors.textSecondary }]}>
                {o.deliveryOption?.partnerDeliveryPoint ? `Point: ${o.deliveryOption.partnerDeliveryPoint}` : fulfilmentLabel(o)}
                {o.deliveryOption?.scheduledSlot?.date ? ` · ${o.deliveryOption.scheduledSlot.date} (${o.deliveryOption.scheduledSlot.label})` : ''}
                {o.job?.printedBy ? ` · Printed on ${[o.job.printedBy.deviceName, o.job.printedBy.printer].filter(Boolean).join(' · ') || 'a shop device'}` : ''}
              </Text>
              {book ? (
                <Text style={[type.footnote, { color: colors.primary }]}>Tap to book the courier pickup</Text>
              ) : next.length === 1 ? (
                <Text style={[type.footnote, { color: colors.primary }]}>Tap to mark {STATUS_LABEL[next[0]] ?? next[0]}</Text>
              ) : next.length ? (
                <Text style={[type.footnote, { color: colors.primary }]}>Tap to update status</Text>
              ) : null}
            </Card>
          </Pressable>
        );
      })}

      {loaded && !visible.length && !error ? (
        <EmptyState
          icon={{ ios: 'doc.text.magnifyingglass', android: 'receipt_long' }}
          title={filter === 'open' ? 'No open orders' : 'No orders here'}
          message="Paid orders for your shop appear here. Pull down to refresh."
        />
      ) : null}

      <HandoverCodeModal key={handover?.orderId ?? 'none'} orderId={handover?.orderId ?? null} error={codeError} busy={codeBusy} onSubmit={submitCode} onClose={() => setHandover(null)} />
    </Screen>
  );
}
