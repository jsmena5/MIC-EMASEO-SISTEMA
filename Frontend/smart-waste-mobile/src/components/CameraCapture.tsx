import { Ionicons } from "@expo/vector-icons"
import { CameraView as ExpoCameraView } from "expo-camera"
import * as Haptics from "expo-haptics"
import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"

import { colors } from "../theme/colors"
import ScanOverlay from "./ScanOverlay"

type ScanPhase = "scanning" | "ready"

export interface CameraCaptureProps {
  /** Called once the shutter fires and the picture is ready. */
  onPictureTaken: (base64: string, uri: string) => void
  /** Optional: called when the user taps the back arrow. */
  onBack?: () => void
}

const { width: SW } = Dimensions.get("window")
const FRAME = Math.min(SW * 0.78, 300)

// ─── Public component ────────────────────────────────────────────────────────

export default function CameraCapture({ onPictureTaken, onBack }: CameraCaptureProps) {
  const cameraRef = useRef<any>(null)
  const [phase, setPhase] = useState<ScanPhase>("scanning")
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("ready")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    }, 2600)
    return () => clearTimeout(t)
  }, [])

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return
    setCapturing(true)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.82 })
      onPictureTaken(photo.base64 ?? "", photo.uri)
    } catch {
      Alert.alert("Error", "No se pudo capturar la imagen. Intenta de nuevo.")
    } finally {
      setCapturing(false)
    }
  }

  const isReady = phase === "ready"

  return (
    <ExpoCameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back">

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        {onBack ? (
          <TouchableOpacity style={styles.backCircle} onPress={onBack}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <Text style={styles.topTitle}>Capturar Incidencia</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* ── Status badge ── */}
      <Animated.View
        key={`status-${phase}`}
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(200)}
        style={[styles.statusBadge, isReady && styles.statusBadgeReady]}
      >
        <View style={[styles.statusDot, isReady ? styles.dotGreen : styles.dotBlue]} />
        <Text style={styles.statusText}>
          {isReady ? "¡Área lista! Pulsa para capturar" : "Buscando área óptima..."}
        </Text>
      </Animated.View>

      {/* ── Dark cutout overlay with frame and brackets ── */}
      <ScanOverlay scanning={!isReady} />

      {/* ── Bottom controls ── */}
      <View style={styles.bottomControls}>
        <View style={styles.instructionPill}>
          <Text style={styles.instructionText}>Tome la foto a 2 metros de distancia</Text>
        </View>

        <View style={styles.hintRow}>
          <HintChip icon="resize-outline" label="1–2 metros del área" />
          <HintChip icon="sunny-outline" label="Buena iluminación" />
        </View>

        <View style={styles.distanceBar}>
          <Text style={styles.distanceLabel}>CERCA</Text>
          <View style={styles.distanceTrack}>
            <View style={[
              styles.distanceIndicator,
              { backgroundColor: isReady ? colors.secondary : colors.primary },
            ]} />
          </View>
          <Text style={styles.distanceLabel}>LEJOS</Text>
        </View>

        <Text style={styles.bottomHint}>
          {isReady
            ? "Presiona el botón cuando la basura esté bien encuadrada"
            : "Centra la acumulación de basura en el marco"}
        </Text>

        {/* ── Shutter button ── */}
        <TouchableOpacity
          style={[styles.shutterBtn, capturing && styles.shutterBtnDisabled]}
          onPress={handleCapture}
          disabled={capturing}
          activeOpacity={0.8}
        >
          {capturing
            ? <ActivityIndicator size="large" color="#fff" />
            : <View style={styles.shutterInner} />
          }
        </TouchableOpacity>

        <Text style={styles.shutterLabel}>
          {capturing ? "Capturando..." : "Tomar foto"}
        </Text>
      </View>

    </ExpoCameraView>
  )
}

// ─── Hint chip ───────────────────────────────────────────────────────────────

function HintChip({ icon, label }: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
}) {
  return (
    <View style={styles.hintChip}>
      <Ionicons name={icon} size={13} color="rgba(255,255,255,0.85)" />
      <Text style={styles.hintChipText}>{label}</Text>
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "android" ? 44 : 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center", alignItems: "center",
  },
  topTitle: {
    color: "#fff", fontWeight: "700", fontSize: 16, letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },

  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  statusBadgeReady: {
    backgroundColor: "rgba(0,168,89,0.25)",
    borderColor: "rgba(0,168,89,0.5)",
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotBlue: { backgroundColor: colors.primary },
  dotGreen: { backgroundColor: colors.secondary },
  statusText: { color: "#fff", fontSize: 13, fontWeight: "600", letterSpacing: 0.2 },

  bottomControls: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    // aligns with the bottom of the frame window (OVERLAY_V + FRAME from top)
    top: (Dimensions.get("window").height - FRAME) / 2 - 60 + FRAME,
    backgroundColor: "rgba(0,0,0,0.62)",
    paddingTop: 20, alignItems: "center",
  },

  instructionPill: {
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20, marginBottom: 14,
  },
  instructionText: {
    color: "#fff", fontSize: 13, fontWeight: "600",
    textAlign: "center", letterSpacing: 0.2,
  },

  hintRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  hintChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12,
  },
  hintChipText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "500" },

  distanceBar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  distanceLabel: {
    color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "700", letterSpacing: 1,
  },
  distanceTrack: {
    width: 120, height: 4,
    backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, justifyContent: "center",
  },
  distanceIndicator: {
    width: 16, height: 16, borderRadius: 8, alignSelf: "center",
    elevation: 4, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  bottomHint: {
    color: "rgba(255,255,255,0.55)", fontSize: 13,
    textAlign: "center", paddingHorizontal: 24, marginBottom: 4,
  },

  shutterBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 4, borderColor: "#fff",
    justifyContent: "center", alignItems: "center", marginTop: 18,
  },
  shutterBtnDisabled: { borderColor: "rgba(255,255,255,0.35)", opacity: 0.7 },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#fff" },
  shutterLabel: {
    color: "rgba(255,255,255,0.65)", fontSize: 12,
    fontWeight: "600", marginTop: 8, letterSpacing: 0.5,
  },
})
