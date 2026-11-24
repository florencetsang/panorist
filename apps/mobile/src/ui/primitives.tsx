/** Small design-system primitives for the native app. */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { rules, sun, viewBox as brandViewBox } from '@panorist/core/brand';
import { type as scale } from '@panorist/core/design';
import { font, radius, space, useTheme } from './theme.ts';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'ui' | 'small' | 'eyebrow';
type Tone = 'ink' | 'muted' | 'faint' | 'accent' | 'danger' | 'onAccent' | 'paper';

const FAMILY: Record<Variant, string> = {
  display: font.serifMedium,
  title: font.serifMedium,
  heading: font.serifSemibold,
  body: font.serif,
  ui: font.sans,
  small: font.sans,
  eyebrow: font.sansSemibold,
};

export function Text({
  variant = 'ui',
  tone = 'ink',
  style,
  ...props
}: TextProps & { variant?: Variant; tone?: Tone }) {
  const { color } = useTheme();
  const [fontSize, lineHeight] = scale[variant];
  const toneColor = {
    ink: color.ink,
    muted: color.inkMuted,
    faint: color.inkFaint,
    accent: color.accent,
    danger: color.danger,
    onAccent: color.onAccent,
    paper: color.paper,
  }[tone];
  const base: TextStyle = {
    fontFamily: FAMILY[variant],
    fontSize,
    lineHeight,
    color: toneColor,
    ...(variant === 'eyebrow' && { letterSpacing: 1.4, textTransform: 'uppercase' }),
    ...((variant === 'display' || variant === 'title') && { letterSpacing: -0.4 }),
  };
  return <RNText {...props} style={[base, style]} />;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: PressableProps['onPress'];
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { color } = useTheme();
  const bg = { primary: color.ink, secondary: color.surface, ghost: 'transparent' }[variant];
  const fg = { primary: color.paper, secondary: color.ink, ghost: color.inkMuted }[variant];
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        {
          minHeight: 50,
          borderRadius: radius.pill,
          paddingHorizontal: space(5),
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: color.rule,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space(2),
          opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon}
      <RNText style={{ fontFamily: font.sansMedium, fontSize: 16, color: fg }}>{label}</RNText>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  const { color } = useTheme();
  return (
    <View style={{ gap: space(1.5) }}>
      <Text variant="small" style={{ fontFamily: font.sansMedium }}>
        {label}
      </Text>
      <TextInput
        placeholderTextColor={color.inkFaint}
        selectionColor={color.accent}
        {...props}
        style={[
          {
            minHeight: 50,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: color.rule,
            backgroundColor: color.surface,
            paddingHorizontal: space(4),
            fontFamily: font.sans,
            fontSize: 16,
            color: color.ink,
          },
          props.style,
        ]}
      />
      {hint && (
        <Text variant="small" tone="faint">
          {hint}
        </Text>
      )}
    </View>
  );
}

export function Notice({
  children,
  tone = 'danger',
}: {
  children: ReactNode;
  tone?: 'danger' | 'info';
}) {
  const { color } = useTheme();
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={{
        borderRadius: radius.md,
        padding: space(3.5),
        backgroundColor: tone === 'danger' ? color.dangerSoft : color.sunken,
      }}
    >
      <Text variant="small" tone={tone === 'danger' ? 'danger' : 'muted'}>
        {children}
      </Text>
    </View>
  );
}

export function Rule({
  strong = false,
  style,
}: {
  strong?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { color } = useTheme();
  return (
    <View
      style={[
        { height: strong ? 1.5 : 1, backgroundColor: strong ? color.ink : color.rule },
        style,
      ]}
    />
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress?: () => void;
}) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'checkbox' : undefined}
      accessibilityState={onPress ? { checked: selected } : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? color.ink : color.rule,
        backgroundColor: selected ? color.ink : color.surface,
        paddingHorizontal: space(4),
        paddingVertical: space(2.25),
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <RNText
        style={{
          fontFamily: font.sans,
          fontSize: 15,
          color: selected ? color.paper : color.inkMuted,
        }}
      >
        {selected ? '✓ ' : ''}
        {label}
      </RNText>
    </Pressable>
  );
}

/** The sunrise mark from @panorist/core/brand, built from Views (no SVG dependency). */
export function Mark({ height = 20 }: { height?: number }) {
  const { color } = useTheme();
  const box = brandViewBox.mark;
  const k = height / box.height;
  const place = (r: { x: number; y: number; width: number; height: number }): ViewStyle => ({
    position: 'absolute',
    left: (r.x - box.x) * k,
    top: (r.y - box.y) * k,
    width: r.width * k,
    height: r.height * k,
  });
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: box.width * k, height }}
    >
      <View
        style={{
          ...place({ x: sun.cx - sun.r, y: sun.cy - sun.r, width: 2 * sun.r, height: sun.r }),
          backgroundColor: color.accent,
          borderTopLeftRadius: sun.r * k,
          borderTopRightRadius: sun.r * k,
        }}
      />
      <View style={{ ...place(rules.horizon), backgroundColor: color.ink }} />
      <View style={{ ...place(rules.line1), backgroundColor: color.inkFaint }} />
      <View style={{ ...place(rules.line2), backgroundColor: color.inkFaint }} />
    </View>
  );
}

/** Logo lockup: mark + "Panorist." */
export function Wordmark({ size = 28 }: { size?: number }) {
  const { color } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.35 }}>
      <Mark height={size * 0.8} />
      <RNText
        style={{
          fontFamily: font.serifSemibold,
          fontSize: size,
          color: color.ink,
          letterSpacing: -0.5,
        }}
      >
        Panorist
        <RNText style={{ color: color.accent }}>.</RNText>
      </RNText>
    </View>
  );
}

export function Loading() {
  const { color } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color.paper,
      }}
    >
      <ActivityIndicator color={color.inkMuted} />
    </View>
  );
}
