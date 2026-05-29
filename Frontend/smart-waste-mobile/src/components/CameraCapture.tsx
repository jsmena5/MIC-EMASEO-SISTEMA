import { Ionicons } from "@expo/vector-icons"
import * as FileSystem from "expo-file-system"
import * as Haptics from "expo-haptics"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"
import { Camera, useCameraPermission, type CameraDevice } from "react-native-vision-camera"

import { colors } from "../theme/colors"
import type { DistanceHint } from "../types/incident"
import { useLiveDistanceGuidance } from "../hooks/useLiveDistanceGuidance"
import ScanOverlay from "./ScanOverlay"
import { SCAN_FRAME_SIZE, SCAN_OVERLAY_V } from "../utils/cropToScanFrame"

type ScanPhase = "scanning" | "ready"

export interface CameraCaptureProps {
  /**
   * Llamado al disparar el obturador. `width` y `height` son dimensiones del sensor,
   * necesarias para cropToScanFrame.
   */
  onPictureTaken: (base64: string, uri: string, width: number, height: number) => void
  /** Llamado en cada actualización del frame processor con la pista de distancia. */
  onCoverageUpdate?: (hint: DistanceHint, coverage: number) => void
  onBack?: () => void
}

// Posición X del indicador en la barra de distancia (pista de 120 px, sin el ancho del indicador)
const HINT_POSITION: Record<DistanceHint, number> = {
  TOO_CLOSE: 4,    // extremo izquierdo (muy cerca)
  OPTIMAL:   52,   // centro
  TOO_FAR:   100,  // extremo derecho (muy lejos)
}

const HINT_LABEL: Record<DistanceHint, string> = {
  TOO_CLOSE: "Muy cerca",
  OPTIMAL:   "¡Distancia perfecta!",
  TOO_FAR:   "Acércate más",
}

const HINT_COLOR: Record<DistanceHint, string> = {
  TOO_CLOSE: "#FF5252",
  OPTIMAL:   colors.secondary,
  TOO_FAR:   "#FFA726",
}

// ─── Public component ────────────────────────────────────────────────────────

