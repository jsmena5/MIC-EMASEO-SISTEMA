import React from 'react'
import { StyleSheet, Text, TextStyle, TouchableOpacity, ViewStyle } from 'react-native'
import { colors } from '../theme/colors'

interface LinkButtonProps {
  label: string
  onPress: () => void
  disabled?: boolean
  style?: ViewStyle
  textStyle?: TextStyle
  accessibilityLabel?: string
  accessibilityHint?: string
}

export default function LinkButton({
  label,
  onPress,
  disabled,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
}: LinkButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, style]}
      hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
    >
      <Text style={[styles.text, textStyle]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
  },
  text: {
    color: colors.gray,
    fontSize: 13,
    fontWeight: '600',
  },
})
