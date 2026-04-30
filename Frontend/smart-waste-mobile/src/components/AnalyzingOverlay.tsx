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
  /** Optional label shown below the spinner */
  label?: string
  /** When provided, renders a cancel button */
  onCancel?: () => void
}

export default function AnalyzingOverlay({
  isAnalyzing,
  label = "Analizando imagen...",
  onCancel,
}: AnalyzingOverlayProps) {
  if (!isAnalyzing) return null

  return (
    <View style={styles.root}>
      <View style={styles.backdrop} />

      <View style={styles.content}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.label}>{label}</Text>

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
  content: {
    alignItems: "center",
    gap: 14,
  },
  label: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
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
