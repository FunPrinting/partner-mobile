import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text, View } from 'react-native';
import { Banner, Card, EmptyState, Pill, Screen } from '@/components/ui';
import { NEXT_STATUSES, STATUS_LABEL } from '@/lib/jobLogic';
import { api } from '@/lib/session';
import { space, type, useTheme, type Tone } from '@/theme';

type Order = {
  orderId: string;
  status: string;
  amount?: number;
  createdAt: string;
  originalFileName?: string;
  originalFileNames?: string[];
  customerInfo?: { name?: string; phone?: string };
  deliveryOption?: { type?: string };
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
  if (status === 'ready_for_pickup' || status === 'printed') return 'warning';
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

  const visible = useMemo(
    () => orders.filter((o) => (filter === 'all' ? true : filter === 'done' ? DONE.has(o.status) : !DONE.has(o.status) && o.status !== 'pending_payment')),
    [orders, filter]
  );

  const move = async (order: Order, status: string) => {
    const res = await api(`/api/partner/orders/${encodeURIComponent(order.orderId)}`, { method: 'PATCH', body: { status } }).catch(() => null);
    if (!res?.ok) Alert.alert('Could not update the order', (res?.data as any)?.error || 'Check your connection and try again.');
    load();
  };

  const chooseStatus = (order: Order) => {
    const next = NEXT_STATUSES[order.status] ?? [];
    if (!next.length) return;
    const labels = next.map((s) => STATUS_LABEL[s] ?? s);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: `Order ${order.orderId}`, options: [...labels, 'Cancel'], cancelButtonIndex: labels.length }, (i) => {
        if (i < next.length) move(order, next[i]);
      });
    } else {
      Alert.alert(`Order ${order.orderId}`, 'Move this order to', [...next.map((s, i) => ({ text: labels[i], onPress: () => move(order, s) })), { text: 'Cancel', style: 'cancel' as const }]);
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

      {visible.map((o) => {
        const next = NEXT_STATUSES[o.status] ?? [];
        const name = o.originalFileName || o.originalFileNames?.[0] || 'Document';
        const files = o.originalFileNames?.length ?? 1;
        return (
          <Pressable
            key={o.orderId}
            onPress={() => chooseStatus(o)}
            disabled={!next.length}
            accessibilityRole="button"
            accessibilityLabel={`Order ${o.orderId}, ${STATUS_LABEL[o.status] ?? o.status}`}
            accessibilityHint={next.length ? 'Change the order status' : undefined}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          >
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
                <Text style={[type.headline, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {o.orderId}
                </Text>
                <Pill label={STATUS_LABEL[o.status] ?? o.status} tone={toneFor(o.status)} />
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
                {typeof o.amount === 'number' ? <Text style={[type.footnote, { color: colors.success, fontWeight: '600' }]}>{money(o.amount * 0.9)} to you</Text> : null}
              </View>
              {next.length ? <Text style={[type.footnote, { color: colors.primary }]}>Tap to update status</Text> : null}
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
    </Screen>
  );
}
