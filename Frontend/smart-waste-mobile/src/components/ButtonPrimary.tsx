import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { colors } from '../theme/colors';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonPrimaryProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
}

const variantStyles: Record<Variant, { background: string; border: string }> = {
  primary: { background: colors.primary, border: colors.primaryDark },
  secondary: { background: colors.secondary, border: colors.secondaryDark },
  danger: { background: colors.error, border: '#B91C1C' },
};

export default function ButtonPrimary({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: ButtonPrimaryProps) {
  const isInactive = loading || disabled;
  const { background, border } = variantStyles[variant];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      disabled={isInactive}
      style={[
        styles.base,
        { backgroundColor: background, borderColor: border },
        isInactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  inactive: {
    opacity: 0.55,
  },
  label: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
