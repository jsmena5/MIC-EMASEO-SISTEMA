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
  type StyleProp,
  type ViewStyle,
} from "react-native"
import Animated, {
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"
import { Camera, useCameraDevice, useCameraPermission } from "react-native-vision-camera"

import { colors } from "../theme/colors"
import type { DistanceHint, LightingHint } from "../types/incident"
import { useLiveDistanceGuidance, brightnessToLightingHint } from "../hooks/useLiveDistanceGuidance"
import ScanOverlay from "./ScanOverlay"
import { SCAN_FRAME_SIZE, SCAN_OVERLAY_V } from "../utils/cropToScanFrame"

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

// Color de feedback semafórico para cada estado
const READY_COLOR = colors.secondary
const WARN_COLOR  = "#FFA726"
const NEAR_COLOR  = "#FF5252"

// Posición X del indicador en la barra de distancia (pista de 120 px, sin el ancho del indicador)
const HINT_POSITION: Record<DistanceHint, number> = {
  TOO_CLOSE: 4,    // extremo izquierdo (muy cerca)
  OPTIMAL:   52,   // centro
  TOO_FAR:   100,  // extremo derecho (muy lejos)
}

const HINT_COLOR: Record<DistanceHint, string> = {
  TOO_CLOSE: "#FF5252",
  OPTIMAL:   colors.secondary,
  TOO_FAR:   "#FFA726",
}

// Mensaje y color de feedback principal (prioriza: cuenta atrás → sin guía →
// distancia → iluminación → listo). Función pura, testeable.
function computeStatusFeedback(
  countdown: number | null,
  guidanceLive: boolean,
  hint: DistanceHint,
  lighting: LightingHint,
): { msg: string; color: string } {
  if (countdown != null)         return { msg: "Capturando…", color: READY_COLOR }
  if (!guidanceLive)             return { msg: "Posiciónate frente a la basura", color: "#fff" }
  if (hint === "TOO_FAR")        return { msg: "Acércate a la basura", color: WARN_COLOR }
  if (hint === "TOO_CLOSE")      return { msg: "Aléjate un poco", color: NEAR_COLOR }
  if (lighting === "TOO_DARK")   return { msg: "Necesitas más luz", color: WARN_COLOR }
  if (lighting === "TOO_BRIGHT") return { msg: "Demasiado brillo o reflejo", color: WARN_COLOR }
  return { msg: "¡Perfecto! Mantén la posición", color: READY_COLOR }
}

// Decide qué hacer ante un error de la cámara. Si el fallo es del frame processor
// (worklets no disponibles), se desactiva la guía en vivo sin matar la cámara.
function cameraErrorAction(
  e: { code?: string; message?: string },
  fpEnabled: boolean,
): { debug: string; disableFp: boolean; fatal: string | null } {
  const debug = `onError: ${e.code ?? ""} ${e.message ?? ""}`.trim()
  const msg = `${e.code ?? ""} ${e.message ?? ""}`.toLowerCase()
  if (fpEnabled && (msg.includes("frame") || msg.includes("worklet"))) {
    return { debug, disableFp: true, fatal: null }
  }
  return { debug, disableFp: false, fatal: e.message ?? null }
}

// ─── Public component ────────────────────────────────────────────────────────

export default function CameraCapture({
  onPictureTaken,
  onCoverageUpdate,
  onBack,
}: CameraCaptureProps) {
  const cameraRef = useRef<InstanceType<typeof Camera>>(null)
  const [capturing, setCapturing]   = useState(false)
  const [hint, setHint]             = useState<DistanceHint>("TOO_FAR")
  const [lighting, setLighting]     = useState<LightingHint>("OK")
  // "Listo" = distancia óptima Y buena luz, sostenido un instante (anti-parpadeo).
  const [isReady, setIsReady]       = useState(false)
  // Cuenta regresiva de captura automática (3,2,1) o null si no está contando.
  const [countdown, setCountdown]   = useState<number | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  // true mientras el frame processor (guía de distancia en vivo) esté operativo.
  // Si VisionCamera reporta que los frame processors no están disponibles
  // (worklets no enlazados en el build), lo desactivamos para que la cámara
  // siga funcionando SIN la barra de distancia, en vez de quedar en negro.
  const [fpEnabled, setFpEnabled]   = useState(true)
  // true en cuanto llega la primera medición real del frame processor.
  const [guidanceLive, setGuidanceLive] = useState(false)
  // ── Diagnóstico temporal: causa por la que el sensor en vivo no arranca ──
  const [debugMsg, setDebugMsg]     = useState<string | null>(null)
  const [noGuidance, setNoGuidance] = useState(false)

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
    const t = setTimeout(() => setCamActive(true), 800)
    return () => clearTimeout(t)
  }, [hasPermission, device])

  // ── Callback del frame processor (distancia + iluminación en vivo) ──
  const handleGuidanceUpdate = useCallback(
    (newHint: DistanceHint, coverage: number, brightness: number) => {
      if (!guidanceLive) setGuidanceLive(true)
      setHint(newHint)
      setLighting(brightnessToLightingHint(brightness))
      indicatorX.value = withSpring(HINT_POSITION[newHint], { damping: 15, stiffness: 100 })
      onCoverageUpdate?.(newHint, coverage)
    },
    [onCoverageUpdate, indicatorX, guidanceLive],
  )

  const frameProcessor = useLiveDistanceGuidance(handleGuidanceUpdate, setDebugMsg)

  // Diagnóstico: si tras 3.5 s no llegó ninguna medición del frame processor,
  // marcamos "sin datos del sensor" para mostrarlo en pantalla.
  useEffect(() => {
    if (guidanceLive) { setNoGuidance(false); return }
    const t = setTimeout(() => { if (!guidanceLive) setNoGuidance(true) }, 3500)
    return () => clearTimeout(t)
  }, [guidanceLive])

  // El encuadre es óptimo cuando la distancia es correcta Y hay buena luz.
  const allGood = guidanceLive && hint === "OPTIMAL" && lighting === "OK"
  // Captura automática armada solo si el sensor en vivo está disponible.
  const autoCaptureArmed = fpEnabled && guidanceLive

  // ── El encuadre es una GUÍA, nunca un bloqueo ─────────────────────────────────
  // La medición de distancia es un heurístico de densidad de bordes, no un detector
  // de basura ni de distancia real. Por eso NUNCA impide disparar: el tap manual
  // siempre captura y la validación real la hace el servidor (CLIP/MiDaS). `isReady`
  // (encuadre óptimo sostenido) solo ARMA la auto-captura y pinta el overlay verde.

  // Ref a la última función de captura (evita closures obsoletas en los timers).
  const captureRef = useRef<() => void>(() => {})

  // ── "Listo" con anti-parpadeo: allGood sostenido ~350 ms ──
  useEffect(() => {
    if (allGood) {
      const t = setTimeout(() => setIsReady(true), 350)
      return () => clearTimeout(t)
    }
    setIsReady(false)
  }, [allGood])

  // ── Captura automática con cuenta regresiva 3-2-1, cancelable al moverse ──
  // Si el encuadre deja de estar listo (el usuario se movió o cambió la luz),
  // el cleanup limpia el intervalo y se reinicia la cuenta.
  useEffect(() => {
    if (!autoCaptureArmed || capturing || !isReady) {
      setCountdown(null)
      return
    }
    let n = 3
    setCountdown(3)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    const iv = setInterval(() => {
      n -= 1
      if (n <= 0) {
        clearInterval(iv)
        setCountdown(null)
        captureRef.current()
      } else {
        setCountdown(n)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
      }
    }, 700)
    return () => clearInterval(iv)
  }, [isReady, autoCaptureArmed, capturing])

  // ── Captura ──
  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return
    // Sin gate: el tap manual siempre dispara, esté o no "óptimo" el encuadre.
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

  // Mantener captureRef apuntando a la última handleCapture (para los timers).
  useEffect(() => { captureRef.current = handleCapture })

  // ── Estilo animado del indicador ──
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }))

  const hintColor = HINT_COLOR[hint]

  const { msg: statusMsg, color: statusColor } = computeStatusFeedback(
    countdown, guidanceLive, hint, lighting,
  )

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
          // matamos la cámara: la desactivamos y seguimos sin guía en vivo.
          const action = cameraErrorAction(e, fpEnabled)
          setDebugMsg(action.debug)
          if (action.disableFp) setFpEnabled(false)
          else setCameraError(action.fatal)
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

      {/* ── Diagnóstico temporal: se oculta solo cuando el sensor en vivo funciona ── */}
      {!guidanceLive && (
        <View style={styles.debugBox} pointerEvents="none">
          <Text style={styles.debugText}>
            🔧 fp:{fpEnabled ? "on" : "off"} · live:{guidanceLive ? "sí" : "no"}{noGuidance ? " · sin datos 3.5s" : ""}
          </Text>
          {debugMsg ? <Text style={styles.debugText}>{debugMsg}</Text> : null}
        </View>
      )}

      {/* ── Status badge (mensaje de feedback en vivo) ── */}
      <View style={[styles.statusBadge, isReady && styles.statusBadgeReady]}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{statusMsg}</Text>
      </View>

      {/* ── Dark cutout overlay con frame y esquinas (verde cuando está listo) ── */}
      <ScanOverlay scanning={!isReady} />

      {/* ── Cuenta regresiva de captura automática, centrada en el recuadro ── */}
      {countdown != null && (
        <View style={styles.countdownWrap} pointerEvents="none">
          <Animated.View key={countdown} entering={ZoomIn.duration(250)} style={styles.countdownCircle}>
            <Text style={styles.countdownNum}>{countdown}</Text>
          </Animated.View>
        </View>
      )}

      {/* ── Bottom controls ── */}
      <CameraBottomControls
        hint={hint}
        lighting={lighting}
        guidanceLive={guidanceLive}
        fpEnabled={fpEnabled}
        autoCaptureArmed={autoCaptureArmed}
        hintColor={hintColor}
        statusColor={statusColor}
        statusMsg={statusMsg}
        indicatorStyle={indicatorStyle}
        capturing={capturing}
        countdown={countdown}
        onCapture={handleCapture}
      />
    </View>
  )
}