export default function CameraCapture({
  onPictureTaken,
  onCoverageUpdate,
  onBack,
}: CameraCaptureProps) {
  const cameraRef = useRef<InstanceType<typeof Camera>>(null)
  const [phase, setPhase]           = useState<ScanPhase>("scanning")
  const [capturing, setCapturing]   = useState(false)
  const [hint, setHint]             = useState<DistanceHint>("TOO_FAR")
  const [hintLabel, setHintLabel]   = useState(HINT_LABEL.TOO_FAR)
  const [device, setDevice]         = useState<CameraDevice | undefined>()

  const { hasPermission, requestPermission } = useCameraPermission()

  // Posición animada del indicador de distancia
  const indicatorX = useSharedValue(HINT_POSITION.TOO_FAR)

  // ── Pedir permiso si no lo tenemos ──
  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission, requestPermission])

  // ── Obtener la cámara trasera disponible ──
  useEffect(() => {
    Camera.getAvailableCameraDevices().then((devices) => {
      const back = devices.find((d) => d.position === "back")
      setDevice(back)
    })
  }, [])

  // ── Ref para acceder al hint actual desde el timer sin recrearlo ──
  const hintRef = useRef<DistanceHint>("TOO_FAR")

  // ── Timer de fase: "listo" a partir de 2.6 s, pero solo si OPTIMAL ──
  useEffect(() => {
    const timer = setTimeout(() => {
      // Revisar cada 500 ms si ya llegó al rango OPTIMAL
      const poll = setInterval(() => {
        if (hintRef.current === "OPTIMAL") {
          clearInterval(poll)
          setPhase("ready")
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        }
      }, 500)
      // Si ya es OPTIMAL al cumplir los 2.6 s, activar inmediatamente
      if (hintRef.current === "OPTIMAL") {
        clearInterval(poll)
        setPhase("ready")
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      }
      return () => clearInterval(poll)
    }, 2600)
    return () => clearTimeout(timer)
  }, [])

  // ── Callback del frame processor ──
  const handleGuidanceUpdate = useCallback(
    (newHint: DistanceHint, coverage: number) => {
      hintRef.current = newHint
      setHint(newHint)
      setHintLabel(HINT_LABEL[newHint])
      indicatorX.value = withSpring(HINT_POSITION[newHint], { damping: 15, stiffness: 100 })
      onCoverageUpdate?.(newHint, coverage)
    },
    [onCoverageUpdate, indicatorX],
  )

  const frameProcessor = useLiveDistanceGuidance(handleGuidanceUpdate)

  // ── Captura ──
  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return
    setCapturing(true)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      const photo = await cameraRef.current.takePhoto({ qualityPrioritization: "balanced" })
      const path = photo.path.startsWith("file://") ? photo.path : `file://${photo.path}`
      const base64 = await FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType.Base64,
      })
      onPictureTaken(base64, path, photo.width, photo.height)
    } catch {
      Alert.alert("Error", "No se pudo capturar la imagen. Intenta de nuevo.")
    } finally {
      setCapturing(false)
    }
  }

  // ── Estilo animado del indicador ──
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }))

  const isReady    = phase === "ready"
  const hintColor  = HINT_COLOR[hint]

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Se necesita acceso a la cámara para escanear basura.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Conceder permiso</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (!device) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.permissionText}>Iniciando cámara...</Text>
      </View>
    )
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo
        frameProcessor={frameProcessor}
        pixelFormat="rgb"
      />

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

      {/* ── Dark cutout overlay con frame y esquinas ── */}
      <ScanOverlay scanning={!isReady} />

      {/* ── Bottom controls ── */}
      <View style={styles.bottomControls}>
        <View style={styles.instructionPill}>
          <Text style={styles.instructionText}>Encuadra la basura en el marco</Text>
        </View>

        <View style={styles.hintRow}>
          <HintChip icon="resize-outline" label="1–2 metros del área" />
          <HintChip icon="sunny-outline" label="Buena iluminación" />
        </View>

        {/* ── Barra de distancia dinámica ── */}
        <View style={styles.distanceBar}>
          <Text style={styles.distanceLabel}>CERCA</Text>
          <View style={styles.distanceTrack}>
            <Animated.View
              style={[
                styles.distanceIndicator,
                { backgroundColor: hintColor },
                indicatorStyle,
              ]}
            />
          </View>
          <Text style={styles.distanceLabel}>LEJOS</Text>
        </View>
        <Text style={[styles.hintText, { color: hintColor }]}>{hintLabel}</Text>

        <Text style={styles.bottomHint}>
          {isReady
            ? "Presiona el botón cuando la basura esté bien encuadrada"
            : "Centra la acumulación de basura en el marco"}
        </Text>

        {/* ── Botón de captura ── */}
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
    </View>
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
  permissionContainer: {
    flex: 1, justifyContent: "center", alignItems: "center",
    backgroundColor: "#001828", gap: 20, padding: 32,
  },
  permissionText: { color: "#fff", fontSize: 15, textAlign: "center", lineHeight: 22 },
  permissionBtn: {
    backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 24,
    borderRadius: 12,
  },
  permissionBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

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
  dotBlue:  { backgroundColor: colors.primary },
  dotGreen: { backgroundColor: colors.secondary },
  statusText: { color: "#fff", fontSize: 13, fontWeight: "600", letterSpacing: 0.2 },

  bottomControls: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    top: SCAN_OVERLAY_V + SCAN_FRAME_SIZE,
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

  distanceBar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  distanceLabel: {
    color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "700", letterSpacing: 1,
  },
  distanceTrack: {
    width: 120, height: 4,
    backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 2, overflow: "visible",
  },
  distanceIndicator: {
    width: 16, height: 16, borderRadius: 8, position: "absolute", top: -6,
    elevation: 4, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
  },
  hintText: {
    fontSize: 12, fontWeight: "700", letterSpacing: 0.3, marginBottom: 10,
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
