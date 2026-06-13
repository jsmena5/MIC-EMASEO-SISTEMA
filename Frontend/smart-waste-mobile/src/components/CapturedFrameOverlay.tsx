/**
 * CapturedFrameOverlay.tsx
 *
 * Versión estática del recuadro de ScanOverlay que se muestra en el estado de
 * revisión (después de capturar, antes de enviar).
 *
 * A diferencia de ScanOverlay, este componente:
 *   • No tiene animaciones (no scan-line, no pulse, no glow-ring).
 *   • Muestra el recuadro con borde sólido verde para indicar "área confirmada".
 *   • Incluye una etiqueta que explica al usuario que solo esa región se enviará.
 *
 * Las constantes SCAN_FRAME_SIZE y SCAN_OVERLAY_V se importan desde
 * cropToScanFrame.ts para garantizar consistencia entre el recuadro visual,
 * el overlay de cámara y el recorte real.
 */

import React from "react"
import { Dimensions, StyleSheet, Text, View } from "react-native"

import { SCAN_FRAME_SIZE, SCAN_OVERLAY_V } from "../utils/cropToScanFrame"
import { colors } from "../theme/colors"

const { width: SW } = Dimensions.get("window")

const BRACKET   = 28
const THICKNESS = 3

// ─── Componente principal ─────────────────────────────────────────────────────

export default function CapturedFrameOverlay() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">

      {/* Banda oscura superior */}
      <View style={[styles.band, { height: SCAN_OVERLAY_V }]} />

      {/* Fila central con ventana transparente */}
      <View style={styles.row}>
        <View style={styles.side} />

        <View style={styles.frameWrapper}>
          {/* Borde sólido verde (región confirmada) */}
          <View style={styles.frameBorder} />

          {/* Esquinas */}
          <Bracket pos="tl" />
          <Bracket pos="tr" />
          <Bracket pos="bl" />
          <Bracket pos="br" />
        </View>

        <View style={styles.side} />
      </View>

      {/* Banda oscura inferior */}
      <View style={styles.bottomBand} />

      {/* Etiqueta informativa debajo del recuadro */}
      <View style={styles.labelContainer}>
        <View style={styles.labelBadge}>
          <Text style={styles.labelText}>📐 Solo esta región se enviará al análisis</Text>
        </View>
      </View>

    </View>
  )
}

// ─── Esquina ──────────────────────────────────────────────────────────────────

function Bracket({ pos }: Readonly<{ pos: "tl" | "tr" | "bl" | "br" }>) {
  const isTop  = pos === "tl" || pos === "tr"
  const isLeft = pos === "tl" || pos === "bl"

  return (
    <View style={[
      styles.bracketWrap,
      isTop  ? { top:    0 } : { bottom: 0 },
      isLeft ? { left:   0 } : { right:  0 },
    ]}>
      {/* Barra horizontal */}
      <View style={{
        position:  "absolute",
        [isTop  ? "top"    : "bottom"]: 0,
        [isLeft ? "left"   : "right" ]: 0,
        width:  BRACKET, height: THICKNESS,
        backgroundColor: colors.secondary, borderRadius: 2,
      }} />
      {/* Barra vertical */}
      <View style={{
        position:  "absolute",
        [isTop  ? "top"    : "bottom"]: 0,
        [isLeft ? "left"   : "right" ]: 0,
        width: THICKNESS, height: BRACKET,
        backgroundColor: colors.secondary, borderRadius: 2,
      }} />
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  band:        { backgroundColor: "rgba(0,0,0,0.55)", width: "100%" },
  row:         { flexDirection: "row", height: SCAN_FRAME_SIZE },
  side:        { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  bottomBand:  { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },

  frameWrapper: { width: SCAN_FRAME_SIZE, height: SCAN_FRAME_SIZE },

  frameBorder: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderWidth: 2,
    borderColor: colors.secondary,
    borderRadius: 4,
  },

  bracketWrap: {
    position: "absolute",
    width:  BRACKET + 4,
    height: BRACKET + 4,
  },

  labelContainer: {
    position: "absolute",
    // Aparece justo debajo del recuadro con un pequeño margen
    top:   SCAN_OVERLAY_V + SCAN_FRAME_SIZE + 10,
    left:  0,
    right: 0,
    alignItems: "center",
  },

  labelBadge: {
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingVertical:   5,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.secondary,
  },

  labelText: {
    color:      colors.secondary,
    fontSize:   12,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
})
