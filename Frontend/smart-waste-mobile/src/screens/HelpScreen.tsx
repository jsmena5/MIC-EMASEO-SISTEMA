import React, { useState } from "react"
import {
  ScrollView, StatusBar, StyleSheet, Text,
  TouchableOpacity, View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { RootStackParamList } from "../navigation/AppNavigator"
import { colors } from "../theme/colors"

type Props = Readonly<NativeStackScreenProps<RootStackParamList, "Help">>

// ─── Definición de estados ───────────────────────────────────────────────────

interface StatusInfo {
  key: string
  label: string
  color: string
  bg: string
  icon: React.ComponentProps<typeof Ionicons>["name"]
  description: string
  whatToExpect: string
}

const STATUSES: StatusInfo[] = [
  {
    key: "PROCESANDO",
    label: "Procesando",
    color: "#6B7280",
    bg: "#F3F4F6",
    icon: "time-outline",
    description:
      "Tu foto fue recibida y la inteligencia artificial la está analizando.",
    whatToExpect:
      "Espera unos segundos. El estado cambiará automáticamente cuando el análisis termine.",
  },
  {
    key: "PENDIENTE",
    label: "Pendiente",
    color: "#2563EB",
    bg: "#EFF6FF",
    icon: "hourglass-outline",
    description:
      "El análisis confirmó que hay residuos en la imagen. Tu reporte está en cola esperando que un supervisor lo revise.",
    whatToExpect:
      "Un supervisor de EMASEO EP lo verá próximamente y lo asignará a un equipo.",
  },
  {
    key: "EN_REVISION",
    label: "En revisión",
    color: "#7C3AED",
    bg: "#F5F3FF",
    icon: "eye-outline",
    description:
      "Un supervisor está evaluando si la imagen corresponde realmente a una acumulación de residuos.",
    whatToExpect:
      "Recibirás una notificación cuando el supervisor decida aceptar o rechazar el reporte.",
  },
  {
    key: "EN_ATENCION",
    label: "En atención",
    color: "#D97706",
    bg: "#FFFBEB",
    icon: "construct-outline",
    description:
      "Un equipo de operarios de EMASEO EP está atendiendo el punto de acumulación que reportaste.",
    whatToExpect:
      "El equipo limpiará el área. Cuando terminen, el estado pasará a Resuelto.",
  },
  {
    key: "RESUELTA",
    label: "Resuelto",
    color: "#16A34A",
    bg: "#F0FDF4",
    icon: "checkmark-circle-outline",
    description:
      "¡El punto de acumulación fue atendido! El equipo limpió el área correctamente.",
    whatToExpect:
      "No se requiere ninguna acción de tu parte. Gracias por contribuir con tu ciudad.",
  },
  {
    key: "RECHAZADA",
    label: "Rechazado",
    color: "#DC2626",
    bg: "#FEF2F2",
    icon: "close-circle-outline",
    description:
      "El supervisor revisó tu reporte y no pudo procesarlo. Puede ser por duplicado, ubicación incorrecta u otra razón.",
    whatToExpect:
      "Puedes enviar un nuevo reporte con más detalle si crees que el problema persiste.",
  },
  {
    key: "DESCARTADO",
    label: "Descartado",
    color: "#9CA3AF",
    bg: "#F9FAFB",
    icon: "trash-outline",
    description:
      "La inteligencia artificial analizó la imagen y no detectó ninguna acumulación de residuos con suficiente certeza.",
    whatToExpect:
      "Si el problema es real, intenta de nuevo con una foto más clara, mejor iluminada y un poco más de acercamiento.",
  },
]

// ─── FAQ ─────────────────────────────────────────────────────────────────────

interface FaqItem {
  q: string
  a: string
}

const FAQ: FaqItem[] = [
  {
    q: "¿Cuánto tarda en procesarse mi reporte?",
    a: "El análisis de la IA tarda entre 2 y 30 segundos. Una vez en estado PENDIENTE, un supervisor lo revisa en el turno más próximo.",
  },
  {
    q: "¿Por qué mi imagen fue descartada?",
    a: "El modelo no detectó residuos claramente. Asegúrate de fotografiar la acumulación desde 1–2 metros de distancia, con buena luz y sin objetos que la tapen.",
  },
  {
    q: "¿Puedo enviar otro reporte del mismo lugar?",
    a: "Sí. Si el problema persiste o fue descartado por error, puedes enviar un nuevo reporte con una foto más clara.",
  },
  {
    q: "¿Mis datos GPS son exactos?",
    a: "La app usa el GPS de tu celular. En espacios abiertos la precisión es de 3–10 metros. En lugares cerrados o con señal débil puede ser menor.",
  },
  {
    q: "¿Por qué sale 'Tipo: Mixto'?",
    a: "La IA detectó varios tipos de residuos mezclados (plásticos, orgánicos, cartón, etc.) y no pudo identificar un tipo predominante. Esto es normal y no afecta la atención del reporte.",
  },
]

// ─── Componentes ─────────────────────────────────────────────────────────────

function StatusCard({ info, index }: Readonly<{ info: StatusInfo; index: number }>) {
  const [expanded, setExpanded] = useState(false)
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(360)}>
      <TouchableOpacity
        style={[styles.statusCard, { borderLeftColor: info.color }]}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.85}
      >
        <View style={styles.statusHeader}>
          <View style={[styles.statusIconBg, { backgroundColor: info.bg }]}>
            <Ionicons name={info.icon} size={20} color={info.color} />
          </View>
          <Text style={[styles.statusLabel, { color: info.color }]}>{info.label}</Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color="#9CA3AF"
          />
        </View>
        {expanded && (
          <View style={styles.statusBody}>
            <Text style={styles.statusDesc}>{info.description}</Text>
            <View style={styles.statusExpect}>
              <Ionicons name="information-circle-outline" size={13} color={info.color} />
              <Text style={[styles.statusExpectText, { color: info.color }]}>
                {info.whatToExpect}
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  )
}

