import * as Location from 'expo-location';
import React, { Component, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Banner, Body, Button, Field } from '@/components/ui';
import { radius, space, TOUCH, type, useTheme } from '@/theme';

export type MapPoint = { latitude: number; longitude: number };

class WebViewBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function buildLeafletHtml(lat: number, lng: number): string {
  const safeLat = Number.isFinite(lat) ? lat : 28.6139;
  const safeLng = Number.isFinite(lng) ? lng : 77.209;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #eef1f5; }
    .leaflet-control-attribution { font-size: 9px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function () {
      var lat = ${safeLat};
      var lng = ${safeLng};
      var map = L.map('map').setView([lat, lng], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
      }).addTo(map);
      var marker = L.marker([lat, lng], { draggable: true }).addTo(map);

      function postPin(p) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: p.lat, longitude: p.lng }));
        }
      }
      map.on('click', function (e) {
        marker.setLatLng(e.latlng);
        postPin(e.latlng);
      });
      marker.on('dragend', function () {
        postPin(marker.getLatLng());
      });
      window.setPin = function (newLat, newLng, zoom) {
        marker.setLatLng([newLat, newLng]);
        map.setView([newLat, newLng], zoom || map.getZoom());
      };
    })();
  </script>
</body>
</html>`;
}

type ModalProps = {
  visible: boolean;
  title: string;
  initialPoint: MapPoint;
  shopPin?: MapPoint;
  onConfirm: (point: MapPoint) => void;
  onClose: () => void;
};

export function OsmMapModal(props: ModalProps) {
  if (!props.visible) return null;
  return <OsmMapModalContent {...props} />;
}

function OsmMapModalContent({
  title,
  initialPoint,
  shopPin,
  onConfirm,
  onClose,
}: Omit<ModalProps, 'visible'>) {
  const { colors } = useTheme();
  const webRef = useRef<WebView | null>(null);
  const [pin, setPin] = useState<MapPoint>(() => initialPoint);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const html = useMemo(
    () => buildLeafletHtml(initialPoint.latitude, initialPoint.longitude),
    [initialPoint.latitude, initialPoint.longitude]
  );

  const moveMap = (next: MapPoint, zoom = 16) => {
    setPin(next);
    webRef.current?.injectJavaScript(`window.setPin && window.setPin(${next.latitude}, ${next.longitude}, ${zoom}); true;`);
  };

  const searchPlace = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'FunPrintingPartner/1.0' } }
      ).catch(() => null);
      if (res?.ok) {
        const data = (await res.json().catch(() => null)) as { lat?: string; lon?: string }[] | null;
        if (data?.[0]?.lat && data?.[0]?.lon) {
          moveMap({ latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) }, 16);
          return;
        }
      }
      const geo = await Location.geocodeAsync(q).catch(() => []);
      if (geo?.[0]) {
        moveMap({ latitude: geo[0].latitude, longitude: geo[0].longitude }, 16);
        return;
      }
      Alert.alert('Place not found', 'Try a nearby landmark, street, or city name.');
    } finally {
      setSearching(false);
    }
  };

  const useCurrentGps = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission required', 'Allow location access or tap directly on the map.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      moveMap({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }, 17);
    } catch {
      Alert.alert('Could not get GPS', 'Tap directly on the map or search for your place.');
    } finally {
      setLocating(false);
    }
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as Partial<MapPoint>;
      if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        setPin({ latitude: data.latitude, longitude: data.longitude });
      }
    } catch {
      // ignore malformed bridge message
    }
  };

  const fallbackView = (
    <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: 'center' }}>
      <Banner
        tone="warning"
        title="Map view unavailable on this build"
        message="Search by place name, tap Use GPS, or enter coordinates directly below."
      />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Latitude"
            keyboardType="numeric"
            value={pin.latitude.toFixed(6)}
            onChangeText={(v) => {
              const n = parseFloat(v);
              if (Number.isFinite(n)) setPin((p) => ({ ...p, latitude: n }));
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Longitude"
            keyboardType="numeric"
            value={pin.longitude.toFixed(6)}
            onChangeText={(v) => {
              const n = parseFloat(v);
              if (Number.isFinite(n)) setPin((p) => ({ ...p, longitude: n }));
            }}
          />
        </View>
      </View>
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Button variant="plain" title="Cancel" onPress={onClose} style={{ minHeight: 36, paddingHorizontal: 4 }} />
          <Text style={[type.headline, { color: colors.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
            {title}
          </Text>
          <Button
            variant="plain"
            title="Use pin"
            onPress={() => onConfirm(pin)}
            style={{ minHeight: 36, paddingHorizontal: 4 }}
          />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.xs,
            padding: space.sm,
            backgroundColor: colors.surface,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void searchPlace()}
            returnKeyType="search"
            placeholder="Search place or landmark…"
            placeholderTextColor={colors.textTertiary}
            style={{
              flex: 1,
              minHeight: TOUCH - 6,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surfaceMuted,
              color: colors.text,
              paddingHorizontal: space.md,
            }}
          />
          <Pressable
            onPress={() => void searchPlace()}
            disabled={searching}
            style={{
              minHeight: TOUCH - 6,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              backgroundColor: colors.primary,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {searching ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={[type.subhead, { color: colors.onPrimary, fontWeight: '600' }]}>Search</Text>
            )}
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {mapFailed ? (
            fallbackView
          ) : (
            <WebViewBoundary fallback={fallbackView}>
              <WebView
                ref={webRef}
                source={{ html }}
                onMessage={handleMessage}
                onError={() => setMapFailed(true)}
                originWhitelist={['*']}
                javaScriptEnabled
                domStorageEnabled
                style={{ flex: 1 }}
              />
            </WebViewBoundary>
          )}
        </View>

        <View
          style={{
            padding: space.md,
            gap: space.sm,
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Body tone="secondary">
              Pin: {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
            </Body>
            <Body tone="tertiary">Tap or drag marker</Body>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                variant="secondary"
                title={locating ? 'Locating…' : 'Use GPS'}
                icon={{ ios: 'location.fill', android: 'my_location' }}
                onPress={useCurrentGps}
                loading={locating}
              />
            </View>
            {shopPin ? (
              <View style={{ flex: 1 }}>
                <Button
                  variant="secondary"
                  title="Copy shop pin"
                  icon={{ ios: 'mappin.and.ellipse', android: 'place' }}
                  onPress={() => moveMap(shopPin, 16)}
                />
              </View>
            ) : null}
          </View>
          <Button
            title="Confirm location"
            onPress={() => onConfirm(pin)}
            style={Platform.OS === 'android' ? { marginBottom: 4 } : undefined}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
