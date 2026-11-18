import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Button, Field } from '@/components/ui';
import { space, type, useTheme } from '@/theme';

/**
 * Asks for the customer's 4-digit delivery code (shop delivery). Works on both
 * platforms; Alert.prompt is iOS-only. Give it key={orderId} so each order starts empty.
 */
export function HandoverCodeModal({
  orderId,
  error,
  busy,
  onSubmit,
  onClose,
}: {
  orderId: string | null;
  error?: string;
  busy?: boolean;
  onSubmit: (code: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [code, setCode] = useState('');

  return (
    <Modal visible={Boolean(orderId)} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: space.lg }}>
          {/* Inner Pressable stops taps on the card from closing it */}
          <Pressable onPress={() => undefined} style={{ backgroundColor: colors.surface, borderRadius: 16, padding: space.lg, gap: space.md }} accessibilityViewIsModal>
            <Text style={[type.title, { color: colors.text }]} accessibilityRole="header">Delivered order {orderId}?</Text>
            <Text style={[type.subhead, { color: colors.textSecondary }]}>Ask the customer for the 4-digit delivery code shown in their order.</Text>
            <Field
              label="Delivery code"
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={4}
              autoFocus
              placeholder="0000"
              style={{ fontSize: 28, letterSpacing: 10, textAlign: 'center', fontVariant: ['tabular-nums'] }}
              onSubmitEditing={() => code.length === 4 && onSubmit(code)}
            />
            {error ? <Text style={[type.footnote, { color: colors.danger }]} accessibilityLiveRegion="polite">{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
              <Button title="Confirm" onPress={() => onSubmit(code)} disabled={code.length !== 4} loading={busy} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
