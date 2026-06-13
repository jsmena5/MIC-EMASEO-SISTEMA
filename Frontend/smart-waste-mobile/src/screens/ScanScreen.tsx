import AsyncStorage from "@react-native-async-storage/async-storage"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import * as ImageManipulator from "expo-image-manipulator"
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
import CapturedFrameOverlay from "../components/CapturedFrameOverlay"
import { useNetwork } from "../contexts/NetworkContext"
import { useAnalysis } from "../contexts/AnalysisContext"
import { useAlwaysAllowScreenCapture } from "../hooks/useAlwaysAllowScreenCapture"
import type { RootStackParamList } from "../navigation/AppNavigator"
import {
  analyzeImage,
  getTaskStatus,
  preCheckImage,
  type AnalysisResult,
} from "../services/image.service"
import { enqueuePendingReport } from "../services/offlineQueue.service"
import { colors } from "../theme/colors"
import { cropToScanFrame } from "../utils/cropToScanFrame"
import { uuidv4 } from "../utils/uuid"

type ScanNavProp = NativeStackNavigationProp<RootStackParamList, "Scan">

type AnalysisPhase = "idle" | "checking" | "uploading" | "queued" | "analyzing" | "saving" | "done"

const POLL_INTERVAL_MS = 2000
const SLOW_THRESHOLD_MS = 10000
const POLL_TIMEOUT_MS = 120_000
const LOCATION_RETRY_DELAY_MS = 3000
// Maximum number of consecutive upload/polling retries before showing the final error dialog
const MAX_RETRIES = 3
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

// Clasifica el error de polling para diagnosticar la causa (rate-limit / red / 5xx).
function classifyPollError(err: any): {
  status: number | undefined; code: string | undefined
  isNetworkError: boolean; isRateLimited: boolean
} {
  const status = err?.response?.status as number | undefined
  const code = err?.code as string | undefined
  return { status, code, isNetworkError: !err?.response, isRateLimited: status === 429 }
}

// Mensaje del diálogo de reintento de polling según el tipo de fallo. El reporte SÍ
// llegó al servidor en todos los casos; el texto lo deja claro.
function pollRetryMessage(isRateLimited: boolean, isNetworkError: boolean, attempt: number, max: number): string {
  if (isRateLimited) {
    return `El servidor está recibiendo muchas solicitudes. Tu reporte ya fue recibido y se está analizando (intento ${attempt} de ${max}).`
  }
  if (isNetworkError) {
    return `Tu reporte ya fue recibido. Perdimos la conexión al consultar el estado (intento ${attempt} de ${max}).`
  }
  return `Tu reporte ya fue recibido y se está analizando. Hubo un problema temporal al consultar el estado (intento ${attempt} de ${max}).`
}

// Pantalla de revisión de la foto capturada (estado de ubicación, botón de análisis,
// cancelar/retomar y overlay de análisis). Extraída de ScanScreen para bajar su
// complejidad cognitiva; toda la lógica vive en el componente padre vía callbacks.
// Vista de la cámara con banner de reportes pendientes. Extraída de ScanScreen para
// reducir su complejidad cognitiva.
// Indicador de estado de ubicación GPS (cargando / disponible / error).
function LocationIndicator({
  isLocationLoading, hasLocation, locError,
}: { isLocationLoading: boolean; hasLocation: boolean; locError: string | null }) {
  return (
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
  )
}

