import NetInfo, { type NetInfoState } from "@react-native-community/netinfo"
import React, {
  createContext,
  useCallback,
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
}

const NetworkContext = createContext<NetworkContextValue>({
  isConnected: true,
  pendingCount: 0,
  isProcessingQueue: false,
  refreshPendingCount: async () => {},
})

export function NetworkProvider({ children }: { children: React.ReactNode }) {
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
      if (result.succeeded > 0) {
        Alert.alert(
          "Reportes enviados",
          result.remaining === 0
            ? `Se enviaron ${result.succeeded} reporte(s) pendiente(s) correctamente.`
            : `Se enviaron ${result.succeeded} reporte(s). ${result.remaining} no pudieron enviarse y se reintentarán más tarde.`,
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

  // Load pending count once on mount
  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  // Global network listener — flushes queue when coming back online
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false
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

  return (
    <NetworkContext.Provider
      value={{ isConnected, pendingCount, isProcessingQueue, refreshPendingCount }}
    >
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetwork() {
  return useContext(NetworkContext)
}
