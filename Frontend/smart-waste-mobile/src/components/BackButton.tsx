import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { colors } from '../theme/colors'

interface BackButtonProps {
  onPress: () => void
  label?: string
  disabled?: boolean
  accessibilityHint?: string
}

export default function BackButton({
  onPress,
  label = '← Atrás',
  disabled,
  accessibilityHint = 'Regresa a la pantalla anterior',
}: BackButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={styles.button}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
    >
      <Text style={styles.text}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  text: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 14,
  },
})