function CameraView({
  phase, pendingCount, onPictureTaken, onCoverageUpdate, onBack,
}: {
  phase: AnalysisPhase
  pendingCount: number
  onPictureTaken: (b: string, u: string, w: number, h: number) => void
  onCoverageUpdate: (_: unknown, cov: number) => void
  onBack: () => void
}) {
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent={Platform.OS === "android"}
      />
      <CameraCapture
        key={phase === "idle" ? "active" : "locked"}
        onPictureTaken={onPictureTaken}
        onCoverageUpdate={onCoverageUpdate}
        onBack={onBack}
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

function PhotoReviewScreen({
  capturedUri, phase, hasLocation, isLocationLoading, isCropping, locError,
  uploadProgress, pollProgress, isSlowMessage, hasActiveTask,
  onAnalyze, onCancelUpload, onRetake, onCancelToHome, onSendToBackground, onCancelAnalysis,
}: {
  capturedUri: string
  phase: AnalysisPhase
  hasLocation: boolean
  isLocationLoading: boolean
  isCropping: boolean
  locError: string | null
  uploadProgress: number
  pollProgress: number
  isSlowMessage: boolean
  hasActiveTask: boolean
  onAnalyze: () => void
  onCancelUpload: () => void
  onRetake: () => void
  onCancelToHome: () => void
  onSendToBackground: () => void
  onCancelAnalysis: () => void
}) {
  const isActive    = phase !== "idle"
  const showOverlay = phase === "queued" || phase === "analyzing" || phase === "saving"
  const canCancel   = phase === "queued" || phase === "analyzing"
  // El botón se bloquea mientras el recorte esté en curso para garantizar que
  // siempre se envíe la imagen recortada y no el fallback completo.
  const isAnalyzeBlocked = isActive || isCropping || (!hasLocation && !isLocationLoading)

  return (
    <View style={styles.reviewContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Imagen completa como fondo contextual */}
      <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />

      {/* Overlay del recuadro: muestra la región que cropToScanFrame enviará al ML */}
      {!showOverlay && <CapturedFrameOverlay />}

      <Animated.View entering={SlideInUp.duration(380).springify()} style={styles.reviewCard}>
        <View style={styles.reviewHandle} />

        <View style={styles.reviewTitleRow}>
          <View style={styles.reviewIconWrap}>
            <Ionicons name="checkmark" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.reviewTitle}>Foto capturada</Text>
            <Text style={styles.reviewSub}>
              {isCropping
                ? "Calculando región de análisis..."
                : "La región encuadrada se enviará al análisis IA"}
            </Text>
          </View>
        </View>

        {/* Indicador de estado de ubicación */}
        <LocationIndicator
          isLocationLoading={isLocationLoading}
          hasLocation={hasLocation}
          locError={locError}
        />

        <TouchableOpacity
          style={[
            styles.analyzeBtn,
            isActive   && styles.analyzeBtnLoading,
            isAnalyzeBlocked && !isActive && !isCropping && styles.analyzeBtnDisabled,
          ]}
          onPress={onAnalyze}
          disabled={isAnalyzeBlocked}
          activeOpacity={0.85}
        >
          {phase === "uploading" ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>
                {`Enviando imagen… ${Math.min(100, Math.max(0, uploadProgress))}%`}
              </Text>
            </>
          ) : phase === "checking" ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Verificando imagen…</Text>
            </>
          ) : isCropping ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Preparando imagen...</Text>
            </>
          ) : (
            <>
              <Ionicons name="analytics-outline" size={20} color="#fff" />
              <Text style={styles.analyzeBtnText}>
                {(!hasLocation && !isLocationLoading)
                  ? "Esperando ubicación..."
                  : "Analizar y Reportar"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {phase === "uploading" ? (
          /* Durante el envío: permitir cancelar la subida (no dejar al usuario varado) */
          <TouchableOpacity style={styles.cancelUploadBtn} onPress={onCancelUpload} activeOpacity={0.7}>
            <Ionicons name="close-circle-outline" size={20} color={colors.critico} />
            <Text style={styles.cancelUploadBtnText}>Cancelar envío</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={styles.retakeBtn} onPress={onRetake} disabled={isActive} activeOpacity={0.7}>
              <Ionicons name="camera-reverse-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.retakeBtnText}>Tomar otra foto</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelLink} onPress={onCancelToHome} disabled={isActive} activeOpacity={0.7}>
              <Text style={styles.cancelLinkText}>Cancelar</Text>
            </TouchableOpacity>
          </>
        )}
      </Animated.View>

      <AnalyzingOverlay
        isAnalyzing={showOverlay}
        label={overlayLabel(phase, isSlowMessage)}
        progress={pollProgress}
        onBackground={onSendToBackground}
        canBackground={canCancel && hasActiveTask}
        onCancel={canCancel ? onCancelAnalysis : undefined}
      />
    </View>
  )
}

