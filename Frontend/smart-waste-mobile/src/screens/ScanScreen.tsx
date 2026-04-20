import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { CameraView, useCameraPermissions } from "expo-camera"
import * as Haptics from "expo-haptics"
import * as Location from "expo-location"
import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming
} from "react-native-reanimated"

import type { RootStackParamList } from "../navigation/AppNavigator"
import { analyzeImage } from "../services/image.service"
import { colors } from "../theme/colors"

type ScanNavProp = NativeStackNavigationProp<RootStackParamList, "Scan">
type Phase = "scanning" | "ready" | "captured"

const { width: SW, height: SH } = Dimensions.get("window")
const FRAME = Math.min(SW * 0.78, 300)
const BRACKET = 30
const THICKNESS = 4

// ─── Main screen ────────────────────────────────────────────────────────────

export default function ScanScreen() {
  const navigation = useNavigation<ScanNavProp>()
  const [camPerm, requestCamPerm] = useCameraPermissions()
  const [, requestLocPerm] = Location.useForegroundPermissions()

  const [phase, setPhase] = useState<Phase>("scanning")
  const [capturedUri, setCapturedUri] = useState<string | null>(null)
  const [capturedB64, setCapturedB64] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [restartKey, setRestartKey] = useState(0)

  const cameraRef = useRef<any>(null)
  const locationRef = useRef<Location.LocationObject | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Animations
  const scanY = useSharedValue(0)
  const frameScale = useSharedValue(1)
  const statusOpacity = useSharedValue(1)
  const frameGlow = useSharedValue(0)

  useEffect(() => {
    requestLocPerm()
    return () => { abortControllerRef.current?.abort() }
  }, [])

  // Restart scanning cycle whenever restartKey changes
  useEffect(() => {
    setPhase("scanning")
    startScanLine()
    startCornerPulse()

    // After 2.6 s the frame transitions to "ready" — purely visual, no auto-capture
    const readyTimer = setTimeout(() => transitionToReady(), 2600)
    return () => clearTimeout(readyTimer)
  }, [restartKey])

  const startScanLine = () => {
    scanY.value = 0
    scanY.value = withRepeat(
      withSequence(
        withTiming(FRAME - 2, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    )
  }

  const startCornerPulse = () => {
    frameScale.value = withRepeat(
      withSequence(withTiming(1.03, { duration: 900 }), withTiming(1, { duration: 900 })),
      -1,
    )
  }

  const transitionToReady = () => {
    setPhase("ready")
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    frameScale.value = withSequence(withTiming(1.06, { duration: 180 }), withSpring(1))
    frameGlow.value = withTiming(1, { duration: 400 })
    statusOpacity.value = withSequence(withTiming(0, { duration: 200 }), withTiming(1, { duration: 200 }))
  }

  const doCapture = async () => {
    if (!cameraRef.current || capturing) return
    setCapturing(true)
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

      try {
        locationRef.current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
      } catch (_) {}

      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.82 })
      setCapturedUri(photo.uri)
      setCapturedB64(photo.base64 ?? null)
      setPhase("captured")
      frameGlow.value = withTiming(0, { duration: 300 })
    } catch {
      Alert.alert("Error", "No se pudo capturar la imagen. Intenta de nuevo.")
      retake()
    } finally {
      setCapturing(false)
    }
  }

  const retake = () => {
    setCapturedUri(null)
    setCapturedB64(null)
    frameGlow.value = 0
    setRestartKey((k) => k + 1)
  }

  const handleAnalyze = async () => {
    if (!capturedB64) return
    setAnalyzing(true)
    setUploadProgress(0)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const lat = locationRef.current?.coords.latitude ?? 0
      const lng = locationRef.current?.coords.longitude ?? 0
      const result = await analyzeImage(capturedB64, lat, lng, undefined, {
        signal: controller.signal,
        onUploadProgress: setUploadProgress,
      })
      navigation.navigate("ScanResult", { result })
    } catch (e: any) {
      if (e?.code === "ERR_CANCELED") {
        retake()
        return
      }
      Alert.alert("Error", e?.response?.data?.error ?? "No se pudo procesar la imagen.")
    } finally {
      setAnalyzing(false)
      setUploadProgress(0)
      abortControllerRef.current = null
    }
  }

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort()
  }

  // Animated styles
  const scanStyle = useAnimatedStyle(() => ({ transform: [{ translateY: scanY.value }] }))
  const frameStyle = useAnimatedStyle(() => ({ transform: [{ scale: frameScale.value }] }))

  // ── Permission screen ──────────────────────────────────────────────────────
  if (!camPerm) {
    return (
      <View style={styles.permScreen}>
        <Ionicons name="camera-outline" size={72} color={colors.gray400} />
        <Text style={styles.permTitle}>Cargando cámara...</Text>
      </View>
    )
  }

  if (!camPerm.granted) {
    return (
      <View style={styles.permScreen}>
        <View style={styles.permIconWrap}>
          <Ionicons name="camera-outline" size={48} color={colors.primary} />
        </View>
        <Text style={styles.permTitle}>Cámara requerida</Text>
        <Text style={styles.permBody}>
          EMASEO necesita acceso a la cámara para fotografiar y reportar acumulaciones de basura.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestCamPerm}>
          <Ionicons name="camera" size={20} color="#fff" />
          <Text style={styles.permBtnText}>Permitir acceso</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()}>
          <Text style={styles.backLinkText}>Volver</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Photo review ───────────────────────────────────────────────────────────
  if (phase === "captured" && capturedUri) {
    return (
      <View style={styles.reviewContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />

        {/* Dark gradient overlay at bottom */}
        <View style={styles.reviewGradient} />

        <Animated.View entering={SlideInUp.duration(380).springify()} style={styles.reviewCard}>
          <View style={styles.reviewHandle} />

          <View style={styles.reviewTitleRow}>
            <View style={styles.reviewIconWrap}>
              <Ionicons name="checkmark" size={22} color="#fff" />
            </View>
            <View>
              <Text style={styles.reviewTitle}>Foto capturada</Text>
              <Text style={styles.reviewSub}>Revisa la imagen antes de enviar</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.analyzeBtn, analyzing && styles.analyzeBtnLoading]}
            onPress={handleAnalyze}
            disabled={analyzing}
            activeOpacity={0.85}
          >
            {analyzing ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.analyzeBtnText}>
                  {uploadProgress < 100
                    ? `Enviando imagen… ${uploadProgress}%`
                    : "Analizando incidencia…"}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="analytics-outline" size={20} color="#fff" />
                <Text style={styles.analyzeBtnText}>Analizar y Reportar</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.retakeBtn}
            onPress={analyzing ? handleCancelAnalysis : retake}
            activeOpacity={0.7}
          >
            <Ionicons
              name={analyzing ? "close-circle-outline" : "camera-reverse-outline"}
              size={20}
              color={colors.textSecondary}
            />
            <Text style={styles.retakeBtnText}>
              {analyzing ? "Cancelar envío" : "Tomar otra foto"}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    )
  }

  // ── Camera view ────────────────────────────────────────────────────────────
  const isReady = phase === "ready"
  const bracketColor = isReady ? colors.secondary : "rgba(255,255,255,0.75)"

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent={Platform.OS === "android"}
      />

      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back">

        {/* ── Top bar ── */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backCircle} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
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

        {/* ── Dark overlay with transparent window ── */}
        <View style={styles.overlayTop} />
        <View style={styles.overlayRow}>
          <View style={styles.overlaySide} />

          {/* Transparent frame window */}
          <Animated.View style={[styles.frame, frameStyle]}>
            {/* Corner brackets */}
            <Bracket pos="tl" color={bracketColor} />
            <Bracket pos="tr" color={bracketColor} />
            <Bracket pos="bl" color={bracketColor} />
            <Bracket pos="br" color={bracketColor} />

            {/* Scan line (scanning phase only) */}
            {phase === "scanning" && (
              <Animated.View style={[styles.scanLine, scanStyle]} />
            )}

            {/* Capture flash ring when ready */}
            {isReady && (
              <Animated.View
                entering={FadeIn.delay(100)}
                style={[styles.glowRing, { borderColor: colors.secondary }]}
              />
            )}
          </Animated.View>

          <View style={styles.overlaySide} />
        </View>

        <View style={styles.overlayBottom}>
          {/* Hints */}
          <View style={styles.hintRow}>
            <HintChip icon="resize-outline" label="1–2 metros del área" />
            <HintChip icon="sunny-outline" label="Buena iluminación" />
          </View>

          {/* Distance bar */}
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
            onPress={doCapture}
            disabled={capturing}
            activeOpacity={0.8}
          >
            {capturing ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </TouchableOpacity>

          <Text style={styles.shutterLabel}>
            {capturing ? "Capturando..." : "Tomar foto"}
          </Text>
        </View>

      </CameraView>
    </View>
  )
}

