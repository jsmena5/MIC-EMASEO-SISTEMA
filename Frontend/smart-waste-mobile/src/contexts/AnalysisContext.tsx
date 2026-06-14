import React, {
  createContext,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { Alert } from "react-native"

import { navigationRef } from "../utils/navigationService"
import {
  getTaskStatus,
  type AnalysisResult,
} from "../services/image.service"

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BackgroundTask {
  taskId: string
  lat: number
  lng: number
  imageUri?: string
}

interface AnalysisContextValue {
  backgroundTask: BackgroundTask | null
  isAnalysisRunning: boolean
  /** Transfiere un task_id al contexto para que el polling siga en segundo plano. */
  sendToBackground: (task: BackgroundTask) => void
  /** Cancela el polling en segundo plano (el análisis sigue en el servidor). */
  cancelBackground: () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AnalysisContext = createContext<AnalysisContextValue>({
  backgroundTask: null,
  isAnalysisRunning: false,
  sendToBackground: () => {},
  cancelBackground: () => {},
})

export const useAnalysis = () => useContext(AnalysisContext)

// ─── Provider ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000
const POLL_TIMEOUT_MS  = 180_000

export function AnalysisProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [backgroundTask, setBackgroundTask] = useState<BackgroundTask | null>(null)

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const busyRef      = useRef(false)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    busyRef.current = false
  }, [])

  const cancelBackground = useCallback(() => {
    stopPolling()
    setBackgroundTask(null)
  }, [stopPolling])

  const sendToBackground = useCallback((task: BackgroundTask) => {
    stopPolling()
    busyRef.current = false
    startTimeRef.current = Date.now()
    setBackgroundTask(task)
  }, [stopPolling])

  // Arranca el loop cuando backgroundTask cambia a no-null
  useEffect(() => {
    if (!backgroundTask) return

    const { taskId, lat, lng, imageUri } = backgroundTask

    const tick = async () => {
      if (busyRef.current) return
      busyRef.current = true

      const elapsed = Date.now() - startTimeRef.current

      if (elapsed >= POLL_TIMEOUT_MS) {
        stopPolling()
        setBackgroundTask(null)
        Alert.alert(
          "Análisis tardando",
          "El análisis sigue en progreso. Revisa tu historial más tarde para ver el resultado.",
          [{ text: "Entendido" }],
        )
        busyRef.current = false
        return
      }

      try {
        const status = await getTaskStatus(taskId)

        if (status.estado === "PROCESANDO") {
          busyRef.current = false
          return
        }

        stopPolling()
        setBackgroundTask(null)

        if (status.estado === "FALLIDO") {
          Alert.alert(
            "Error en el análisis",
            "Hubo un problema técnico al analizar la imagen. Intenta nuevamente más tarde.",
            [{ text: "Entendido" }],
          )
          return
        }

        if (status.estado === "DESCARTADO") {
          Alert.alert(
            "Sin acumulación detectada",
            "La imagen analizada no muestra una acumulación de basura detectable.",
            [{ text: "Entendido" }],
          )
          return
        }

        if (status.estado === "PENDIENTE" && status.decision_automatica === "REVISION_REQUERIDA") {
          Alert.alert(
            "Reporte en revisión",
            "La IA no pudo determinar con certeza si hay basura en la imagen. Un supervisor revisará tu reporte y recibirás una notificación con la decisión. Puedes ver el estado en tu historial.",
            [{ text: "Entendido" }],
          )
          return
        }

        const result = status as AnalysisResult

        // Salvaguarda: solo navegamos si realmente hay un incidente creado.
        // Sin esto, un payload inesperado (sin incident_id) haría que
        // ScanResultScreen lance una excepción en render → pantalla negra.
        if (!result.incident_id) {
          Alert.alert(
            "Análisis finalizado",
            "El reporte se procesó pero no se pudo abrir el detalle. Revísalo en tu historial.",
            [{ text: "Entendido" }],
          )
          return
        }

        Alert.alert(
          "¡Análisis listo!",
          "Tu reporte fue procesado exitosamente. ¿Deseas ver el resultado?",
          [
            { text: "Más tarde", style: "cancel" },
            {
              text: "Ver resultado",
              onPress: () => {
                if (navigationRef.isReady()) {
                  navigationRef.navigate("ScanResult", {
                    result,
                    latitude: lat,
                    longitude: lng,
                    imageUri,
                  })
                }
              },
            },
          ],
        )
      } catch {
        // Error de red puntual — seguir reintentando hasta timeout
        busyRef.current = false
      }
    }

    tick()
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS)

    return () => { stopPolling() }
  }, [backgroundTask, stopPolling])

  const contextValue = useMemo(() => ({
    backgroundTask,
    isAnalysisRunning: backgroundTask !== null,
    sendToBackground,
    cancelBackground,
  }), [backgroundTask, sendToBackground, cancelBackground])

  return (
    <AnalysisContext.Provider value={contextValue}>
      {children}
    </AnalysisContext.Provider>
  )
}