export default function ScanScreen() {
  const navigation = useNavigation<ScanNavProp>()
  const { isConnected, pendingCount, refreshPendingCount } = useNetwork()
  const { sendToBackground } = useAnalysis()

  // Limpia FLAG_SECURE que expo-camera activa en Android cada vez que la
  // pantalla entra en foco (incluye vueltas después de "Tomar otra foto").
  useAlwaysAllowScreenCapture()

  const [locDenied, setLocDenied]     = useState(false)
  const [locError, setLocError]       = useState<string | null>(null)
  const [isRetryingLocation, setIsRetryingLocation] = useState(false)
  // Coverage ratio estimado en tiempo real por el frame processor (0-1)
  const [liveCoverage, setLiveCoverage] = useState<number | null>(null)

  const [capturedUri,     setCapturedUri]     = useState<string | null>(null)
  // URI del recorte (región del recuadro). null mientras el recorte está en curso.
  const [capturedCropUri, setCapturedCropUri] = useState<string | null>(null)
  // true mientras cropToScanFrame procesa la imagen
  const [isCropping,      setIsCropping]      = useState(false)
  const [capturedB64, setCapturedB64] = useState<string | null>(null)
  const [location, setLocation]       = useState<{ latitude: number; longitude: number } | null>(null)

  const [phase, setPhase]               = useState<AnalysisPhase>("idle")
  const [uploadProgress, setUploadProgress] = useState(0)
  // Progress shown in the AnalyzingOverlay during the ML polling phase (0–100).
  // Advances based on elapsed time vs. POLL_TIMEOUT_MS; jumps to 100 on success.
  const [pollProgress, setPollProgress]     = useState(0)
  const [isSlowMessage, setIsSlowMessage]   = useState(false)

  const abortControllerRef   = useRef<AbortController | null>(null)
  const pollingIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollingStartRef      = useRef<number>(0)
  const pollingInProgressRef = useRef(false)
  // Guarda el task_id activo para que handleCancelAnalysis pueda persistirlo
  const currentTaskIdRef     = useRef<string | null>(null)
  // Contadores independientes para upload y polling.
  // uploadRetryRef: reintentos de envío de la imagen (incluye llamada a analyzeImage).
  // pollRetryRef: reintentos de consulta de estado (getTaskStatus) sobre el mismo task_id.
  const uploadRetryRef       = useRef(0)
  const pollRetryRef         = useRef(0)
  // Alias para compatibilidad con retake() que lo resetea
  const retryCountRef        = uploadRetryRef
  // Latch sincrónico anti-doble-tap. Cubre la ventana del pre-check/ubicación en
  // la que `phase` todavía puede ser "idle" mientras hay trabajo async en curso.
  // Sin esto, con red lenta el usuario re-presiona "Analizar" y se disparan
  // envíos duplicados (setState es asíncrono y no bloquea taps del mismo tick).
  const submittingRef        = useRef(false)
  // Clave de idempotencia del reporte actual (UUID v4). Se genera al capturar la
  // foto y se reusa en TODOS los reintentos del mismo reporte, de modo que el
  // backend no cree incidentes duplicados si la red estuvo lenta. retake() la limpia.
  const idempotencyKeyRef    = useRef<string | null>(null)

  // VisionCamera gestiona el permiso de cámara internamente en CameraCapture.
  // Retrasamos el permiso de ubicación para que no se solape con el diálogo de
  // cámara en el primer arranque. En Android, dos diálogos de permisos simultáneos
  // pueden dejar la pantalla en negro al conceder el primero.
  useEffect(() => {
    const timer = setTimeout(async () => {
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
    }, 1000)
    return () => clearTimeout(timer)
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

  // Registra un task_id como "en proceso" en AsyncStorage. Una vez que el POST
  // /analyze devolvió task_id, el incidente YA existe en el servidor y el análisis
  // continúa aunque el polling de esta pantalla se interrumpa. Persistirlo permite
  // que el Historial muestre el resultado cuando el ML termine.
  const persistProcessingTask = async (taskId: string) => {
    try {
      const raw = await AsyncStorage.getItem(PROCESSING_TASKS_KEY)
      const tasks: string[] = raw ? JSON.parse(raw) : []
      if (!tasks.includes(taskId)) tasks.push(taskId)
      await AsyncStorage.setItem(PROCESSING_TASKS_KEY, JSON.stringify(tasks))
    } catch (err) {
      if (__DEV__) console.warn("[ScanScreen] persist processing task falló:", err)
    }
  }

  // Libera el latch anti-doble-tap y devuelve la UI a "idle". Se usa cuando el
  // flujo se detiene esperando una decisión del usuario (Alert modal) en lugar de
  // continuar hacia "uploading".
  const releaseGuard = () => {
    submittingRef.current = false
    setPhase("idle")
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
      if (__DEV__) console.warn("[ScanScreen] Error obteniendo ubicación:", error.message)
      
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

  // Called by CameraCapture once the shutter fires.
  // Ejecuta en paralelo el recorte de la imagen y la obtención de ubicación
  // para minimizar el tiempo hasta que el botón "Analizar" quede habilitado.
  const handlePictureTaken = async (
    base64: string,
    uri: string,
    photoWidth: number,
    photoHeight: number,
  ) => {
    // Clave de idempotencia fresca para esta foto: estable entre reintentos.
    idempotencyKeyRef.current = uuidv4()
    // Mostrar la UI de revisión inmediatamente con la imagen completa como fondo
    setCapturedUri(uri)
    setCapturedB64(base64)   // fallback: imagen completa (se reemplaza tras el crop)
    setCapturedCropUri(null)
    setIsCropping(true)
    setLocError(null)
    setIsRetryingLocation(true)

    // Recorte y GPS en paralelo para no serializar latencias
    const [cropOutcome, locOutcome] = await Promise.allSettled([
      cropToScanFrame(uri, photoWidth, photoHeight),
      getCurrentLocation(true),
    ])

    // ── Resultado del recorte ──────────────────────────────────────────────
    if (cropOutcome.status === "fulfilled") {
      setCapturedCropUri(cropOutcome.value.uri)
      // Reemplazar el B64 completo con el del recorte: es lo que se enviará al ML
      setCapturedB64(cropOutcome.value.base64)
    } else {
      // Si el recorte falla (error de ImageManipulator), se conserva el B64
      // completo como fallback; el usuario no ve un error, simplemente se envía
      // la imagen entera. El overlay de la cámara deja de ser el canal de verdad.
      if (__DEV__) console.warn("[ScanScreen] cropToScanFrame falló, se usará imagen completa:", cropOutcome.reason)
      setCapturedCropUri(null)
    }
    setIsCropping(false)

    // ── Resultado de la ubicación ─────────────────────────────────────────
    if (locOutcome.status === "fulfilled" && locOutcome.value) {
      setLocation(locOutcome.value)
      setLocError(null)
    } else {
      setLocation(null)
    }
    setIsRetryingLocation(false)
  }

  const retake = () => {
    stopPolling()
    abortControllerRef.current?.abort()
    currentTaskIdRef.current = null
    uploadRetryRef.current = 0
    pollRetryRef.current = 0
    submittingRef.current = false
    idempotencyKeyRef.current = null
    setCapturedUri(null)
    setCapturedCropUri(null)
    setIsCropping(false)
    setCapturedB64(null)
    setLocation(null)
    setLocError(null)
    setPhase("idle")
    setIsSlowMessage(false)
    setUploadProgress(0)
    setPollProgress(0)
  }

  // Cancela el overlay de análisis pero deja la tarea corriendo en el servidor.
  // Guarda el task_id en AsyncStorage para que el historial pueda rastrearlo
  // y muestra una alerta informando al usuario que puede ver el resultado allí.
  const handleCancelAnalysis = async () => {
    stopPolling()
    abortControllerRef.current?.abort()
    retryCountRef.current = 0
    setPhase("idle")
    setIsSlowMessage(false)
    setPollProgress(0)

    const taskId = currentTaskIdRef.current
    if (taskId) {
      try {
        const raw   = await AsyncStorage.getItem(PROCESSING_TASKS_KEY)
        const tasks: string[] = raw ? JSON.parse(raw) : []
        if (!tasks.includes(taskId)) tasks.push(taskId)
        await AsyncStorage.setItem(PROCESSING_TASKS_KEY, JSON.stringify(tasks))
      } catch (err) {
        if (__DEV__) console.warn("[ScanScreen] guardar taskId pendiente falló:", err)
      }

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

  // Cancela el envío de la imagen mientras está en curso (fase "uploading").
  // Aborta la subida y devuelve al usuario al estado de revisión (puede reintentar,
  // tomar otra foto o cancelar). Sin esto el botón quedaba "congelado" en 100%.
  const handleCancelUpload = () => {
    abortControllerRef.current?.abort()
    submittingRef.current = false
    setPhase("idle")
    setUploadProgress(0)
    setIsSlowMessage(false)
  }

  // Sale del flujo de captura/reporte y vuelve al inicio.
  const handleCancelToHome = () => {
    abortControllerRef.current?.abort()
    stopPolling()
    retake()
    navigation.reset({ index: 0, routes: [{ name: "Home" }] })
  }

  // Transfiere el polling al AnalysisContext y libera la pantalla.
  const handleSendToBackground = () => {
    const taskId = currentTaskIdRef.current
    if (!taskId) return
    stopPolling()
    const lastLat = location?.latitude ?? -0.180653
    const lastLng = location?.longitude ?? -78.467838
    sendToBackground({
      taskId,
      lat: lastLat,
      lng: lastLng,
      imageUri: capturedCropUri ?? capturedUri ?? undefined,
    })
    retake()
    navigation.reset({ index: 0, routes: [{ name: "Home" }] })
  }

  // Resuelve la ubicación y arranca performAnalysis.
  // Se llama desde handleAnalyze (flujo normal) y desde los Alerts de preCheck (fail-open).
  const proceedToAnalysis = async (b64: string) => {
    // Re-asegura el latch: esta función también se invoca desde los onPress de los
    // Alerts del pre-check, donde el latch se liberó para mostrar el modal.
    submittingRef.current = true
    setPhase("checking")

    let currentLat = location?.latitude ?? null
    let currentLng = location?.longitude ?? null

    if (!currentLat || !currentLng) {
      setIsRetryingLocation(true)
      const loc = await getCurrentLocation(true)
      setIsRetryingLocation(false)

      if (loc) {
        setLocation(loc)
        currentLat = loc.latitude
        currentLng = loc.longitude
      } else {
        releaseGuard()
        Alert.alert(
          "Ubicación no disponible",
          "No pudimos obtener tu ubicación exacta. El reporte se registrará con una ubicación aproximada en Quito.",
          [
            {
              text: "Continuar de todos modos",
              onPress: () => {
                const lat = -0.180653
                const lng = -78.467838
                performAnalysis(b64, lat, lng, true)
              },
            },
            { text: "Cancelar", style: "cancel" },
          ]
        )
        return
      }
    }

    performAnalysis(b64, currentLat, currentLng)
  }

  const handleAnalyze = async () => {
    // Latch sincrónico: rechaza taps repetidos ANTES de cualquier await. Con red
    // lenta el pre-check tarda y, sin esto, el botón seguía "vivo" (phase=idle) y
    // cada toque disparaba un envío duplicado. setState no protege aquí porque es
    // asíncrono; el ref sí, en el mismo tick del evento.
    if (submittingRef.current) return
    if (!capturedB64) return

    submittingRef.current = true
    // Feedback inmediato: el botón pasa a "Verificando imagen…" y queda bloqueado.
    setPhase("checking")

    // ── Pre-check de basura (thumbnail 320 px → /ml/pre-check) ────────────
    // Decidimos primero y mostramos los diálogos DESPUÉS (fuera del try) para no
    // dejar el latch tomado si un Alert corta el flujo.
    let decision: "send" | "ask-open" | "ask-not-garbage" = "send"
    const sourceUri = capturedCropUri ?? capturedUri
    if (sourceUri) {
      let thumbB64: string | null = null
      try {
        const thumb = await ImageManipulator.manipulateAsync(
          sourceUri,
          [{ resize: { width: 320 } }],
          { compress: 0.70, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        )
        thumbB64 = thumb.base64 ?? null
      } catch {
        thumbB64 = null
      }

      if (thumbB64) {
        try {
          const check = await preCheckImage(thumbB64)
          if (check && !check.is_garbage) decision = "ask-not-garbage"
        } catch {
          // Pre-check falló (timeout, 500, red lenta). Es solo una optimización;
          // el pipeline completo valida la imagen al recibirla. Continuamos
          // silenciosamente sin mostrar ningún error al usuario — ver un dialog
          // de error en este punto lo confunde y le hace pensar que la app está
          // dañada cuando en realidad el envío funciona perfectamente.
          decision = "send"
        }
      }
    }

    if (decision === "ask-not-garbage") {
      releaseGuard()
      Alert.alert(
        "No detectamos basura",
        "La imagen no parece mostrar acumulación de residuos. Acerca la cámara al lugar correcto e inténtalo de nuevo.",
        [
          { text: "Cancelar", style: "cancel", onPress: handleCancelToHome },
          { text: "Tomar otra foto", onPress: retake },
          {
            text: "Enviar de todos modos",
            onPress: () => proceedToAnalysis(capturedB64!),
          },
        ],
      )
      return
    }

    // Pre-check OK (o sin thumbnail): el latch sigue tomado y proceedToAnalysis
    // continúa el flujo protegido hasta entrar en "uploading".
    await proceedToAnalysis(capturedB64)
  }
  
  const performAnalysis = async (b64: string, lat: number, lng: number, ubicacionAproximada = false) => {
    // Clave estable para este reporte; se reusa en cada reintento y en el guardado
    // offline para que el backend nunca cree un duplicado del mismo reporte.
    const idempotencyKey = idempotencyKeyRef.current ?? (idempotencyKeyRef.current = uuidv4())

    // ── Offline path: save to local queue and notify user ───────────────────
    if (!isConnected) {
      await enqueuePendingReport(b64, lat, lng, undefined, idempotencyKey)
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
    // A partir de aquí la UI bloquea por estado (botón deshabilitado + spinner),
    // así que liberamos el latch sincrónico.
    submittingRef.current = false
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
        clientCoverageRatio: liveCoverage ?? undefined,
        idempotencyKey,
      })
      taskId = accepted.task_id
      // Persistir task_id en ref para que handleCancelAnalysis pueda guardarlo
      // en AsyncStorage si el usuario decide salir antes de que termine.
      currentTaskIdRef.current = taskId
    } catch (e: any) {
      setPhase("idle")
      if (e?.code === "ERR_CANCELED") return
      const httpStatus = e?.response?.status as number | undefined
      const isNetworkError = !e?.response
      const isRateLimited = httpStatus === 429

      // 429: no tiene sentido reintentar inmediatamente — el límite no se restablece
      // hasta la próxima hora. Ofrecer guardar offline para envío automático posterior.
      if (isRateLimited) {
        Alert.alert(
          "Límite de reportes alcanzado",
          "Has enviado demasiados análisis en la última hora. Guarda el reporte y se enviará automáticamente cuando el límite se restablezca.",
          [
            { text: "Cancelar", style: "cancel" },
            {
              text: "Guardar para después",
              onPress: async () => {
                await enqueuePendingReport(b64, lat, lng, undefined, idempotencyKey)
                await refreshPendingCount()
                retake()
                navigation.reset({ index: 0, routes: [{ name: "Home" }] })
                Alert.alert("Guardado", "El reporte se enviará automáticamente en la próxima hora.")
              },
            },
          ],
        )
        return
      }

      uploadRetryRef.current += 1
      const canRetry = uploadRetryRef.current < MAX_RETRIES

      if (!canRetry) {
        // ── Límite de reintentos de upload alcanzado ─────────────────────────
        Alert.alert(
          "No se pudo enviar la foto",
          `Después de ${MAX_RETRIES} intentos no fue posible enviar la imagen.\nPuedes cancelar o guardar el reporte para enviarlo más tarde.`,
          [
            {
              text: "Cancelar",
              style: "cancel",
              onPress: () => {
                retake()
                navigation.reset({ index: 0, routes: [{ name: "Home" }] })
              },
            },
            {
              text: "Guardar para después",
              onPress: async () => {
                await enqueuePendingReport(b64, lat, lng, undefined, idempotencyKey)
                await refreshPendingCount()
                retake()
                navigation.reset({ index: 0, routes: [{ name: "Home" }] })
                Alert.alert("Guardado", "El reporte se enviará automáticamente cuando recuperes conexión.")
              },
            },
          ],
        )
        return
      }

      Alert.alert(
        "Error de conexión",
        isNetworkError
          ? `Sin conexión al enviar la foto (intento ${uploadRetryRef.current} de ${MAX_RETRIES}). ¿Qué deseas hacer?`
          : `No se pudo enviar la imagen (intento ${uploadRetryRef.current} de ${MAX_RETRIES}). Inténtalo de nuevo.`,
        isNetworkError
          ? [
              { text: "Reintentar", onPress: () => performAnalysis(b64, lat, lng, ubicacionAproximada) },
              {
                text: "Guardar para después",
                onPress: async () => {
                  await enqueuePendingReport(b64, lat, lng, undefined, idempotencyKey)
                  await refreshPendingCount()
                  retake()
                  navigation.reset({ index: 0, routes: [{ name: "Home" }] })
                  Alert.alert("Guardado", "El reporte se enviará automáticamente cuando recuperes conexión.")
                },
              },
            ]
          : [{ text: "Reintentar", onPress: () => performAnalysis(b64, lat, lng) }],
      )
      return
    }

    // Upload exitoso → resetear contador de polling antes de empezar
    pollRetryRef.current = 0
    startPolling(taskId, lat, lng, capturedCropUri ?? capturedUri ?? undefined)
  }

  // Arranca el loop de polling sobre un task_id ya conocido.
  // Se llama desde performAnalysis (flujo normal) y desde "Reintentar" en errores de polling.
  const startPolling = (taskId: string, lat: number, lng: number, imageUri?: string) => {
    setPhase("queued")
    setPollProgress(30)
    pollingStartRef.current = Date.now()

    const tick = async () => {
      if (pollingInProgressRef.current) return
      pollingInProgressRef.current = true

      const elapsed = Date.now() - pollingStartRef.current

      if (elapsed >= POLL_TIMEOUT_MS) {
        stopPolling()
        setPhase("idle")
        setIsSlowMessage(false)
        await persistProcessingTask(taskId)
        Alert.alert(
          "Análisis en progreso",
          "El análisis está tardando más de lo esperado. Podrás ver el resultado en tu historial cuando esté listo.",
          [{ text: "Entendido" }],
        )
        pollingInProgressRef.current = false
        return
      }

      if (elapsed >= SLOW_THRESHOLD_MS) setIsSlowMessage(true)

      try {
        const status = await getTaskStatus(taskId)

        if (status.estado === "PROCESANDO") {
          setPhase("analyzing")
          setPollProgress(50)
          pollingInProgressRef.current = false
          return
        }

        stopPolling()

        if (status.estado === "DESCARTADO") {
          setPollProgress(0)
          setPhase("idle")
          await persistProcessingTask(taskId)
          Alert.alert(
            "Sin acumulación detectada",
            "La imagen analizada no muestra una acumulación de basura detectable. Asegúrate de enfocar bien los residuos y vuelve a intentarlo. El reporte quedó registrado en tu historial.",
            [
              { text: "Tomar otra foto", onPress: retake },
              {
                text: "Ver historial",
                onPress: () => {
                  retake()
                  navigation.reset({ index: 0, routes: [{ name: "Historial" }] })
                },
              },
            ],
          )
          return
        }

        if (status.estado === "FALLIDO") {
          setPollProgress(0)
          setPhase("idle")
          Alert.alert(
            "Error en el análisis",
            "Hubo un problema técnico al analizar la imagen. Intenta de nuevo en unos momentos.",
            [
              { text: "Cancelar", style: "cancel", onPress: handleCancelToHome },
              { text: "Reintentar", onPress: retake },
            ],
          )
          return
        }

        // EN_REVISION: el supervisor debe validar manualmente la decisión IA.
        // No navegar a ScanResultScreen — ese componente requiere incident_id y
        // datos de detección completos que EN_REVISION no incluye, y crashea.
        if (status.estado === "EN_REVISION") {
          setPollProgress(0)
          setPhase("idle")
          Alert.alert(
            "Reporte en revisión",
            "Tu foto fue recibida pero la IA no pudo confirmar la acumulación con certeza. Un supervisor revisará el reporte y recibirás una notificación con la decisión. Puedes ver el estado en tu historial.",
            [
              {
                text: "Ver historial",
                onPress: () => {
                  retake()
                  navigation.reset({ index: 0, routes: [{ name: "Historial" }] })
                },
              },
              { text: "Entendido", style: "cancel", onPress: handleCancelToHome },
            ],
          )
          return
        }

        setPollProgress(100)
        setPhase("saving")
        currentTaskIdRef.current = null
        const result = status as AnalysisResult
        setTimeout(() => {
          setPhase("done")
          navigation.navigate("ScanResult", {
            result,
            latitude:  lat,
            longitude: lng,
            imageUri,
          })
        }, 600)

      } catch (err: any) {
        stopPolling()
        setPhase("idle")

        // El POST /analyze ya devolvió task_id ⇒ el incidente EXISTE en el servidor
        // y el análisis sigue corriendo aunque el polling de esta pantalla falle.
        // Registrarlo para que el resultado aparezca en el Historial. El reporte
        // NO se perdió: por eso los mensajes evitan dar a entender un fallo de envío.
        await persistProcessingTask(taskId)

        // Clasificar el error: es la única forma de diagnosticar la causa (429
        // rate-limit, 5xx servidor, o caída de red). Antes el `catch {}` lo descartaba
        // y todo se veía como un genérico "Error de conexión".
        const { status, code, isNetworkError, isRateLimited } = classifyPollError(err)
        console.warn(
          `[ScanScreen] poll getTaskStatus falló — status=${status ?? "n/a"} code=${code ?? "n/a"} msg=${err?.message ?? "n/a"}`,
        )

        pollRetryRef.current += 1
        const canRetry = pollRetryRef.current < MAX_RETRIES

        const goToHistorial = {
          text: "Ver historial",
          onPress: () => {
            retake()
            navigation.reset({ index: 0, routes: [{ name: "Historial" }] })
          },
        }
        const retryPolling = {
          text: "Reintentar",
          onPress: () => {
            pollRetryRef.current = 0
            startPolling(taskId, lat, lng, imageUri)
          },
        }

        // El reporte SÍ llegó al servidor en todos los casos; los mensajes lo dejan claro.
        const [titulo, cuerpo] = canRetry
          ? ["Análisis en progreso", pollRetryMessage(isRateLimited, isNetworkError, pollRetryRef.current, MAX_RETRIES)]
          : ["Reporte recibido", "Tu reporte ya fue recibido y se está analizando. No pudimos mostrar el resultado ahora; podrás verlo en tu historial en unos minutos."]
        Alert.alert(titulo, cuerpo, [
          { text: "Cancelar", style: "cancel", onPress: retake },
          goToHistorial,
          retryPolling,
        ])
      } finally {
        pollingInProgressRef.current = false
      }
    }

    tick()
    pollingIntervalRef.current = setInterval(tick, POLL_INTERVAL_MS)
  }

  // ── Permission screens ────────────────────────────────────────────────────
  // Nota: el permiso de cámara lo gestiona CameraCapture (VisionCamera).

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
      <PhotoReviewScreen
        capturedUri={capturedUri}
        phase={phase}
        hasLocation={location !== null}
        isLocationLoading={isRetryingLocation}
        isCropping={isCropping}
        locError={locError}
        uploadProgress={uploadProgress}
        pollProgress={pollProgress}
        isSlowMessage={isSlowMessage}
        hasActiveTask={!!currentTaskIdRef.current}
        onAnalyze={handleAnalyze}
        onCancelUpload={handleCancelUpload}
        onRetake={retake}
        onCancelToHome={handleCancelToHome}
        onSendToBackground={handleSendToBackground}
        onCancelAnalysis={handleCancelAnalysis}
      />
    )
  }

  // ── Camera view (delegated to CameraCapture) ──────────────────────────────

  return (
    <CameraView
      phase={phase}
      pendingCount={pendingCount}
      onPictureTaken={handlePictureTaken}
      onCoverageUpdate={(_, cov) => setLiveCoverage(cov)}
      onBack={() => navigation.goBack()}
    />
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

  cancelUploadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: "#FECACA", backgroundColor: "#FFF5F5",
  },
  cancelUploadBtnText: { color: colors.critico, fontWeight: "700", fontSize: 15 },

  cancelLink: {
    alignItems: "center", justifyContent: "center",
    paddingVertical: 12, marginTop: 4,
  },
  cancelLinkText: { color: colors.textTertiary, fontWeight: "600", fontSize: 14 },

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