// ─── Corner bracket component ────────────────────────────────────────────────

function Bracket({ pos, color }: { pos: "tl" | "tr" | "bl" | "br"; color: string }) {
  const isTop = pos === "tl" || pos === "tr"
  const isLeft = pos === "tl" || pos === "bl"

  return (
    <View
      style={[
        styles.bracketWrap,
        isTop ? { top: 0 } : { bottom: 0 },
        isLeft ? { left: 0 } : { right: 0 },
      ]}
    >
      {/* Horizontal arm */}
      <View
        style={{
          position: "absolute",
          [isTop ? "top" : "bottom"]: 0,
          [isLeft ? "left" : "right"]: 0,
          width: BRACKET,
          height: THICKNESS,
          backgroundColor: color,
          borderRadius: 2,
        }}
      />
      {/* Vertical arm */}
      <View
        style={{
          position: "absolute",
          [isTop ? "top" : "bottom"]: 0,
          [isLeft ? "left" : "right"]: 0,
          width: THICKNESS,
          height: BRACKET,
          backgroundColor: color,
          borderRadius: 2,
        }}
      />
    </View>
  )
}

// ─── Hint chip ───────────────────────────────────────────────────────────────

function HintChip({ icon, label }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string }) {
  return (
    <View style={styles.hintChip}>
      <Ionicons name={icon} size={13} color="rgba(255,255,255,0.85)" />
      <Text style={styles.hintChipText}>{label}</Text>
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const OVERLAY_V = (SH - FRAME) / 2 - 60

const styles = StyleSheet.create({
  // ── Permissions
  permScreen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  permIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  permTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 10,
    textAlign: "center",
  },
  permBody: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  permBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    elevation: 4,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  permBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  backLink: { marginTop: 16 },
  backLinkText: { color: colors.primary, fontSize: 15 },

  // ── Camera UI
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "android" ? 44 : 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  topTitle: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Status
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  statusBadgeReady: {
    backgroundColor: "rgba(0,168,89,0.25)",
    borderColor: "rgba(0,168,89,0.5)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotBlue: { backgroundColor: colors.primary },
  dotGreen: { backgroundColor: colors.secondary },
  statusText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },

  // Overlay
  overlayTop: {
    height: OVERLAY_V,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  overlayRow: {
    flexDirection: "row",
    height: FRAME,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    paddingTop: 20,
    alignItems: "center",
  },

  // Frame (transparent window)
  frame: {
    width: FRAME,
    height: FRAME,
    overflow: "hidden",
  },
  bracketWrap: {
    position: "absolute",
    width: BRACKET + 4,
    height: BRACKET + 4,
  },

  // Scan line
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.secondary,
    opacity: 0.8,
    shadowColor: colors.secondary,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },

  // Glow ring when ready
  glowRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: 4,
  },

  // Hints
  hintRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  hintChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  hintChipText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "500",
  },

  // Distance bar
  distanceBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  distanceLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  distanceTrack: {
    width: 120,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 2,
    justifyContent: "center",
  },
  distanceIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignSelf: "center",
    elevation: 4,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  bottomHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 24,
    marginBottom: 4,
  },

  // ── Shutter button
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 18,
  },
  shutterBtnDisabled: {
    borderColor: "rgba(255,255,255,0.35)",
    opacity: 0.7,
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#fff",
  },
  shutterLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
    letterSpacing: 0.5,
  },

  // ── Photo review
  reviewContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  reviewGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "55%",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  reviewCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    elevation: 20,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
  },
  reviewHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.gray200,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  reviewTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 24,
  },
  reviewIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.secondary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: colors.secondary,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  reviewTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  reviewSub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  analyzeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.secondary,
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: 12,
    elevation: 4,
    shadowColor: colors.secondary,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  analyzeBtnLoading: { backgroundColor: colors.secondaryDark, opacity: 0.8 },
  analyzeBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  retakeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.gray200,
  },
  retakeBtnText: { color: colors.textSecondary, fontWeight: "600", fontSize: 15 },
})
