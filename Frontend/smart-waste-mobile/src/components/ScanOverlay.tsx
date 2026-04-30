import React, { useEffect } from "react"
import { Dimensions, StyleSheet, View } from "react-native"
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"

import { colors } from "../theme/colors"

const { width: SW, height: SH } = Dimensions.get("window")
const FRAME = Math.min(SW * 0.78, 300)
const BRACKET = 30
const THICKNESS = 4
const OVERLAY_V = (SH - FRAME) / 2 - 60
const CORNER_COLOR = "#00E676"

interface ScanOverlayProps {
  /** Pass false once the scan phase ends (area locked) to trigger the ready animation */
  scanning?: boolean
}

export default function ScanOverlay({ scanning = true }: ScanOverlayProps) {
  const scanY = useSharedValue(0)
  const frameScale = useSharedValue(1)

  // Start corner pulse + scan line on mount
  useEffect(() => {
    frameScale.value = withRepeat(
      withSequence(withTiming(1.03, { duration: 900 }), withTiming(1, { duration: 900 })),
      -1,
    )
    scanY.value = withRepeat(
      withSequence(
        withTiming(FRAME - 2, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    )
  }, [])

  // Transition bounce when area is locked
  useEffect(() => {
    if (!scanning) {
      frameScale.value = withSequence(withTiming(1.06, { duration: 180 }), withSpring(1))
    }
  }, [scanning])

  const scanStyle = useAnimatedStyle(() => ({ transform: [{ translateY: scanY.value }] }))
  const frameStyle = useAnimatedStyle(() => ({ transform: [{ scale: frameScale.value }] }))

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Top dark band */}
      <View style={[styles.band, { height: OVERLAY_V }]} />

      {/* Middle row with transparent frame window */}
      <View style={styles.row}>
        <View style={styles.side} />

        <Animated.View style={[styles.frameWrapper, frameStyle]}>
          <View style={styles.frameDash} />

          <Bracket pos="tl" />
          <Bracket pos="tr" />
          <Bracket pos="bl" />
          <Bracket pos="br" />

          <View style={styles.frameClip}>
            {scanning ? (
              <Animated.View style={[styles.scanLine, scanStyle]} />
            ) : (
              <Animated.View
                entering={FadeIn.delay(100)}
                style={[styles.glowRing, { borderColor: colors.secondary }]}
              />
            )}
          </View>
        </Animated.View>

        <View style={styles.side} />
      </View>

      {/* Bottom dark band */}
      <View style={styles.bottomBand} />
    </View>
  )
}

// ─── Corner bracket ──────────────────────────────────────────────────────────

function Bracket({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const isTop = pos === "tl" || pos === "tr"
  const isLeft = pos === "tl" || pos === "bl"

  return (
    <View
      style={[
        styles.bracketWrap,
        isTop ? { top: 0 } : { bottom: 0 },
        isLeft ? { left: 0 } : { right: 0 },
      ]}
    >
      <View style={{
        position: "absolute",
        [isTop ? "top" : "bottom"]: 0,
        [isLeft ? "left" : "right"]: 0,
        width: BRACKET, height: THICKNESS,
        backgroundColor: CORNER_COLOR, borderRadius: 2,
      }} />
      <View style={{
        position: "absolute",
        [isTop ? "top" : "bottom"]: 0,
        [isLeft ? "left" : "right"]: 0,
        width: THICKNESS, height: BRACKET,
        backgroundColor: CORNER_COLOR, borderRadius: 2,
      }} />
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  band: { backgroundColor: "rgba(0,0,0,0.62)", width: "100%" },
  row: { flexDirection: "row", height: FRAME },
  side: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)" },
  bottomBand: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)" },

  frameWrapper: { width: FRAME, height: FRAME },
  frameDash: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderWidth: 1.5, borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.4)", borderRadius: 4,
  },
  frameClip: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    overflow: "hidden",
  },
  bracketWrap: {
    position: "absolute", width: BRACKET + 4, height: BRACKET + 4,
  },
  scanLine: {
    position: "absolute", left: 0, right: 0, height: 2,
    backgroundColor: colors.secondary, opacity: 0.8,
    shadowColor: colors.secondary, shadowOpacity: 1,
    shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  glowRing: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    borderWidth: 2, borderRadius: 4,
  },
})
