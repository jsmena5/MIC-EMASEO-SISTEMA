// src/screens/EnvironmentalAwarenessScreen.tsx
import React, { useRef } from "react"
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated"

import { RootStackParamList } from "../navigation/AppNavigator"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "EnvironmentalAwareness">

// ─── Datos estáticos ─────────────────────────────────────────────────────────

const TIPS: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  title: string
  body: string
  color: string
}[] = [
  {
    icon: "leaf-outline",
    title: "Separa tu basura",
    body: "Usa bolsas distintas para residuos orgánicos (sobras de comida), reciclables (cartón, plástico, vidrio) y el resto. Así el recolector puede darles el tratamiento correcto.",
    color: "#059669",
  },
  {
    icon: "refresh-outline",
    title: "Compra menos, reutiliza más",
    body: "Antes de botar algo, piensa si lo puedes reutilizar o donar. Llevar tu propia bolsa al mercado y elegir productos con menos empaque hace una gran diferencia.",
    color: "#0284C7",
  },
  {
    icon: "flask-outline",
    title: "Basura peligrosa, aparte",
    body: "Pilas, medicamentos vencidos y aceite de cocina usado NO van a la basura normal. Quito tiene puntos de recolección especiales para estos — búscalos en tu municipio.",
    color: "#DC2626",
  },
  {
    icon: "nutrition-outline",
    title: "Haz abono en casa",
    body: "Las cáscaras de frutas, restos de verduras y posos de café se convierten en abono para plantas en pocas semanas. Solo necesitas un recipiente con tapa en un rincón del jardín o balcón.",
    color: "#7C3AED",
  },
  {
    icon: "car-outline",
    title: "Saca la basura a tiempo",
    body: "Cada barrio tiene días y horarios específicos de recolección. Sacar las bolsas fuera de ese horario atrae animales y genera nuevos puntos de acumulación.",
    color: "#D97706",
  },
  {
    icon: "people-outline",
    title: "Reporta y ayuda a tu barrio",
    body: "Con esta app puedes avisar a EMASEO cuando hay basura acumulada en tu barrio. Tu reporte llega directo al equipo que puede limpiarlo. ¡Cada foto cuenta!",
    color: colors.primary,
  },
]

const FACTS = [
  { value: "+ 12 000", label: "fotos usadas para enseñarle a la IA" },
  { value: "88 %", label: "de acierto al detectar basura" },
  { value: "4 niveles", label: "para medir qué tan grave es la acumulación" },
]

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function EnvironmentalAwarenessScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#047857" />

      {/* Header */}
      <Animated.View entering={FadeInUp.duration(400)} style={styles.header}>
        <View style={styles.hdecCircle1} />
        <View style={styles.hdecCircle2} />
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate("Home")}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <Ionicons name="leaf" size={28} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Conciencia Ambiental</Text>
          <Text style={styles.headerSub}>Buenas prácticas de reciclaje</Text>
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Estadísticas rápidas */}
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={styles.sectionLabel}>
          La tecnología detrás de la app
        </Animated.Text>
        <Animated.View entering={FadeInDown.delay(160).duration(450)} style={styles.factsRow}>
          {FACTS.map((f) => (
            <View key={f.label} style={styles.factCard}>
              <Text style={styles.factValue}>{f.value}</Text>
              <Text style={styles.factLabel}>{f.label}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Tips */}
        <Animated.Text entering={FadeInDown.delay(240).duration(400)} style={styles.sectionLabel}>
          Consejos para tu día a día
        </Animated.Text>

        {TIPS.map((tip, i) => (
          <Animated.View
            key={tip.icon}
            entering={FadeInDown.delay(300 + i * 80).duration(400)}
          >
            <View style={styles.tipCard}>
              <View style={[styles.tipIconWrap, { backgroundColor: tip.color + "18" }]}>
                <Ionicons name={tip.icon} size={24} color={tip.color} />
              </View>
              <View style={styles.tipBody}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipText}>{tip.body}</Text>
              </View>
            </View>
          </Animated.View>
        ))}

        {/* Footer CTA */}
        <Animated.View entering={FadeInDown.delay(900).duration(400)} style={styles.ctaBanner}>
          <Ionicons name="earth-outline" size={24} color={colors.secondary} />
          <Text style={styles.ctaText}>
            Juntos podemos reducir la huella ambiental de Quito. ¡Cada reporte cuenta!
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // Header
  header: {
    backgroundColor: "#059669",
    paddingTop: 52,
    paddingBottom: 28,
    paddingHorizontal: 20,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#047857",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  hdecCircle1: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(255,255,255,0.07)",
    top: -60,
    right: -50,
  },
  hdecCircle2: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(0,0,0,0.08)",
    bottom: -40,
    left: -20,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  headerCenter: { alignItems: "center" },
  headerIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  headerSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    marginTop: 4,
    textAlign: "center",
  },

  // Body
  body: { padding: 16, paddingBottom: 40 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textTertiary,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 4,
    marginLeft: 2,
  },

  // Facts row
  factsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
  },
  factCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  factValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#059669",
  },
  factLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 4,
    lineHeight: 13,
  },

  // Tip cards
  tipCard: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    gap: 14,
    alignItems: "flex-start",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  tipIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  tipBody: { flex: 1 },
  tipTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  tipText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },

  // CTA banner
  ctaBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.secondaryLight,
    padding: 16,
    borderRadius: 14,
    marginTop: 8,
  },
  ctaText: {
    flex: 1,
    fontSize: 13,
    color: colors.secondaryDark,
    lineHeight: 19,
    fontWeight: "500",
  },
})
