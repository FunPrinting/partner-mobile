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
  servicesOffered?: {
    printing?: {
      enabled?: boolean;
      maxPaperSize?: 'a4' | 'a3' | 'letter' | 'legal';
      supportsColor?: boolean;
      supportsBlackAndWhite?: boolean;
      supportsDoubleSided?: boolean;
    };
    binding?: {
      enabled?: boolean;
      types?: { spiral?: boolean; perfect?: boolean; staple?: boolean };
    };
    lamination?: {
      enabled?: boolean;
      maxSize?: 'a4' | 'a3';
    };
    scanning?: { enabled?: boolean };
    photocopying?: { enabled?: boolean; supportsColor?: boolean };
    plasticFiles?: { enabled?: boolean };
    delivery?: {
      enabled?: boolean;
    };
  };
  delivery?: {
    courier?: { enabled?: boolean };
    self?: { enabled?: boolean; radiusKm?: number; fee?: number; etaMinutes?: number };
  };
  pricing?: {
    printing?: {
      a4?: {
        blackAndWhite?: { singleSided?: number; doubleSided?: number };
        color?: { singleSided?: number; doubleSided?: number };
      };
      a3?: {
        blackAndWhite?: { singleSided?: number; doubleSided?: number };
        color?: { singleSided?: number; doubleSided?: number };
      };
    };
    binding?: { spiral?: number; perfect?: number; staple?: number };
    lamination?: { a4?: number; a3?: number };
    scanning?: number;
    photocopying?: { blackAndWhite?: number; color?: number };
    plasticFiles?: number;
  };
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
  
  // Printing service
  const [printingEnabled, setPrintingEnabled] = useState(true);
  const [maxPaperSize, setMaxPaperSize] = useState<'a4' | 'a3' | 'letter' | 'legal'>('a4');
  const [supportsColor, setSupportsColor] = useState(true);
  const [supportsBW, setSupportsBW] = useState(true);
  const [supportsDuplex, setSupportsDuplex] = useState(false);
  
  // Printing prices
  const [priceA4, setPriceA4] = useState({ bwSingle: '', bwDouble: '', colorSingle: '', colorDouble: '' });
  const [priceA3, setPriceA3] = useState({ bwSingle: '', bwDouble: '', colorSingle: '', colorDouble: '' });
  
  // Binding service
  const [bindingEnabled, setBindingEnabled] = useState(false);
  const [bindingTypes, setBindingTypes] = useState({ spiral: false, perfect: false, staple: false });
  const [bindingPrices, setBindingPrices] = useState({ spiral: '', perfect: '', staple: '' });
  
  // Other services
  const [laminationEnabled, setLaminationEnabled] = useState(false);
  const [laminationMaxSize, setLaminationMaxSize] = useState<'a4' | 'a3'>('a4');
  const [laminationPrices, setLaminationPrices] = useState({ a4: '', a3: '' });
  
  const [scanningEnabled, setScanningEnabled] = useState(false);
  const [scanningPrice, setScanningPrice] = useState('');
  
  const [photocopyingEnabled, setPhotocopyingEnabled] = useState(false);
  const [photocopyingColor, setPhotocopyingColor] = useState(false);
  const [photocopyingPrices, setPhotocopyingPrices] = useState({ bw: '', color: '' });
  
  const [plasticFilesEnabled, setPlasticFilesEnabled] = useState(false);
  const [plasticFilesPrice, setPlasticFilesPrice] = useState('');
  
  const [deliverySelfEnabled, setDeliverySelfEnabled] = useState(false);
  const [deliveryRadius, setDeliveryRadius] = useState('3');
  const [deliveryFee, setDeliveryFee] = useState('30');
  const [deliveryEta, setDeliveryEta] = useState('120');
  const [deliveryCourierEnabled, setDeliveryCourierEnabled] = useState(false);
  
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
      
      // Printing service
      setPrintingEnabled(partner.servicesOffered?.printing?.enabled ?? true);
      setMaxPaperSize(partner.servicesOffered?.printing?.maxPaperSize ?? 'a4');
      setSupportsColor(partner.servicesOffered?.printing?.supportsColor ?? true);
      setSupportsBW(partner.servicesOffered?.printing?.supportsBlackAndWhite ?? true);
      setSupportsDuplex(partner.servicesOffered?.printing?.supportsDoubleSided ?? false);
      
      // Printing prices
      setPriceA4({
        bwSingle: String(partner.pricing?.printing?.a4?.blackAndWhite?.singleSided ?? ''),
        bwDouble: String(partner.pricing?.printing?.a4?.blackAndWhite?.doubleSided ?? ''),
        colorSingle: String(partner.pricing?.printing?.a4?.color?.singleSided ?? ''),
        colorDouble: String(partner.pricing?.printing?.a4?.color?.doubleSided ?? ''),
      });
      setPriceA3({
        bwSingle: String(partner.pricing?.printing?.a3?.blackAndWhite?.singleSided ?? ''),
        bwDouble: String(partner.pricing?.printing?.a3?.blackAndWhite?.doubleSided ?? ''),
        colorSingle: String(partner.pricing?.printing?.a3?.color?.singleSided ?? ''),
        colorDouble: String(partner.pricing?.printing?.a3?.color?.doubleSided ?? ''),
      });
      
      // Binding service
      setBindingEnabled(partner.servicesOffered?.binding?.enabled ?? false);
      setBindingTypes({
        spiral: partner.servicesOffered?.binding?.types?.spiral ?? false,
        perfect: partner.servicesOffered?.binding?.types?.perfect ?? false,
        staple: partner.servicesOffered?.binding?.types?.staple ?? false,
      });
      setBindingPrices({
        spiral: String(partner.pricing?.binding?.spiral ?? ''),
        perfect: String(partner.pricing?.binding?.perfect ?? ''),
        staple: String(partner.pricing?.binding?.staple ?? ''),
      });
      
      // Other services
      setLaminationEnabled(partner.servicesOffered?.lamination?.enabled ?? false);
      setLaminationMaxSize(partner.servicesOffered?.lamination?.maxSize ?? 'a4');
      setLaminationPrices({
        a4: String(partner.pricing?.lamination?.a4 ?? ''),
        a3: String(partner.pricing?.lamination?.a3 ?? ''),
      });
      
      setScanningEnabled(partner.servicesOffered?.scanning?.enabled ?? false);
      setScanningPrice(String(partner.pricing?.scanning ?? ''));
      
      setPhotocopyingEnabled(partner.servicesOffered?.photocopying?.enabled ?? false);
      setPhotocopyingColor(partner.servicesOffered?.photocopying?.supportsColor ?? false);
      setPhotocopyingPrices({
        bw: String(partner.pricing?.photocopying?.blackAndWhite ?? ''),
        color: String(partner.pricing?.photocopying?.color ?? ''),
      });
      
      setPlasticFilesEnabled(partner.servicesOffered?.plasticFiles?.enabled ?? false);
      setPlasticFilesPrice(String(partner.pricing?.plasticFiles ?? ''));
      
      setDeliverySelfEnabled(partner.delivery?.self?.enabled ?? partner.servicesOffered?.delivery?.enabled ?? false);
      setDeliveryRadius(String(partner.delivery?.self?.radiusKm ?? 3));
      setDeliveryFee(String(partner.delivery?.self?.fee ?? 30));
      setDeliveryEta(String(partner.delivery?.self?.etaMinutes ?? 120));
      setDeliveryCourierEnabled(partner.delivery?.courier?.enabled ?? false);
      
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
        servicesOffered: {
          printing: {
            enabled: printingEnabled,
            maxPaperSize,
            supportsColor,
            supportsBlackAndWhite: supportsBW,
            supportsDoubleSided: supportsDuplex,
          },
          binding: {
            enabled: bindingEnabled,
            types: bindingTypes,
          },
          lamination: {
            enabled: laminationEnabled,
            maxSize: laminationMaxSize,
          },
          scanning: { enabled: scanningEnabled },
          photocopying: { enabled: photocopyingEnabled, supportsColor: photocopyingColor },
          plasticFiles: { enabled: plasticFilesEnabled },
          delivery: { enabled: deliverySelfEnabled || deliveryCourierEnabled },
          customServices: [],
        },
        delivery: {
          self: {
            enabled: deliverySelfEnabled,
            radiusKm: num(deliveryRadius, 3),
            fee: num(deliveryFee, 30),
            etaMinutes: num(deliveryEta, 120),
          },
          courier: {
            enabled: deliveryCourierEnabled,
          },
        },
        pricing: {
          printing: {
            a4: {
              blackAndWhite: { singleSided: num(priceA4.bwSingle, 2), doubleSided: num(priceA4.bwDouble, 3) },
              color: { singleSided: num(priceA4.colorSingle, 5), doubleSided: num(priceA4.colorDouble, 8) },
            },
            a3: {
              blackAndWhite: { singleSided: num(priceA3.bwSingle, 4), doubleSided: num(priceA3.bwDouble, 6) },
              color: { singleSided: num(priceA3.colorSingle, 10), doubleSided: num(priceA3.colorDouble, 15) },
            },
            letter: {
              blackAndWhite: { singleSided: num(priceA4.bwSingle, 2), doubleSided: num(priceA4.bwDouble, 3) },
              color: { singleSided: num(priceA4.colorSingle, 5), doubleSided: num(priceA4.colorDouble, 8) },
            },
            legal: {
              blackAndWhite: { singleSided: num(priceA4.bwSingle, 2), doubleSided: num(priceA4.bwDouble, 3) },
              color: { singleSided: num(priceA4.colorSingle, 5), doubleSided: num(priceA4.colorDouble, 8) },
            },
          },
          binding: {
            spiral: num(bindingPrices.spiral, 30),
            perfect: num(bindingPrices.perfect, 50),
            staple: num(bindingPrices.staple, 10),
          },
          lamination: {
            a4: num(laminationPrices.a4, 20),
            a3: num(laminationPrices.a3, 40),
          },
          scanning: num(scanningPrice, 5),
          photocopying: {
            blackAndWhite: num(photocopyingPrices.bw, 2),
            color: num(photocopyingPrices.color, 10),
          },
          plasticFiles: num(plasticFilesPrice, 10),
          customServices: [],
        },
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

          <Section title="Printing service" footer="Configure your printer capabilities. An A3 printer can also print A4 and smaller.">
            <Card>
              <SwitchRow first title="Enable printing" subtitle="Core printing service" value={printingEnabled} onValueChange={edit(setPrintingEnabled)} />
              {printingEnabled ? (
                <>
                  <SwitchRow title="Large format (A3)" subtitle="Printer supports A3 paper" value={maxPaperSize === 'a3'} onValueChange={(v) => edit(setMaxPaperSize)(v ? 'a3' : 'a4')} />
                  <SwitchRow title="Supports B&W" subtitle="Black & white printing" value={supportsBW} onValueChange={edit(setSupportsBW)} />
                  <SwitchRow title="Supports color" subtitle="Color printing available" value={supportsColor} onValueChange={edit(setSupportsColor)} />
                  <SwitchRow title="Supports duplex" subtitle="Double-sided printing" value={supportsDuplex} onValueChange={edit(setSupportsDuplex)} />
                </>
              ) : null}
            </Card>
          </Section>

          {printingEnabled ? (
            <Section title="Printing prices (₹)" footer="Per-page prices. Customers pay these plus 3% processing fee.">
              <Card>
                <Text style={[type.footnote, { color: colors.textSecondary, marginBottom: space.sm, fontWeight: '700' }]}>A4 size</Text>
                {supportsBW ? (
                  <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.md }}>
                    <View style={{ flex: 1 }}>
                      <Field label="B&W single" keyboardType="decimal-pad" placeholder="2" value={priceA4.bwSingle} onChangeText={(v) => edit(setPriceA4)({ ...priceA4, bwSingle: v })} />
                    </View>
                    {supportsDuplex ? (
                      <View style={{ flex: 1 }}>
                        <Field label="B&W duplex" keyboardType="decimal-pad" placeholder="3" value={priceA4.bwDouble} onChangeText={(v) => edit(setPriceA4)({ ...priceA4, bwDouble: v })} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {supportsColor ? (
                  <View style={{ flexDirection: 'row', gap: space.md, marginBottom: maxPaperSize === 'a3' ? space.lg : space.xs }}>
                    <View style={{ flex: 1 }}>
                      <Field label="Color single" keyboardType="decimal-pad" placeholder="5" value={priceA4.colorSingle} onChangeText={(v) => edit(setPriceA4)({ ...priceA4, colorSingle: v })} />
                    </View>
                    {supportsDuplex ? (
                      <View style={{ flex: 1 }}>
                        <Field label="Color duplex" keyboardType="decimal-pad" placeholder="8" value={priceA4.colorDouble} onChangeText={(v) => edit(setPriceA4)({ ...priceA4, colorDouble: v })} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
                
                {maxPaperSize === 'a3' ? (
                  <>
                    <Text style={[type.footnote, { color: colors.textSecondary, marginBottom: space.sm, fontWeight: '700' }]}>A3 size</Text>
                    {supportsBW ? (
                      <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.md }}>
                        <View style={{ flex: 1 }}>
                          <Field label="B&W single" keyboardType="decimal-pad" placeholder="4" value={priceA3.bwSingle} onChangeText={(v) => edit(setPriceA3)({ ...priceA3, bwSingle: v })} />
                        </View>
                        {supportsDuplex ? (
                          <View style={{ flex: 1 }}>
                            <Field label="B&W duplex" keyboardType="decimal-pad" placeholder="6" value={priceA3.bwDouble} onChangeText={(v) => edit(setPriceA3)({ ...priceA3, bwDouble: v })} />
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                    {supportsColor ? (
                      <View style={{ flexDirection: 'row', gap: space.md }}>
                        <View style={{ flex: 1 }}>
                          <Field label="Color single" keyboardType="decimal-pad" placeholder="10" value={priceA3.colorSingle} onChangeText={(v) => edit(setPriceA3)({ ...priceA3, colorSingle: v })} />
                        </View>
                        {supportsDuplex ? (
                          <View style={{ flex: 1 }}>
                            <Field label="Color duplex" keyboardType="decimal-pad" placeholder="15" value={priceA3.colorDouble} onChangeText={(v) => edit(setPriceA3)({ ...priceA3, colorDouble: v })} />
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </>
                ) : null}
              </Card>
            </Section>
          ) : null}

          <Section title="Binding service" footer="Price per order (not per page). Enable types you offer.">
            <Card>
              <SwitchRow first title="Enable binding" subtitle="Book and document binding" value={bindingEnabled} onValueChange={edit(setBindingEnabled)} />
              {bindingEnabled ? (
                <>
                  <SwitchRow title="Spiral binding" subtitle="Coil or comb binding" value={bindingTypes.spiral} onValueChange={(v) => edit(setBindingTypes)({ ...bindingTypes, spiral: v })} />
                  {bindingTypes.spiral ? (
                    <View style={{ marginHorizontal: space.lg, marginBottom: space.sm }}>
                      <Field label="Spiral (₹)" keyboardType="decimal-pad" placeholder="30" value={bindingPrices.spiral} onChangeText={(v) => edit(setBindingPrices)({ ...bindingPrices, spiral: v })} />
                    </View>
                  ) : null}
                  <SwitchRow title="Perfect binding" subtitle="Glued spine like a book" value={bindingTypes.perfect} onValueChange={(v) => edit(setBindingTypes)({ ...bindingTypes, perfect: v })} />
                  {bindingTypes.perfect ? (
                    <View style={{ marginHorizontal: space.lg, marginBottom: space.sm }}>
                      <Field label="Perfect (₹)" keyboardType="decimal-pad" placeholder="50" value={bindingPrices.perfect} onChangeText={(v) => edit(setBindingPrices)({ ...bindingPrices, perfect: v })} />
                    </View>
                  ) : null}
                  <SwitchRow title="Staple binding" subtitle="Simple stapled pages" value={bindingTypes.staple} onValueChange={(v) => edit(setBindingTypes)({ ...bindingTypes, staple: v })} />
                  {bindingTypes.staple ? (
                    <View style={{ marginHorizontal: space.lg, marginBottom: space.sm }}>
                      <Field label="Staple (₹)" keyboardType="decimal-pad" placeholder="10" value={bindingPrices.staple} onChangeText={(v) => edit(setBindingPrices)({ ...bindingPrices, staple: v })} />
                    </View>
                  ) : null}
                </>
              ) : null}
            </Card>
          </Section>

          <Section title="Other services">
            <Card>
              <SwitchRow first title="Lamination" subtitle="Protective plastic coating" value={laminationEnabled} onValueChange={edit(setLaminationEnabled)} />
              {laminationEnabled ? (
                <View style={{ marginTop: space.sm, marginLeft: space.lg }}>
                  <SwitchRow title="Support A3 lamination" subtitle="Laminate A3 sheets as well as A4" value={laminationMaxSize === 'a3'} onValueChange={(v) => edit(setLaminationMaxSize)(v ? 'a3' : 'a4')} />
                  <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.xs }}>
                    <View style={{ flex: 1 }}>
                      <Field label="A4 price (₹)" keyboardType="decimal-pad" placeholder="20" value={laminationPrices.a4} onChangeText={(v) => edit(setLaminationPrices)({ ...laminationPrices, a4: v })} />
                    </View>
                    {laminationMaxSize === 'a3' ? (
                      <View style={{ flex: 1 }}>
                        <Field label="A3 price (₹)" keyboardType="decimal-pad" placeholder="40" value={laminationPrices.a3} onChangeText={(v) => edit(setLaminationPrices)({ ...laminationPrices, a3: v })} />
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
              
              <SwitchRow title="Scanning" subtitle="Convert physical to digital" value={scanningEnabled} onValueChange={edit(setScanningEnabled)} />
              {scanningEnabled ? (
                <View style={{ marginTop: space.sm, marginLeft: space.lg }}>
                  <Field label="Price per page (₹)" keyboardType="decimal-pad" placeholder="5" value={scanningPrice} onChangeText={edit(setScanningPrice)} />
                </View>
              ) : null}
              
              <SwitchRow title="Photocopying" subtitle="Make copies of documents" value={photocopyingEnabled} onValueChange={edit(setPhotocopyingEnabled)} />
              {photocopyingEnabled ? (
                <View style={{ marginTop: space.sm, marginLeft: space.lg }}>
                  <Field label="B&W per page (₹)" keyboardType="decimal-pad" placeholder="2" value={photocopyingPrices.bw} onChangeText={(v) => edit(setPhotocopyingPrices)({ ...photocopyingPrices, bw: v })} />
                  <SwitchRow title="Color available" subtitle="Not just B&W copies" value={photocopyingColor} onValueChange={edit(setPhotocopyingColor)} />
                  {photocopyingColor ? (
                    <View style={{ marginTop: space.xs }}>
                      <Field label="Color per page (₹)" keyboardType="decimal-pad" placeholder="10" value={photocopyingPrices.color} onChangeText={(v) => edit(setPhotocopyingPrices)({ ...photocopyingPrices, color: v })} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              
              <SwitchRow title="Plastic files" subtitle="Transparent document folders" value={plasticFilesEnabled} onValueChange={edit(setPlasticFilesEnabled)} />
              {plasticFilesEnabled ? (
                <View style={{ marginTop: space.sm, marginLeft: space.lg }}>
                  <Field label="Price per item (₹)" keyboardType="decimal-pad" placeholder="10" value={plasticFilesPrice} onChangeText={edit(setPlasticFilesPrice)} />
                </View>
              ) : null}
            </Card>
          </Section>

          <Section title="Delivery channels" footer="Enable home delivery options for your shop.">
            <Card>
              <SwitchRow first title="Shop local delivery" subtitle="Your own rider delivers within your area" value={deliverySelfEnabled} onValueChange={edit(setDeliverySelfEnabled)} />
              {deliverySelfEnabled ? (
                <View style={{ marginTop: space.sm, marginLeft: space.lg }}>
                  <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field label="Radius (km)" keyboardType="decimal-pad" placeholder="3" value={deliveryRadius} onChangeText={edit(setDeliveryRadius)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Fee (₹)" keyboardType="decimal-pad" placeholder="30" value={deliveryFee} onChangeText={edit(setDeliveryFee)} />
                    </View>
                  </View>
                  <Field label="Typical delivery time (mins)" keyboardType="number-pad" placeholder="120" value={deliveryEta} onChangeText={edit(setDeliveryEta)} />
                </View>
              ) : null}
              
              <SwitchRow title="Shiprocket courier" subtitle="Courier collects from your shop for delivery" value={deliveryCourierEnabled} onValueChange={edit(setDeliveryCourierEnabled)} />
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
