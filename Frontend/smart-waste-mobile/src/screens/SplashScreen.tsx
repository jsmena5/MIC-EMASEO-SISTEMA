/**
 * SplashScreen.tsx
 *
 * Pantalla de arranque personalizada de EMASEO EP.
 *
 * Flujo:
 *  1. App.tsx llama SplashScreen.preventAutoHideAsync() → el splash nativo
 *     (fondo #001828, imagen splash-icon.png) permanece visible mientras
 *     descarga el bundle JS.
 *  2. AppNavigator muestra este componente cuando isLoading === true
 *     (AuthContext está verificando la sesión guardada).
 *  3. En el primer efecto llamamos SplashScreen.hideAsync() → el splash
 *     nativo desaparece y el usuario ve ESTE componente con el mismo fondo
 *     oscuro, por lo que la transición es invisible.
 *  4. Las animaciones de entrada se reproducen (logo, texto, dots pulsantes).
 *  5. Cuando AuthContext termina de verificar la sesión (isLoading → false),
 *     AppNavigator navega a Login o Home.  La prop onFinish (opcional) permite
 *     coordinar una salida animada antes de esa navegación.
 */
import * as ExpoSplashScreen from "expo-splash-screen"
import React, { useEffect } from "react"
import { Dimensions, StyleSheet, Text, View } from "react-native"
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"

import { colors } from "../theme/colors"

const { width: W } = Dimensions.get("window")

interface Props {
  /** Llamado cuando la animación de salida ha terminado (opcional). */
  onFinish?: () => void
}

export default function SplashScreen({ onFinish: _onFinish }: Props) {
  const logoScale = useSharedValue(0)
  const logoOpacity = useSharedValue(0)

  const r1Scale = useSharedValue(1)
  const r1Opacity = useSharedValue(0.55)
  const r2Scale = useSharedValue(1)
  const r2Opacity = useSharedValue(0.35)
  const r3Scale = useSharedValue(1)
  const r3Opacity = useSharedValue(0.2)

  useEffect(() => {
    // ── Ocultar el splash nativo lo antes posible ──────────────────────────
    // El fondo de ambos es #001828, así que la transición es imperceptible.
    ExpoSplashScreen.hideAsync().catch(() => {
      // Ignorar: puede que ya estuviera oculto (recargas en desarrollo)
    })

    // ── Animación del logo ─────────────────────────────────────────────────
    logoScale.value = withSpring(1, { damping: 11, stiffness: 90 })
    logoOpacity.value = withTiming(1, { duration: 500 })

    // ── Anillos pulsantes ──────────────────────────────────────────────────
    const pulse = (
      sv: typeof r1Scale,
      op: typeof r1Opacity,
      delay: number,
      opStart: number,
    ) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(2.4, { duration: 2000, easing: Easing.out(Easing.cubic) }),
            withTiming(1, { duration: 0 }),
          ),
          -1,
        ),
      )
      op.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(0, { duration: 2000 }),
            withTiming(opStart, { duration: 0 }),
          ),
          -1,
        ),
      )
    }

    pulse(r1Scale, r1Opacity, 700, 0.55)
    pulse(r2Scale, r2Opacity, 1050, 0.35)
    pulse(r3Scale, r3Opacity, 1400, 0.2)
  }, [])

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpacity.value,
  }))
  const r1Style = useAnimatedStyle(() => ({
    transform: [{ scale: r1Scale.value }],
    opacity: r1Opacity.value,
  }))
  const r2Style = useAnimatedStyle(() => ({
    transform: [{ scale: r2Scale.value }],
    opacity: r2Opacity.value,
  }))
  const r3Style = useAnimatedStyle(() => ({
    transform: [{ scale: r3Scale.value }],
    opacity: r3Opacity.value,
  }))

  return (
    <View style={styles.container}>
      {/* ── Círculos de atmósfera ── */}
      <View style={styles.bgCircleBottomRight} />
      <View style={styles.bgCircleTopLeft} />
      <View style={styles.bgCircleSmall} />

      {/* ── Logo + anillos pulsantes ── */}
      <View style={styles.logoSection}>
        <Animated.View style={[styles.ring, r3Style]} />
        <Animated.View style={[styles.ring, r2Style]} />
        <Animated.View style={[styles.ring, r1Style]} />

        <Animated.View style={[styles.logoBadge, logoStyle]}>
          <Text style={styles.logoLetter}>E</Text>
        </Animated.View>
      </View>

      {/* ── Nombre de la marca ── */}
      <Animated.View entering={FadeInDown.delay(350).duration(600)} style={styles.brandRow}>
        <Text style={styles.brandName}>EMASEO</Text>
        <View style={styles.epBadge}>
          <Text style={styles.epText}>EP</Text>
        </View>
      </Animated.View>

      <Animated.Text entering={FadeInDown.delay(620).duration(550)} style={styles.tagline}>
        Sistema de Recolección Inteligente
      </Animated.Text>

      <Animated.Text entering={FadeInDown.delay(820).duration(500)} style={styles.location}>
        Quito · Ecuador
      </Animated.Text>

      {/* ── Indicador de carga (dots pulsantes) ── */}
      <Animated.View entering={FadeIn.delay(1100)} style={styles.dotsRow}>
        <PulseDot delay={0} />
        <PulseDot delay={220} />
        <PulseDot delay={440} />
      </Animated.View>

      {/* ── Pie de página ── */}
      <Animated.Text entering={FadeIn.delay(1400)} style={styles.version}>
        v1.0.0
      </Animated.Text>
    </View>
  )
}

// ─── Dot pulsante ─────────────────────────────────────────────────────────────

function PulseDot({ delay }: { delay: number }) {
  const scale = useSharedValue(0.4)
  const opacity = useSharedValue(0.25)

  useEffect(() => {
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 480, easing: Easing.out(Easing.quad) }),
          withTiming(0.4, { duration: 480, easing: Easing.in(Easing.quad) }),
        ),
        -1,
      ),
    )
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 480 }),
          withTiming(0.25, { duration: 480 }),
        ),
        -1,
      ),
    )
  }, [])

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }))

  return <Animated.View style={[styles.dot, dotStyle]} />
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const BADGE = 108

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#001828",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },

  // Atmósfera de fondo
  bgCircleBottomRight: {
    position: "absolute",
    width: 480,
    height: 480,
    borderRadius: 240,
    backgroundColor: colors.primary,
    opacity: 0.12,
    bottom: -160,
    right: -160,
  },
  bgCircleTopLeft: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: colors.secondary,
    opacity: 0.09,
    top: -120,
    left: -120,
  },
  bgCircleSmall: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.primary,
    opacity: 0.07,
    bottom: 120,
    left: W * 0.05,
  },

  // Área del logo
  logoSection: {
    width: BADGE,
    height: BADGE,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 36,
  },
  ring: {
    position: "absolute",
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: 1.5,
    borderColor: colors.secondary,
  },
  logoBadge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    backgroundColor: colors.secondary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 16,
    shadowColor: colors.secondary,
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 6 },
  },
  logoLetter: {
    fontSize: 56,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -2,
  },

  // Marca
  brandRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  brandName: {
    fontSize: 44,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 8,
  },
  epBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 8,
  },
  epText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 1,
  },
  tagline: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    marginTop: 10,
    letterSpacing: 0.4,
  },
  location: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 12,
    marginTop: 5,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },

  // Indicador de carga
  dotsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 52,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.secondary,
  },

  // Pie de página
  version: {
    position: "absolute",
    bottom: 36,
    color: "rgba(255,255,255,0.2)",
    fontSize: 11,
    letterSpacing: 1,
  },
})
