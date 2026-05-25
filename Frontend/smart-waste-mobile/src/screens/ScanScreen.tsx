import AsyncStorage from "@react-native-async-storage/async-storage"
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
import { useNetwork } from "../contexts/NetworkContext"
import type { RootStackParamList } from "../navigation/AppNavigator"
import {
  analyzeImage,
  getTaskStatus,
  type AnalysisResult,
} from "../services/image.service"
import { enqueuePendingReport } from "../services/offlineQueue.service"
import { colors } from "../theme/colors"

type ScanNavProp = NativeStackNavigationProp<RootStackParamList, "Scan">

type AnalysisPhase = "idle" | "uploading" | "queued" | "analyzing" | "saving" | "done"

const POLL_INTERVAL_MS = 2000
const SLOW_THRESHOLD_MS = 10000
const POLL_TIMEOUT_MS = 120_000
const LOCATION_RETRY_DELAY_MS = 3000
// AsyncStorage key for task IDs whose analysis is still in progress on the server
const PROCESSING_TASKS_KEY = "processing_task_ids"

function overlayLabel(phase: AnalysisPhase, slow: boolean): string {
  if (phase === "queued")    return "Imagen recibida, preparando análisis..."
  if (phase === "saving")    return "Guardando resultado..."
  if (phase === "analyzing") return slow
    ? "Analizando... esto puede tomar un poco"
    : "Analizando incidencia..."
  return "Analizando incidencia..."
}

