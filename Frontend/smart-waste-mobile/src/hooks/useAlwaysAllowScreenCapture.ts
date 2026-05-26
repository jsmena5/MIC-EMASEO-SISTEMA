import { useCallback } from "react"
import { useFocusEffect } from "@react-navigation/native"
import * as ScreenCapture from "expo-screen-capture"

/**
 * Re-aplica allowScreenCaptureAsync() cada vez que la pantalla entra en foco.
 *
 * Por qué es necesario:
 *   expo-camera (v17+) activa FLAG_SECURE en Android cuando el viewfinder
 *   está visible, lo que bloquea las capturas de pantalla en toda la ventana.
 *   allowScreenCaptureAsync() borra ese flag.  Llamarlo solo en el mount de
 *   App.tsx no es suficiente porque el flag se reactiva cada vez que la
 *   cámara vuelve al primer plano (p.ej. después de "Tomar otra foto").
 *
 *   Usar useFocusEffect garantiza que el flag se limpia cada vez que la
 *   pantalla pasa a primer plano, independientemente del número de entradas.
 */
export function useAlwaysAllowScreenCapture(): void {
  useFocusEffect(
    useCallback(() => {
      ScreenCapture.allowScreenCaptureAsync().catch(() => {
        // No crítico: ignorar si la API no está disponible en esta plataforma.
      })
    }, []),
  )
}
