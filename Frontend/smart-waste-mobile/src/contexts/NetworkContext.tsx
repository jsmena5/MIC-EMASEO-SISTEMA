import NetInfo, { type NetInfoState } from "@react-native-community/netinfo"
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
import { getPendingCount, processQueue } from "../services/offlineQueue.service"

interface NetworkContextValue {
  isConnected: boolean
  pendingCount: number
  isProcessingQueue: boolean
  refreshPendingCount: () => Promise<void>
  triggerFlush: () => Promise<void>
}

const NetworkContext = createContext<NetworkContextValue>({
  isConnected: true,
  pendingCount: 0,
  isProcessingQueue: false,
  refreshPendingCount: async () => {},
  triggerFlush: async () => {},
})

export function NetworkProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [isConnected, setIsConnected] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [isProcessingQueue, setIsProcessingQueue] = useState(false)

  // Track transitions: offline → online triggers flush (avoids flush on first mount)
  const wasOfflineRef = useRef(false)
  // Prevents concurrent flushes even if NetInfo fires multiple events
  const isProcessingRef = useRef(false)

  const refreshPendingCount = useCallback(async () => {
    const count = await getPendingCount()
    setPendingCount(count)
  }, [])

  const flushQueue = useCallback(async () => {
    if (isProcessingRef.current) return
    const count = await getPendingCount()
    if (count === 0) return

    isProcessingRef.current = true
    setIsProcessingQueue(true)
    try {
      const result = await processQueue()
      await refreshPendingCount()
      const completedFailures = Math.max(result.failed - result.remaining, 0)
      if (result.succeeded > 0 || completedFailures > 0) {
        const sentMessage =
          result.succeeded > 0
            ? `Se enviaron ${result.succeeded} reporte(s) pendiente(s).`
            : ""
        const failedMessage =
          completedFailures > 0
            ? `${completedFailures} reporte(s) no completaron el analisis.`
            : ""
        const retryMessage =
          result.remaining > 0
            ? `${result.remaining} no pudieron enviarse y se reintentaran mas tarde.`
            : ""

        Alert.alert(
          completedFailures > 0 ? "Reportes procesados" : "Reportes enviados",
          [sentMessage, failedMessage, retryMessage].filter(Boolean).join(" "),
          [{ text: "OK" }],
        )
      }
    } catch {
      await refreshPendingCount()
    } finally {
      isProcessingRef.current = false
      setIsProcessingQueue(false)
    }
  }, [refreshPendingCount])

  // On mount: refresh count and, if there are pending reports, intentar un flush.
  // Cubre al usuario que SIEMPRE está online (sin transición offline→online): sin
  // esto, los items atascados — análisis ya enviado pero no confirmado, o sobre el
  // tope de reintentos — quedaban para siempre como "Pendiente de envío". processQueue
  // ahora los resuelve (los enviados salen de la cola; los exhaustos se purgan).
  useEffect(() => {
    void (async () => {
      await refreshPendingCount()
      const count = await getPendingCount()
      if (count > 0) flushQueue()
    })()
  }, [refreshPendingCount, flushQueue])

  // Global network listener — flushes queue when coming back online
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      // isInternetReachable probes a Google endpoint blocked by some EC carriers → false negatives.
      // Trust the OS-level connection flag; real server errors are handled by the upload/retry flow.
      const connected = state.isConnected !== false
      setIsConnected(connected)

      if (connected && wasOfflineRef.current) {
        wasOfflineRef.current = false
        flushQueue()
      } else if (!connected) {
        wasOfflineRef.current = true
      }
    })

    return unsubscribe
  }, [flushQueue])

  const contextValue = useMemo(
    () => ({ isConnected, pendingCount, isProcessingQueue, refreshPendingCount, triggerFlush: flushQueue }),
    [isConnected, pendingCount, isProcessingQueue, refreshPendingCount, flushQueue],
  )

  return (
    <NetworkContext.Provider value={contextValue}>
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetwork() {
  return useContext(NetworkContext)
}
