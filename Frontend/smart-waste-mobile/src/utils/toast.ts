/**
 * toast.ts
 *
 * Wrapper sobre react-native-toast-message para estandarizar el uso
 * en toda la app. Importa y usa estas funciones en lugar de llamar
 * Toast.show() directamente para mantener consistencia visual.
 *
 * Uso:
 *   import { showSuccess, showError, showInfo } from "../utils/toast"
 *   showSuccess("Reporte enviado", "Tu incidencia fue registrada.")
 *   showError("Sin conexión", "Verifica tu red e intenta de nuevo.")
 */

import Toast from "react-native-toast-message"

export function showSuccess(title: string, message?: string) {
  Toast.show({
    type: "success",
    text1: title,
    text2: message,
    visibilityTime: 3500,
    position: "top",
  })
}

export function showError(title: string, message?: string) {
  Toast.show({
    type: "error",
    text1: title,
    text2: message,
    visibilityTime: 4500,
    position: "top",
  })
}

export function showInfo(title: string, message?: string) {
  Toast.show({
    type: "info",
    text1: title,
    text2: message,
    visibilityTime: 3500,
    position: "top",
  })
}