function FaqCard({ item, index }: Readonly<{ item: FaqItem; index: number }>) {
  const [open, setOpen] = useState(false)
  return (
    <Animated.View entering={FadeInDown.delay(index * 60 + 200).duration(360)}>
      <TouchableOpacity
        style={styles.faqCard}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.85}
      >
        <View style={styles.faqQuestion}>
          <Text style={styles.faqQText}>{item.q}</Text>
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color="#9CA3AF"
          />
        </View>
        {open && <Text style={styles.faqAnswer}>{item.a}</Text>}
      </TouchableOpacity>
    </Animated.View>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function HelpScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#1D4ED8" />

      {/* Header */}
      <Animated.View entering={FadeInUp.duration(400)} style={styles.header}>
        <View style={styles.hdecCircle1} />
        <View style={styles.hdecCircle2} />
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate("Home")}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <View style={styles.headerIconWrap}>
            <Ionicons name="help-circle" size={28} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Ayuda</Text>
            <Text style={styles.headerSub}>¿Qué significa cada estado?</Text>
          </View>
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Estados del reporte */}
        <Text style={styles.sectionTitle}>Estados del reporte</Text>
        <Text style={styles.sectionSub}>
          Toca cada estado para ver su descripción completa.
        </Text>
        {STATUSES.map((s, i) => (
          <StatusCard key={s.key} info={s} index={i} />
        ))}

        {/* FAQ */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Preguntas frecuentes</Text>
        {FAQ.map((f, i) => (
          <FaqCard key={f.q} item={f} index={i} />
        ))}

        <View style={styles.footer}>
          <Ionicons name="leaf-outline" size={16} color={colors.textTertiary} />
          <Text style={styles.footerText}>
            Cada reporte ayuda a mantener Quito más limpio. ¡Gracias!
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: "#2563EB",
    paddingTop: 52, paddingBottom: 24, paddingHorizontal: 20,
    overflow: "hidden", elevation: 8,
    shadowColor: "#1D4ED8", shadowOpacity: 0.4,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  hdecCircle1: {
    position: "absolute", width: 200, height: 200, borderRadius: 100,
    backgroundColor: "rgba(255,255,255,0.07)", top: -60, right: -40,
  },
  hdecCircle2: {
    position: "absolute", width: 130, height: 130, borderRadius: 65,
    backgroundColor: "rgba(0,0,0,0.08)", bottom: -40, left: -20,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center", alignItems: "center", marginBottom: 14,
  },
  headerRow:     { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  headerSub:   { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2 },
  content:     { padding: 16, paddingBottom: 48 },
  sectionTitle: {
    fontSize: 15, fontWeight: "800", color: colors.textPrimary,
    marginBottom: 4, marginTop: 8,
  },
  sectionSub: {
    fontSize: 13, color: colors.textSecondary, marginBottom: 14, lineHeight: 18,
  },
  // Status cards
  statusCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    marginBottom: 8, borderLeftWidth: 4,
    elevation: 2, shadowColor: "#000",
    shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  statusHeader:  { flexDirection: "row", alignItems: "center", gap: 10 },
  statusIconBg: {
    width: 36, height: 36, borderRadius: 10,
    justifyContent: "center", alignItems: "center",
  },
  statusLabel:   { flex: 1, fontSize: 14, fontWeight: "700" },
  statusBody:    { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  statusDesc:    { fontSize: 13, color: colors.textSecondary, lineHeight: 20, marginBottom: 10 },
  statusExpect: {
    flexDirection: "row", gap: 6, alignItems: "flex-start",
    backgroundColor: "#F9FAFB", borderRadius: 8, padding: 10,
  },
  statusExpectText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: "500" },
  // FAQ cards
  faqCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    marginBottom: 8, elevation: 2, shadowColor: "#000",
    shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  faqQuestion: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  faqQText:    { flex: 1, fontSize: 13, fontWeight: "700", color: colors.textPrimary, lineHeight: 19 },
  faqAnswer: {
    fontSize: 13, color: colors.textSecondary, lineHeight: 20,
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6",
  },
  footer: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24,
    padding: 14, backgroundColor: colors.gray100, borderRadius: 12,
  },
  footerText: { flex: 1, fontSize: 12, color: colors.textTertiary, lineHeight: 17 },
})
