/**
 * useConnectivity — reactive + imperativa helper de conectividad.
 *
 * Combina el estado reactivo de NetworkContext (actualizado por el listener
 * global de NetInfo) con un helper imperativo `checkConnectivity()` que
 * llama a NetInfo.fetch() para obtener el valor definitivo en el momento
 * exacto en que se invoca (útil justo antes de un envío de red o de abrir
 * la cámara).
 *
 * Uso:
 *   const { isConnected, pendingCount, checkConnectivity } = useConnectivity()
 *
 *   // Reactividad: re-renders automáticos cuando cambia la conectividad
 *   if (!isConnected) return <OfflineBanner />
 *
 *   // Imperativo: verificación puntual antes de una llamada crítica
 *   const online = await checkConnectivity()
 *   if (!online) { enqueueAndNotify(); return }
 *   submitToServer()
 */

import { useCallback } from "react"
import NetInfo from "@react-native-community/netinfo"
import { useNetwork } from "../contexts/NetworkContext"

export interface ConnectivityState {
  /** Reactivo: true mientras el dispositivo tiene acceso a internet. */
  isConnected: boolean
  /** Número de reportes esperando en la cola offline. */
  pendingCount: number
  /** True mientras se está vaciando la cola tras recuperar conexión. */
  isProcessingQueue: boolean
  /**
   * Consulta puntual vía NetInfo.fetch().
   *
   * Usar cuando se necesita el estado más reciente posible en lugar del
   * valor cacheado del contexto, p.ej. justo antes de enviar un formulario
   * o iniciar la cámara.
   */
  checkConnectivity: () => Promise<boolean>
}

export function useConnectivity(): ConnectivityState {
  const { isConnected, pendingCount, isProcessingQueue } = useNetwork()

  const checkConnectivity = useCallback(async (): Promise<boolean> => {
    const state = await NetInfo.fetch()
    return state.isConnected === true && state.isInternetReachable !== false
  }, [])

  return { isConnected, pendingCount, isProcessingQueue, checkConnectivity }
}
