import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { Camera } from "expo-camera"
import * as Location from "expo-location"
import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import Animated, { SlideInUp } from "react-native-reanimated"

import AnalyzingOverlay from "../components/AnalyzingOverlay"
import CameraCapture from "../components/CameraCapture"
import type { RootStackParamList } from "../navigation/AppNavigator"
import { analyzeImage } from "../services/image.service"
import { colors } from "../theme/colors"

type ScanNavProp = NativeStackNavigationProp<RootStackParamList, "Scan">

export default function ScanScreen() {
  const navigation = useNavigation<ScanNavProp>()
  const [camGranted, setCamGranted] = useState<boolean | null>(null)
  const [locDenied, setLocDenied] = useState(false)

  const [capturedUri, setCapturedUri] = useState<string | null>(null)
  const [capturedB64, setCapturedB64] = useState<string | null>(null)
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [restartKey, setRestartKey] = useState(0)

  const abortControllerRef = useRef<AbortController | null>(null)

  // Request camera first, then location (two overlapping dialogs break on iOS/Android)
  useEffect(() => {
    ;(async () => {
      const { status: camStatus, canAskAgain: camCanAsk } =
        await Camera.requestCameraPermissionsAsync()
      if (camStatus !== "granted") {
        setCamGranted(false)
        if (!camCanAsk) {
          Alert.alert(
            "Permisos Denegados",
            "Por favor, habilita la cámara y ubicación en la configuración de tu celular",
            [
              { text: "Abrir Configuración", onPress: () => Linking.openSettings() },
              { text: "Cancelar", style: "cancel" },
            ],
          )
        }
        return
      }
      setCamGranted(true)

      const { status: locStatus, canAskAgain: locCanAsk } =
        await Location.requestForegroundPermissionsAsync()
      if (locStatus !== "granted") {
        setLocDenied(true)
        if (!locCanAsk) {
          Alert.alert(
            "Permisos Denegados",
            "Por favor, habilita la cámara y ubicación en la configuración de tu celular",
            [
              { text: "Abrir Configuración", onPress: () => Linking.openSettings() },
              { text: "Cancelar", style: "cancel" },
            ],
          )
        }
      }
    })()
  }, [])

  useEffect(() => {
    return () => { abortControllerRef.current?.abort() }
  }, [])

  // Called by CameraCapture once the shutter fires
  const handlePictureTaken = async (base64: string, uri: string) => {
    setCapturedUri(uri)
    setCapturedB64(base64)
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
    } catch {
      setLocation(null)
    }
  }

  const retake = () => {
    setCapturedUri(null)
    setCapturedB64(null)
    setRestartKey((k) => k + 1)
  }

  const handleAnalyze = async () => {
    if (!capturedB64) return
    setAnalyzing(true)
    setUploadProgress(0)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const lat = location?.latitude ?? 0
      const lng = location?.longitude ?? 0
      const result = await analyzeImage(capturedB64, lat, lng, undefined, {
        signal: controller.signal,
        onUploadProgress: setUploadProgress,
      })
      navigation.navigate("ScanResult", { result, latitude: lat, longitude: lng })
    } catch (e: any) {
      if (e?.code === "ERR_CANCELED") {
        retake()
        return
      }
      const isNetworkError = !e?.response
      Alert.alert(
        "Error de conexión",
        isNetworkError
          ? "Verifica tu conexión a internet e inténtalo de nuevo."
          : "No se pudo procesar la imagen. Por favor inténtalo de nuevo.",
        [{ text: "Reintentar", onPress: handleAnalyze }],
      )
    } finally {
      setAnalyzing(false)
      setUploadProgress(0)
      abortControllerRef.current = null
    }
  }

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort()
  }

  // ── Permission screens ────────────────────────────────────────────────────

  if (camGranted === null) {
    return (
      <View style={styles.permScreen}>
        <Ionicons name="camera-outline" size={72} color={colors.gray400} />
        <Text style={styles.permTitle}>Cargando cámara...</Text>
      </View>
    )
  }

  if (camGranted === false) {
    return (
      <View style={styles.permScreen}>
        <View style={styles.permIconWrap}>
          <Ionicons name="camera-outline" size={48} color={colors.primary} />
        </View>
        <Text style={styles.permTitle}>Cámara requerida</Text>
        <Text style={styles.permBody}>
          EMASEO necesita acceso a la cámara para fotografiar y reportar acumulaciones de basura.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={() => Linking.openSettings()}>
          <Ionicons name="settings-outline" size={20} color="#fff" />
          <Text style={styles.permBtnText}>Abrir Configuración</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()}>
          <Text style={styles.backLinkText}>Volver</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (locDenied) {
    return (
      <View style={styles.permScreen}>
        <View style={styles.permIconWrap}>
          <Ionicons name="location-outline" size={48} color={colors.primary} />
        </View>
        <Text style={styles.permTitle}>Ubicación requerida</Text>
        <Text style={styles.permBody}>
          EMASEO necesita tu ubicación para registrar con precisión dónde se encuentra la
          acumulación de basura y asignarla a la zona correcta.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={() => Linking.openSettings()}>
          <Ionicons name="settings-outline" size={20} color="#fff" />
          <Text style={styles.permBtnText}>Abrir Configuración</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={() => navigation.goBack()}>
          <Text style={styles.backLinkText}>Volver</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Photo review ───────────────────────────────────────────────────────────

  if (capturedUri) {
    return (
      <View style={styles.reviewContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />

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
            {analyzing && uploadProgress < 100 ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.analyzeBtnText}>
                  {`Enviando imagen… ${uploadProgress}%`}
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
            onPress={retake}
            disabled={analyzing}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-reverse-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.retakeBtnText}>Tomar otra foto</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Overlay de análisis ML (aparece sólo cuando la imagen ya se subió) */}
        <AnalyzingOverlay
          isAnalyzing={analyzing && uploadProgress >= 100}
          label="Analizando incidencia..."
          onCancel={handleCancelAnalysis}
        />
      </View>
    )
  }

  // ── Camera view (delegated to CameraCapture) ──────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent={Platform.OS === "android"}
      />
      <CameraCapture
        key={restartKey}
        onPictureTaken={handlePictureTaken}
        onBack={() => navigation.goBack()}
      />
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  permScreen: {
    flex: 1, backgroundColor: colors.background,
    justifyContent: "center", alignItems: "center", padding: 32,
  },
  permIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.primaryLight,
    justifyContent: "center", alignItems: "center", marginBottom: 20,
  },
  permTitle: {
    fontSize: 22, fontWeight: "700", color: colors.textPrimary,
    marginTop: 16, marginBottom: 10, textAlign: "center",
  },
  permBody: {
    fontSize: 15, color: colors.textSecondary,
    textAlign: "center", lineHeight: 22, marginBottom: 28,
  },
  permBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14,
    elevation: 4,
    shadowColor: colors.primary, shadowOpacity: 0.3,
    shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  permBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  backLink: { marginTop: 16 },
  backLinkText: { color: colors.primary, fontSize: 15 },

  reviewContainer: { flex: 1, backgroundColor: "#000" },
  reviewGradient: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    height: "55%", backgroundColor: "rgba(0,0,0,0.72)",
  },
  reviewCard: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    elevation: 20,
    shadowColor: "#000", shadowOpacity: 0.3,
    shadowRadius: 20, shadowOffset: { width: 0, height: -4 },
  },
  reviewHandle: {
    width: 40, height: 4, backgroundColor: colors.gray200,
    borderRadius: 2, alignSelf: "center", marginBottom: 20,
  },
  reviewTitleRow: {
    flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 24,
  },
  reviewIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.secondary,
    justifyContent: "center", alignItems: "center",
    elevation: 4,
    shadowColor: colors.secondary, shadowOpacity: 0.4,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  reviewTitle: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  reviewSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  analyzeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, backgroundColor: colors.secondary,
    paddingVertical: 16, borderRadius: 14, marginBottom: 12,
    elevation: 4,
    shadowColor: colors.secondary, shadowOpacity: 0.35,
    shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  analyzeBtnLoading: { backgroundColor: colors.secondaryDark, opacity: 0.8 },
  analyzeBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  retakeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.gray200,
  },
  retakeBtnText: { color: colors.textSecondary, fontWeight: "600", fontSize: 15 },
})
