import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Banner, Body, Button, Card, Field, Icon, Row, Screen, Section, Stat, SwitchRow } from '@/components/ui';
import { api } from '@/lib/session';
import { space, type, useTheme } from '@/theme';

type Point = { latitude: number; longitude: number };
type DeliveryPoint = { name: string; contactNumber: string; location: Point };
type Profile = {
  businessName?: string;
  isActive?: boolean;
  isOnline?: boolean;
  acceptanceMode?: 'auto' | 'manual';
  pricing?: { perPageBW?: number; perPageColor?: number; binding?: number };
  phoneNumbers?: string[];
  location?: { coordinates?: [number, number] };
  address?: Record<string, string>;
  deliveryPoints?: { name: string; contactNumber?: string; location?: { coordinates?: [number, number] } }[];
};
type Financials = { todayEarnings: number; totalEarnings: number; completedOrdersCount: number };

const DEFAULT_POINT: Point = { latitude: 28.6139, longitude: 77.209 };
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const toPoint = (c?: [number, number]): Point | null => (c && c.length === 2 && (c[0] || c[1]) ? { latitude: c[1], longitude: c[0] } : null);

export default function ShopScreen() {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [financials, setFinancials] = useState<Financials | null>(null);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Form state
  const [isOnline, setIsOnline] = useState(false);
  const [manual, setManual] = useState(false);
  const [price, setPrice] = useState({ bw: '', color: '', binding: '' });
  const [phones, setPhones] = useState<string[]>([]);
  const [location, setLocation] = useState<Point>(DEFAULT_POINT);
  const [points, setPoints] = useState<DeliveryPoint[]>([]);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([api<{ partner?: Profile }>('/api/partner/profile'), api<{ financials?: Financials }>('/api/partner/financials')]);
      if (!p.ok || !p.data.partner) throw new Error('Could not load your shop');
      const partner = p.data.partner;
      setProfile(partner);
      setFinancials(f.ok ? f.data.financials ?? null : null);
      setIsOnline(Boolean(partner.isOnline));
      setManual(partner.acceptanceMode === 'manual');
      setPrice({
        bw: String(partner.pricing?.perPageBW ?? ''),
        color: String(partner.pricing?.perPageColor ?? ''),
        binding: String(partner.pricing?.binding ?? ''),
      });
      setPhones(partner.phoneNumbers ?? []);
      setLocation(toPoint(partner.location?.coordinates) ?? DEFAULT_POINT);
      setPoints(
        (partner.deliveryPoints ?? []).map((d) => ({ name: d.name, contactNumber: d.contactNumber ?? '', location: toPoint(d.location?.coordinates) ?? DEFAULT_POINT }))
      );
      setDirty(false);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No connection');
    }
  }, []);

  // Reload whenever the tab is opened
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const useGps = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location not allowed', 'Tap the map to place your shop instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      edit(setLocation)({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      Alert.alert('Could not get your location', 'Tap the map to place your shop instead.');
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    const num = (s: string, fallback: number) => {
      const n = parseFloat(s);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    setSaving(true);
    const res = await api('/api/partner/profile', {
      method: 'POST',
      body: {
        isOnline,
        acceptanceMode: manual ? 'manual' : 'auto',
        pricing: { perPageBW: num(price.bw, 2), perPageColor: num(price.color, 10), binding: num(price.binding, 40) },
        phoneNumbers: phones.map((p) => p.trim()).filter(Boolean),
        location: { type: 'Point', coordinates: [location.longitude, location.latitude] },
        // The server replaces the address whenever the location is sent
        address: profile?.address,
        deliveryPoints: points
          .filter((d) => d.name.trim())
          .map((d) => ({ name: d.name.trim(), contactNumber: d.contactNumber.trim(), location: { type: 'Point', coordinates: [d.location.longitude, d.location.latitude] } })),
      },
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      Alert.alert('Could not save', (res?.data as any)?.error || 'Check your connection and try again.');
      return;
    }
    await load();
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
      {error ? <Banner tone="warning" title={error} message="Pull down to try again." /> : null}
      {profile && !profile.isActive ? <Banner tone="info" title="Waiting for approval" message="FunPrinting is reviewing your shop. You can go online once it is approved." /> : null}

      {financials ? (
        <Card>
          <Text style={[type.footnote, { color: colors.textTertiary }]}>Your share (90%)</Text>
          <View style={{ flexDirection: 'row', gap: space.lg }}>
            <Stat label="Today" value={money(financials.todayEarnings || 0)} />
            <Stat label="All time" value={money(financials.totalEarnings || 0)} />
            <Stat label="Orders" value={String(financials.completedOrdersCount ?? 0)} />
          </View>
        </Card>
      ) : null}

      {profile ? (
        <>
          <Section title={profile.businessName || 'Shop'}>
            <Card>
              <SwitchRow first title="Taking orders" subtitle="Show your shop to customers nearby" value={isOnline} onValueChange={edit(setIsOnline)} disabled={!profile.isActive} />
              <SwitchRow title="Accept each order first" subtitle="Off: paid orders print automatically" value={manual} onValueChange={edit(setManual)} />
            </Card>
          </Section>

          <Section title="Prices (₹)" footer="Customers pay these plus a 3% processing fee.">
            <Card>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Field label="B&W page" keyboardType="decimal-pad" value={price.bw} onChangeText={(v) => edit(setPrice)({ ...price, bw: v })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Colour page" keyboardType="decimal-pad" value={price.color} onChangeText={(v) => edit(setPrice)({ ...price, color: v })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Binding" keyboardType="decimal-pad" value={price.binding} onChangeText={(v) => edit(setPrice)({ ...price, binding: v })} />
                </View>
              </View>
            </Card>
          </Section>

          <Section
            title="Phone numbers"
            footer="Shown to customers who order from you."
            action={<Button variant="plain" title="Add" onPress={() => edit(setPhones)([...phones, ''])} style={{ minHeight: 32, paddingHorizontal: 0 }} />}
          >
            <Card>
              {phones.length ? (
                phones.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field label={`Phone ${i + 1}`} keyboardType="phone-pad" placeholder="+91 98765 43210" value={p} onChangeText={(v) => edit(setPhones)(phones.map((x, j) => (j === i ? v : x)))} />
                    </View>
                    <RemoveButton label={`Remove phone ${i + 1}`} onPress={() => edit(setPhones)(phones.filter((_, j) => j !== i))} />
                  </View>
                ))
              ) : (
                <Body tone="tertiary">No phone numbers yet.</Body>
              )}
            </Card>
          </Section>

          <Section title="Location" footer="Tap the map or drag the pin to your shop's entrance.">
            <Card style={{ padding: 0 }}>
              <MapView
                style={{ height: 260 }}
                region={{ ...location, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                onPress={(e) => edit(setLocation)(e.nativeEvent.coordinate)}
                accessibilityLabel="Shop location map"
              >
                <Marker coordinate={location} draggable onDragEnd={(e) => edit(setLocation)(e.nativeEvent.coordinate)} />
              </MapView>
              <View style={{ padding: space.md }}>
                <Button variant="secondary" title="Use my current location" icon={{ ios: 'location.fill', android: 'my_location' }} onPress={useGps} loading={locating} />
              </View>
            </Card>
          </Section>

          <Section
            title="Delivery points"
            footer="Places where you hand over delivery orders. New points start at the shop's location."
            action={<Button variant="plain" title="Add" onPress={() => edit(setPoints)([...points, { name: '', contactNumber: '', location }])} style={{ minHeight: 32, paddingHorizontal: 0 }} />}
          >
            {points.length ? (
              points.map((d, i) => (
                <Card key={i}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field label="Name" placeholder="Campus gate" value={d.name} onChangeText={(v) => edit(setPoints)(points.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                    </View>
                    <RemoveButton label={`Remove ${d.name || 'delivery point'}`} onPress={() => edit(setPoints)(points.filter((_, j) => j !== i))} />
                  </View>
                  <Field label="Contact number (optional)" keyboardType="phone-pad" value={d.contactNumber} onChangeText={(v) => edit(setPoints)(points.map((x, j) => (j === i ? { ...x, contactNumber: v } : x)))} />
                  <Row title="Set to the shop's map pin" subtitle={`${d.location.latitude.toFixed(5)}, ${d.location.longitude.toFixed(5)}`} onPress={() => edit(setPoints)(points.map((x, j) => (j === i ? { ...x, location } : x)))} />
                </Card>
              ))
            ) : (
              <Card>
                <Body tone="tertiary">No delivery points yet.</Body>
              </Card>
            )}
          </Section>

          <Button title={dirty ? 'Save changes' : 'Saved'} onPress={save} loading={saving} disabled={!dirty} />
        </>
      ) : null}
    </Screen>
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={{ ios: 'minus.circle.fill', android: 'remove_circle' }} size={22} color={colors.danger} />
    </Pressable>
  );
}
