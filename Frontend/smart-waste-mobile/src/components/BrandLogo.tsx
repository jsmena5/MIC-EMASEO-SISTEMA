import { Ionicons } from "@expo/vector-icons"
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { colors } from "../theme/colors"

interface BrandLogoProps {
  /** Lado del emblema en píxeles. */
  size?: number
  /** Color de fondo del badge (default: azul institucional). */
  background?: string
  /** Mostrar el micro-chip "IA" (denota el análisis con inteligencia artificial). */
  showIA?: boolean
}

/**
 * BrandLogo — Emblema de marca de EMASEO EP IA.
 *
 * Badge circular institucional con una hoja (medio ambiente / aseo) y un chip
 * "IA" que distingue el análisis automático con inteligencia artificial.
 *
 * Construido solo con primitivas nativas (View + Ionicons), sin react-native-svg,
 * para no requerir un build nativo nuevo. El chip "IA" es blanco con texto azul,
 * así contrasta tanto sobre un badge verde (splash oscuro) como azul (login claro).
 *
 * Paleta sobria: azul (#005BAC) / verde (#00A859) / blanco — sin colores extravagantes.
 */
export default function BrandLogo({
  size = 96,
  background = colors.primary,
  showIA = true,
}: BrandLogoProps) {
  const leafSize = Math.round(size * 0.46)
  const chip     = Math.round(size * 0.36)

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: background,
            shadowColor: background,
          },
        ]}
      >
        <Ionicons name="leaf" size={leafSize} color="#FFFFFF" />
      </View>

      {showIA && (
        <View
          style={[
            styles.iaChip,
            { width: chip, height: chip, borderRadius: chip / 2 },
          ]}
        >
          <Text style={[styles.iaText, { fontSize: Math.round(chip * 0.44) }]}>IA</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    justifyContent: "center",
    alignItems: "center",
    elevation: 12,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  iaChip: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.secondary,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  iaText: {
    color: colors.primaryDark,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
})
