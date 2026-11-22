/**
 * Shared building blocks: screen container, grouped cards, rows, buttons,
 * status pills, banners and empty states. Native controls where they exist
 * (Switch, RefreshControl, ActivityIndicator).
 */
import * as Haptics from 'expo-haptics';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { radius, space, TOUCH, toneColors, type, useTheme, type Tone } from '@/theme';

export type IconName = { ios: SymbolViewProps['name'] & string; android: string };

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <SymbolView
      name={{ ios: name.ios, android: name.android, web: name.android } as SymbolViewProps['name']}
      size={size}
      tintColor={color ?? colors.textSecondary}
      style={{ width: size, height: size }}
    />
  );
}

export function Screen({
  children,
  refreshing,
  onRefresh,
}: {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl * 2, gap: space.lg }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Section({ title, footer, children, action }: { title?: string; footer?: string; children: React.ReactNode; action?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {(title || action) && (
        <View style={styles.sectionHeader}>
          {title ? (
            <Text style={[type.footnote, { color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 }]} accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      )}
      {children}
      {footer ? <Text style={[type.footnote, { color: colors.textTertiary, paddingHorizontal: space.xs }]}>{footer}</Text> : null}
    </View>
  );
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: ViewStyle; tone?: Tone }) {
  const { colors } = useTheme();
  const accent = tone ? toneColors(colors, tone).fg : undefined;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A tappable or static list row inside a Card. */
export function Row({
  title,
  subtitle,
  value,
  icon,
  onPress,
  right,
  first,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  right?: React.ReactNode;
  first?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
      {icon ? <Icon name={icon} color={colors.primary} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[type.footnote, { color: colors.textTertiary }]}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[type.callout, { color: colors.textTertiary }]}>{value}</Text> : null}
      {right}
      {onPress && !right ? <Icon name={{ ios: 'chevron.right', android: 'chevron_right' }} size={14} color={colors.textTertiary} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
      {content}
    </Pressable>
  );
}

export function SwitchRow({ title, subtitle, value, onValueChange, first, disabled }: { title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void; first?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Row
      title={title}
      subtitle={subtitle}
      first={first}
      onPress={disabled ? undefined : () => onValueChange(!value)}
      right={
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            Haptics.selectionAsync().catch(() => undefined);
            onValueChange(v);
          }}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={Platform.OS === 'android' ? (value ? '#FFFFFF' : '#F4F3F4') : undefined}
          accessibilityLabel={title}
        />
      }
    />
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'plain';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
    destructive: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
    plain: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.5 : pressed ? 0.75 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : icon ? <Icon name={icon} size={18} color={palette.fg} /> : null}
      <Text style={[type.headline, { color: palette.fg }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { colors } = useTheme();
  const c = toneColors(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[type.caption, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Banner({ tone = 'info', title, message, action }: { tone?: Tone; title: string; message?: string; action?: React.ReactNode }) {
  const { colors } = useTheme();
  const c = toneColors(colors, tone);
  const icon: IconName =
    tone === 'danger' || tone === 'warning'
      ? { ios: 'exclamationmark.triangle.fill', android: 'warning' }
      : tone === 'success'
        ? { ios: 'checkmark.circle.fill', android: 'check_circle' }
        : { ios: 'info.circle.fill', android: 'info' };
  return (
    <View style={[styles.banner, { backgroundColor: c.bg }]} accessibilityRole="summary">
      <Icon name={icon} color={c.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headline, { color: c.fg }]}>{title}</Text>
        {message ? <Text style={[type.subhead, { color: colors.textSecondary }]}>{message}</Text> : null}
        {action}
      </View>
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message: string; action?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={[type.headline, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.subhead, { color: colors.textTertiary, textAlign: 'center' }]}>{message}</Text>
      {action}
    </View>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.footnote, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel={label}
        {...props}
        style={[
          type.body,
          styles.input,
          { color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border },
          props.style,
        ]}
      />
      {hint ? <Text style={[type.caption, { color: colors.textTertiary }]}>{hint}</Text> : null}
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[type.caption, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[type.title, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

export function Body({ children, tone = 'secondary' }: { children: React.ReactNode; tone?: 'primary' | 'secondary' | 'tertiary' }) {
  const { colors } = useTheme();
  const color = tone === 'primary' ? colors.text : tone === 'tertiary' ? colors.textTertiary : colors.textSecondary;
  return <Text style={[type.subhead, { color }]}>{children}</Text>;
}

/** A tappable row that shows the current value and opens a native picker (ActionSheet on iOS, Alert on Android). */
export function PickerRow<T extends string>({
  label,
  value,
  options,
  onChange,
  subtitle,
}: {
  label: string;
  value: T;
  options: { val: T; label: string; subtitle?: string }[];
  onChange: (val: T) => void;
  subtitle?: string;
}) {
  const { colors } = useTheme();
  const current = options.find((o) => o.val === value);
  const open = () => {
    Haptics.selectionAsync().catch(() => undefined);
    if (Platform.OS === 'ios') {
      const { ActionSheetIOS } = require('react-native');
      const labels = options.map((o) => o.val === value ? `${o.label} ✓` : o.label);
      labels.push('Cancel');
      ActionSheetIOS.showActionSheetWithOptions(
        { title: label, options: labels, cancelButtonIndex: labels.length - 1 },
        (i: number) => { if (i < options.length) onChange(options[i].val); },
      );
    } else {
      Alert.alert(
        label,
        subtitle,
        [
          ...options.map((o) => ({
            text: o.val === value ? `${o.label} ✓` : o.label,
            onPress: () => onChange(o.val),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    }
  };
  return (
    <Row
      title={label}
      subtitle={subtitle}
      value={current?.label ?? String(value)}
      onPress={open}
    />
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xs },
  card: {
    borderRadius: radius.lg,
    borderWidth: Platform.OS === 'android' ? 1 : StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
    overflow: 'hidden',
  },
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  button: {
    minHeight: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  pill: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  banner: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, alignItems: 'flex-start' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  input: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md },
});
