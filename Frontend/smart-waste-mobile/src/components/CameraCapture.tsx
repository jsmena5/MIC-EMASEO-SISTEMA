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
import { Camera, useCameraDevice, useCameraPermission } from "react-native-vision-camera"

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
  const [cameraError, setCameraError] = useState<string | null>(null)
  // true mientras el frame processor (guía de distancia en vivo) esté operativo.
  // Si VisionCamera reporta que los frame processors no están disponibles
  // (worklets no enlazados en el build), lo desactivamos para que la cámara
  // siga funcionando SIN la barra de distancia, en vez de quedar en negro.
  const [fpEnabled, setFpEnabled]   = useState(true)
  // true en cuanto llega la primera medición real del frame processor.
  const [guidanceLive, setGuidanceLive] = useState(false)

  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice("back")

  // Activación diferida de la cámara. En Android, montar la sesión de cámara en
  // el mismo instante en que se concede el permiso (la Activity se está
  // reconfigurando tras cerrar el diálogo de permisos) deja el preview en negro
  // hasta el siguiente arranque. Esperar a tener permiso + device y diferir
  // `isActive` ~350 ms deja que la superficie se estabilice antes de activar la
  // cámara, eliminando el "negro en el primer intento".
  const [camActive, setCamActive] = useState(false)

  // Posición animada del indicador de distancia
  const indicatorX = useSharedValue(HINT_POSITION.TOO_FAR)

  // ── Pedir permiso si no lo tenemos ──
  useEffect(() => {
    if (!hasPermission) requestPermission()
  }, [hasPermission, requestPermission])

  // ── Activar la cámara con un pequeño retraso una vez lista ──
  useEffect(() => {
    if (!hasPermission || !device) {
      setCamActive(false)
      return
    }
    const t = setTimeout(() => setCamActive(true), 350)
    return () => clearTimeout(t)
  }, [hasPermission, device])

  // ── Ref para acceder al hint actual desde el timer sin recrearlo ──
  const hintRef = useRef<DistanceHint>("TOO_FAR")

  // ── Timer de fase: "listo" a partir de 2.6 s, pero solo si OPTIMAL ──
  // Si la guía en vivo no está disponible (fpEnabled=false), no se puede medir
  // distancia: pasamos a "listo" tras un breve margen para no dejar al usuario
  // atascado en "Buscando área óptima..." indefinidamente.
  useEffect(() => {
    if (!fpEnabled) {
      const t = setTimeout(() => setPhase("ready"), 1200)
      return () => clearTimeout(t)
    }
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
  }, [fpEnabled])

  // ── Callback del frame processor ──
  const handleGuidanceUpdate = useCallback(
    (newHint: DistanceHint, coverage: number) => {
      if (!guidanceLive) setGuidanceLive(true)
      hintRef.current = newHint
      setHint(newHint)
      setHintLabel(HINT_LABEL[newHint])
      indicatorX.value = withSpring(HINT_POSITION[newHint], { damping: 15, stiffness: 100 })
      onCoverageUpdate?.(newHint, coverage)
    },
    [onCoverageUpdate, indicatorX, guidanceLive],
  )

  const frameProcessor = useLiveDistanceGuidance(handleGuidanceUpdate)

  // ── Captura ──
  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return
    setCapturing(true)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      const photo = await cameraRef.current.takePhoto({})
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

  if (cameraError) {
    return (
      <View style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={48} color="rgba(255,255,255,0.4)" />
        <Text style={[styles.permissionText, { marginTop: 12 }]}>
          No se pudo iniciar la cámara. Cierra y vuelve a abrir la pantalla.
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 8 }}>
          {cameraError}
        </Text>
      </View>
    )
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        key={`cam-${device.id}`}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={camActive}
        photo
        pixelFormat="yuv"
        frameProcessor={fpEnabled ? frameProcessor : undefined}
        onError={(e) => {
          // Si el fallo es del frame processor (worklets no disponibles), NO
          // matamos la cámara: la desactivamos y re-renderizamos sin guía en
          // vivo para que el usuario igual pueda capturar.
          const msg = `${e.code ?? ""} ${e.message ?? ""}`.toLowerCase()
          if (fpEnabled && (msg.includes("frame") || msg.includes("worklet"))) {
            setFpEnabled(false)
          } else {
            setCameraError(e.message)
          }
        }}
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

        {/* ── Barra de distancia dinámica (solo si el sensor entrega datos) ── */}
        {fpEnabled && guidanceLive ? (
          <>
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
          </>
        ) : (
          <View style={styles.staticGuide}>
            <Ionicons name="resize-outline" size={14} color="rgba(255,255,255,0.7)" />
            <Text style={styles.staticGuideText}>
              Mantén la cámara a 1–2 m de la basura
            </Text>
          </View>
        )}

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
  staticGuide: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginBottom: 10, marginTop: 2,
  },
  staticGuideText: {
    color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600",
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