export default function ScanScreen() {
  const navigation = useNavigation<ScanNavProp>()
  const { isConnected, pendingCount, refreshPendingCount } = useNetwork()

  const [camGranted, setCamGranted]   = useState<boolean | null>(null)
  const [locDenied, setLocDenied]     = useState(false)
  const [locError, setLocError]       = useState<string | null>(null) // Nuevo: error de GPS
  const [isRetryingLocation, setIsRetryingLocation] = useState(false)

  const [capturedUri, setCapturedUri] = useState<string | null>(null)
  const [capturedB64, setCapturedB64] = useState<string | null>(null)
  const [location, setLocation]       = useState<{ latitude: number; longitude: number } | null>(null)

  const [phase, setPhase]               = useState<AnalysisPhase>("idle")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isSlowMessage, setIsSlowMessage]   = useState(false)

  const abortControllerRef   = useRef<AbortController | null>(null)
  const pollingIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollingStartRef      = useRef<number>(0)
  const pollingInProgressRef = useRef(false)
  // Guarda el task_id activo para que handleCancelAnalysis pueda persistirlo
  const currentTaskIdRef     = useRef<string | null>(null)

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
            "Por favor, habilita la cámara en la configuración de tu celular",
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
            "Por favor, habilita la ubicación en la configuración de tu celular",
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
    return () => {
      abortControllerRef.current?.abort()
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
    }
  }, [])

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    pollingInProgressRef.current = false
  }

  // Función mejorada para obtener ubicación con reintentos
  const getCurrentLocation = async (showErrorAlert = false): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      setLocError(null)
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      })
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      }
      // Validar que las coordenadas sean reales (no 0,0)
      if (coords.latitude === 0 && coords.longitude === 0) {
        throw new Error("Coordenadas inválidas (0,0)")
      }
      return coords
    } catch (error: any) {
      console.log("[ScanScreen] Error obteniendo ubicación:", error.message)
      
      let userMessage = "No se pudo obtener tu ubicación. "
      
      if (error.message?.includes("location services disabled") || error.code === "E_LOCATION_SERVICES_DISABLED") {
        userMessage += "El GPS está desactivado."
      } else if (error.message?.includes("timeout")) {
        userMessage += "La búsqueda de GPS tomó demasiado tiempo. Asegúrate de estar en un lugar abierto."
      } else {
        userMessage += "Activa el GPS o acerca tu dispositivo a una ventana."
      }
      
      if (showErrorAlert) {
        Alert.alert("Ubicación no disponible", userMessage, [
          { text: "Reintentar", onPress: () => getCurrentLocation(true) },
          { text: "Usar sin ubicación", style: "cancel", onPress: () => setLocError("no_location") },
        ])
      }
      
      setLocError(userMessage)
      return null
    }
  }

  // Called by CameraCapture once the shutter fires
  const handlePictureTaken = async (base64: string, uri: string) => {
    setCapturedUri(uri)
    setCapturedB64(base64)
    setLocError(null)
    setIsRetryingLocation(true)
    
    try {
      const loc = await getCurrentLocation(true) // Mostrar alerta si falla
      if (loc) {
        setLocation(loc)
        setLocError(null)
      } else {
        setLocation(null)
      }
    } finally {
      setIsRetryingLocation(false)
    }
  }

  const retake = () => {
    stopPolling()
    abortControllerRef.current?.abort()
    currentTaskIdRef.current = null
    setCapturedUri(null)
    setCapturedB64(null)
    setLocation(null)
    setLocError(null)
    setPhase("idle")
    setIsSlowMessage(false)
    setUploadProgress(0)
  }

  // Cancela el overlay de análisis pero deja la tarea corriendo en el servidor.
  // Guarda el task_id en AsyncStorage para que el historial pueda rastrearlo
  // y muestra una alerta informando al usuario que puede ver el resultado allí.
  const handleCancelAnalysis = async () => {
    stopPolling()
    abortControllerRef.current?.abort()
    setPhase("idle")
    setIsSlowMessage(false)

    const taskId = currentTaskIdRef.current
    if (taskId) {
      try {
        const raw   = await AsyncStorage.getItem(PROCESSING_TASKS_KEY)
        const tasks: string[] = raw ? JSON.parse(raw) : []
        if (!tasks.includes(taskId)) tasks.push(taskId)
        await AsyncStorage.setItem(PROCESSING_TASKS_KEY, JSON.stringify(tasks))
      } catch {}

      Alert.alert(
        "Análisis en progreso",
        "Tu reporte continúa procesándose en segundo plano. Podrás ver el resultado en tu historial cuando esté listo.",
        [
          { text: "Ver historial", onPress: () => navigation.navigate("Historial") },
          { text: "Quedarme aquí", style: "cancel" },
        ],
      )
    }
  }

  const handleAnalyze = async () => {
    if (!capturedB64) return

    // ── Validar que tengamos ubicación antes de enviar ──────────────────────
    let currentLat = location?.latitude ?? null
    let currentLng = location?.longitude ?? null
    
    // Si no hay ubicación, intentar obtenerla de nuevo
    if (!currentLat || !currentLng) {
      setIsRetryingLocation(true)
      const loc = await getCurrentLocation(true)
      setIsRetryingLocation(false)
      
      if (loc) {
        setLocation(loc)
        currentLat = loc.latitude
        currentLng = loc.longitude
      } else {
        // Usuario decidió continuar sin ubicación (usar coordenadas por defecto de Quito)
        Alert.alert(
          "Ubicación no disponible",
          "No pudimos obtener tu ubicación exacta. El reporte se registrará con una ubicación aproximada en Quito.",
          [
            {
              text: "Continuar de todos modos",
              onPress: () => {
                // A-07: coordenadas de referencia de Quito — se marca como aproximada
                currentLat = -0.180653
                currentLng = -78.467838
                performAnalysis(capturedB64, currentLat!, currentLng!, true)
              },
            },
            { text: "Cancelar", style: "cancel" },
          ]
        )
        return
      }
    }
    
    performAnalysis(capturedB64, currentLat, currentLng)
  }
  
  const performAnalysis = async (b64: string, lat: number, lng: number, ubicacionAproximada = false) => {
    // ── Offline path: save to local queue and notify user ───────────────────
    if (!isConnected) {
      await enqueuePendingReport(b64, lat, lng)
      await refreshPendingCount()
      retake()
      Alert.alert(
        "Sin conexión",
        "Tu reporte se guardó localmente y se enviará automáticamente cuando recuperes conexión a internet.",
        [{ text: "Entendido" }],
      )
      return
    }

    setPhase("uploading")
    setUploadProgress(0)
    setIsSlowMessage(false)

    const controller = new AbortController()
    abortControllerRef.current = controller

    // ── Step 1: upload image, get task_id (HTTP 202) ────────────────────────
    let taskId: string
    try {
      const accepted = await analyzeImage(b64, lat, lng, undefined, {
        signal: controller.signal,
        onUploadProgress: setUploadProgress,
        ubicacion_aproximada: ubicacionAproximada,
      })
      taskId = accepted.task_id
      // Persistir task_id en ref para que handleCancelAnalysis pueda guardarlo
      // en AsyncStorage si el usuario decide salir antes de que termine.
      currentTaskIdRef.current = taskId
    } catch (e: any) {
      setPhase("idle")
      if (e?.code === "ERR_CANCELED") return
      const isNetworkError = !e?.response
      Alert.alert(
        "Error de conexión",
        isNetworkError
          ? "No hay conexión a internet. ¿Quieres guardar el reporte para enviarlo cuando vuelva la red?"
          : "No se pudo enviar la imagen. Por favor inténtalo de nuevo.",
        isNetworkError
          ? [
              { text: "Reintentar", onPress: () => performAnalysis(b64, lat, lng, ubicacionAproximada) },
              {
                text: "Guardar para después",
                onPress: async () => {
                  await enqueuePendingReport(b64, lat, lng)
                  await refreshPendingCount()
                  retake()
                  Alert.alert("Guardado", "El reporte se enviará automáticamente cuando recuperes conexión.")
                },
              },
            ]
          : [{ text: "Reintentar", onPress: () => performAnalysis(b64, lat, lng) }],
      )
      return
    }

    // ── Step 2: poll every 2 s until success or failure ─────────────────────
    setPhase("queued")
    pollingStartRef.current = Date.now()

    // Kick off first tick right away, then repeat
    const tick = async () => {
      if (pollingInProgressRef.current) return
      pollingInProgressRef.current = true

      const elapsed = Date.now() - pollingStartRef.current

      // A-04: Hard cap — stop polling after 120 s and save task_id for later retrieval
      if (elapsed >= POLL_TIMEOUT_MS) {
        stopPolling()
        setPhase("idle")
        setIsSlowMessage(false)
        try {
          const raw = await AsyncStorage.getItem(PROCESSING_TASKS_KEY)
          const tasks: string[] = raw ? JSON.parse(raw) : []
          if (!tasks.includes(taskId)) tasks.push(taskId)
          await AsyncStorage.setItem(PROCESSING_TASKS_KEY, JSON.stringify(tasks))
        } catch {}
        Alert.alert(
          "Análisis en progreso",
          "El análisis está tardando más de lo esperado. Podrás ver el resultado en tu historial cuando esté listo.",
          [{ text: "Entendido" }],
        )
        pollingInProgressRef.current = false
        return
      }

      if (elapsed >= SLOW_THRESHOLD_MS) setIsSlowMessage(true)

      // Switch from "queued" to "analyzing" after first tick arrives
      setPhase((prev) => (prev === "queued" ? "analyzing" : prev))

      try {
        const status = await getTaskStatus(taskId)

        if (status.estado === "PROCESANDO") {
          pollingInProgressRef.current = false
          return // keep polling
        }

        stopPolling()

        if (status.estado === "FALLIDO") {
          setPhase("idle")
          Alert.alert(
            "Sin residuos detectados",
            status.message ?? "No se detectaron residuos en la imagen. Intenta con otra foto.",
            [{ text: "OK", onPress: retake }],
          )
          return
        }

        // Success — show "saving" briefly before navigating
        setPhase("saving")
        currentTaskIdRef.current = null   // tarea completada, ya no hace falta rastrearla
        const result = status as AnalysisResult
        setTimeout(() => {
          setPhase("done")
          navigation.navigate("ScanResult", { result, latitude: lat, longitude: lng })
        }, 600)

      } catch {
        stopPolling()
        setPhase("idle")
        Alert.alert(
          "Error de conexión",
          "No se pudo obtener el estado del análisis. Inténtalo de nuevo.",
          [{ text: "Reintentar", onPress: () => performAnalysis(b64, lat, lng) }],
        )
      } finally {
        pollingInProgressRef.current = false
      }
    }

    tick()
    pollingIntervalRef.current = setInterval(tick, POLL_INTERVAL_MS)
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
    const isActive = phase !== "idle"
    const showOverlay = phase === "queued" || phase === "analyzing" || phase === "saving"
    const canCancel = phase === "queued" || phase === "analyzing"
    const hasLocation = location !== null
    const isLocationLoading = isRetryingLocation

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

          {/* Indicador de estado de ubicación */}
          <View style={styles.locationStatus}>
            {isLocationLoading ? (
              <>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.locationStatusText}>Obteniendo ubicación...</Text>
              </>
            ) : hasLocation ? (
              <>
                <Ionicons name="location" size={16} color={colors.success} />
                <Text style={[styles.locationStatusText, styles.locationSuccess]}>
                  Ubicación disponible
                </Text>
              </>
            ) : locError ? (
              <>
                <Ionicons name="warning" size={16} color={colors.critico} />
                <Text style={[styles.locationStatusText, styles.locationError]}>
                  {locError.length > 50 ? locError.substring(0, 50) + "..." : locError}
                </Text>
              </>
            ) : null}
          </View>

          <TouchableOpacity
            style={[
              styles.analyzeBtn, 
              isActive && styles.analyzeBtnLoading,
              (!hasLocation && !isLocationLoading) && styles.analyzeBtnDisabled
            ]}
            onPress={handleAnalyze}
            disabled={isActive || (!hasLocation && !isLocationLoading)}
            activeOpacity={0.85}
          >
            {phase === "uploading" ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.analyzeBtnText}>
                  {`Enviando imagen… ${uploadProgress}%`}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="analytics-outline" size={20} color="#fff" />
                <Text style={styles.analyzeBtnText}>
                  {(!hasLocation && !isLocationLoading) ? "Esperando ubicación..." : "Analizar y Reportar"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.retakeBtn}
            onPress={retake}
            disabled={isActive}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-reverse-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.retakeBtnText}>Tomar otra foto</Text>
          </TouchableOpacity>
        </Animated.View>

        <AnalyzingOverlay
          isAnalyzing={showOverlay}
          label={overlayLabel(phase, isSlowMessage)}
          onCancel={canCancel ? handleCancelAnalysis : undefined}
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
        key={phase === "idle" ? "active" : "locked"}
        onPictureTaken={handlePictureTaken}
        onBack={() => navigation.goBack()}
      />
      {pendingCount > 0 && (
        <View style={styles.pendingBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
          <Text style={styles.pendingBannerText}>
            {pendingCount} reporte{pendingCount > 1 ? "s" : ""} pendiente{pendingCount > 1 ? "s" : ""} por enviar
          </Text>
        </View>
      )}
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
  analyzeBtnDisabled: { backgroundColor: colors.gray400, opacity: 0.6 },
  analyzeBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  retakeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.gray200,
  },
  retakeBtnText: { color: colors.textSecondary, fontWeight: "600", fontSize: 15 },

  pendingBanner: {
    position: "absolute", bottom: 16, left: 16, right: 16,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  pendingBannerText: { color: "#fff", fontSize: 13, fontWeight: "600", flex: 1 },

  // Nuevos estilos para ubicación
  locationStatus: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.gray100,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  locationStatusText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  locationSuccess: {  
    color: colors.success,
  },
  locationError: {
    color: colors.critico,
    flex: 1,
    flexWrap: "wrap",
  },
})