// ─── Controles inferiores (checklist, barra de distancia, obturador) ──────────
// Extraído de CameraCapture para mantener el componente bajo el umbral de complejidad.
function CameraBottomControls({
  hint, lighting, guidanceLive, fpEnabled, autoCaptureArmed,
  hintColor, statusColor, statusMsg, indicatorStyle, capturing, countdown, onCapture,
}: {
  hint: DistanceHint
  lighting: LightingHint
  guidanceLive: boolean
  fpEnabled: boolean
  autoCaptureArmed: boolean
  hintColor: string
  statusColor: string
  statusMsg: string
  indicatorStyle: StyleProp<ViewStyle>
  capturing: boolean
  countdown: number | null
  onCapture: () => void
}) {
  return (
    <View style={styles.bottomControls}>
      <View style={styles.instructionPill}>
        <Text style={styles.instructionText}>Encuadra la basura en el marco</Text>
      </View>

      <View style={styles.hintRow}>
        <CheckChip icon="resize-outline" label="Distancia"    ok={hint === "OPTIMAL"} active={guidanceLive} />
        <CheckChip icon="sunny-outline"  label="Iluminación"  ok={lighting === "OK"}  active={guidanceLive} />
      </View>

      {/* ── Barra de distancia dinámica (solo si el sensor entrega datos) ── */}
      {fpEnabled && guidanceLive ? (
        <>
          <View style={styles.distanceBar}>
            <Text style={styles.distanceLabel}>CERCA</Text>
            <View style={styles.distanceTrack}>
              <Animated.View
                style={[styles.distanceIndicator, { backgroundColor: hintColor }, indicatorStyle]}
              />
            </View>
            <Text style={styles.distanceLabel}>LEJOS</Text>
          </View>
          <Text style={[styles.hintText, { color: statusColor }]}>{statusMsg}</Text>
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
        {autoCaptureArmed
          ? "Se toma sola cuando el encuadre esté en verde, o tómala tú cuando quieras."
          : "Centra la acumulación de basura en el marco y toma la foto"}
      </Text>

      {/* ── Botón de captura (siempre activo; el encuadre es solo guía) ── */}
      <TouchableOpacity
        style={[styles.shutterBtn, capturing && styles.shutterBtnDisabled]}
        onPress={onCapture}
        disabled={capturing}
        activeOpacity={0.8}
      >
        {capturing
          ? <ActivityIndicator size="large" color="#fff" />
          : <View style={styles.shutterInner} />
        }
      </TouchableOpacity>

      <Text style={styles.shutterLabel}>
        {(() => {
          if (capturing) return "Capturando..."
          if (countdown != null) return "Captura automática…"
          return "Tomar foto"
        })()}
      </Text>
    </View>
  )
}

// ─── Check chip (item de checklist que se pone verde al cumplirse) ────────────

function CheckChip({ icon, label, ok, active }: {
  readonly icon: React.ComponentProps<typeof Ionicons>["name"]
  readonly label: string
  readonly ok: boolean
  readonly active: boolean
}) {
  const done = active && ok
  return (
    <View style={[styles.hintChip, done && styles.hintChipOk]}>
      <Ionicons
        name={done ? "checkmark-circle" : icon}
        size={14}
        color={done ? READY_COLOR : "rgba(255,255,255,0.85)"}
      />
      <Text style={[styles.hintChipText, done && { color: READY_COLOR, fontWeight: "700" }]}>
        {label}
      </Text>
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
  debugBox: {
    alignSelf: "center",
    backgroundColor: "rgba(220,38,38,0.85)",
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10,
    marginBottom: 8, maxWidth: "92%",
  },
  debugText: { color: "#fff", fontSize: 11, fontWeight: "600", textAlign: "center" },

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
  hintChipOk: {
    backgroundColor: "rgba(0,168,89,0.18)",
    borderWidth: 1, borderColor: "rgba(0,168,89,0.5)",
  },

  countdownWrap: {
    position: "absolute",
    top: SCAN_OVERLAY_V, left: 0, right: 0, height: SCAN_FRAME_SIZE,
    justifyContent: "center", alignItems: "center",
  },
  countdownCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 3, borderColor: READY_COLOR,
    justifyContent: "center", alignItems: "center",
  },
  countdownNum: {
    color: "#fff", fontSize: 52, fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },

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
