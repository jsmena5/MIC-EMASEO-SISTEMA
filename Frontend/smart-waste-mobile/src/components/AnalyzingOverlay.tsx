import { Ionicons } from "@expo/vector-icons"
import React from "react"
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

import { colors } from "../theme/colors"

interface AnalyzingOverlayProps {
  isAnalyzing: boolean
  label?: string
  progress?: number
  /** Renders a cancel button */
  onCancel?: () => void
  /** Renders a "Continuar navegando" button that sends analysis to background */
  onBackground?: () => void
  /** Controls whether the background button is visible (only during polling phases) */
  canBackground?: boolean
}

export default function AnalyzingOverlay({
  isAnalyzing,
  label = "Analizando imagen...",
  progress,
  onCancel,
  onBackground,
  canBackground = false,
}: AnalyzingOverlayProps) {
  if (!isAnalyzing) return null

  const pct =
    progress !== undefined ? Math.min(100, Math.max(0, Math.round(progress))) : undefined

  return (
    <View style={styles.root}>
      <View style={styles.backdrop} />

      <View style={styles.content}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.label}>{label}</Text>

        {pct !== undefined && (
          <View style={styles.progressWrapper}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
          </View>
        )}

        {onBackground && canBackground && (
          <TouchableOpacity style={styles.backgroundBtn} onPress={onBackground} activeOpacity={0.75}>
            <Ionicons name="arrow-back-circle-outline" size={18} color="#fff" />
            <Text style={styles.backgroundText}>Continuar navegando</Text>
          </TouchableOpacity>
        )}

        {onCancel && (
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.75}>
            <Ionicons name="close-circle-outline" size={18} color="rgba(255,255,255,0.75)" />
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  // Give the content a fixed width so the progress bar has a known parent dimension.
  content: {
    width: "76%",
    alignItems: "center",
    gap: 14,
  },
  label: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
    textAlign: "center",
  },
  progressWrapper: {
    width: "100%",
  },
  progressTrack: {
    width: "100%",
    height: 6,
    backgroundColor: "rgba(255,255,255,0.20)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.secondary, // #00A859 — brand green
    borderRadius: 3,
  },
  backgroundBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  backgroundText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  cancelText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    fontWeight: "600",
  },
})
