// src/screens/ManualScreen.tsx
import React, { useState } from "react"
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

type Props = NativeStackScreenProps<RootStackParamList, "Manual">

// ─── Datos estáticos ─────────────────────────────────────────────────────────

type Tab = "reporte" | "historial" | "cuenta"

const TABS: { id: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { id: "reporte",   label: "Reportar",  icon: "camera-outline" },
  { id: "historial", label: "Historial", icon: "time-outline" },
  { id: "cuenta",    label: "Mi cuenta", icon: "person-outline" },
]

type Step = {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  title: string
  body: string
  tip?: string
}

const STEPS: Record<Tab, Step[]> = {
  reporte: [
    {
      icon: "log-in-outline",
      title: "Inicia sesión",
      body: "Abre la app e ingresa tu correo y contraseña. Si aún no tienes cuenta, regístrate en pocos pasos: datos personales → verificación OTP → contraseña.",
    },
    {
      icon: "home-outline",
      title: "Toca «Reportar Incidencia»",
      body: "En la pantalla principal, presiona la tarjeta verde grande con el ícono de cámara. La app pedirá permisos de cámara y ubicación la primera vez.",
      tip: "Asegúrate de tener GPS activado antes de abrir la cámara.",
    },
    {
      icon: "camera-outline",
      title: "Fotografía la acumulación",
      body: "Encuadra la basura dentro del área marcada en la pantalla. La foto debe mostrar claramente los residuos; mínimo 320 × 320 píxeles.",
      tip: "Evita fotografiar personas o matrículas de vehículos.",
    },
    {
      icon: "send-outline",
      title: "Envía el reporte",
      body: "Al tocar el botón de envío, la imagen y tus coordenadas GPS se suben al servidor. Recibirás una confirmación inmediata (código 202) mientras la IA analiza la foto.",
    },
    {
      icon: "hourglass-outline",
      title: "Espera el resultado de la IA",
      body: "La pantalla muestra un indicador de progreso. El modelo RT-DETR-L analiza la imagen en segundo plano. Puedes cerrar la pantalla; el resultado aparecerá en tu Historial.",
      tip: "Si cierras la pantalla, el análisis continúa. Revisa el Historial en ~30 segundos.",
    },
    {
      icon: "checkmark-circle-outline",
      title: "Consulta el resultado",
      body: "Cuando el análisis termine verás el nivel de acumulación (BAJO / MEDIO / ALTO / CRÍTICO), el tipo de residuo detectado y el volumen estimado en m³.",
    },
  ],
  historial: [
    {
      icon: "time-outline",
      title: "Accede al Historial",
      body: "Desde el inicio toca la tarjeta «Historial». Verás todos tus reportes ordenados del más reciente al más antiguo.",
    },
    {
      icon: "filter-outline",
      title: "Estados de un reporte",
      body: "Cada tarjeta muestra el estado actual:\n• PROCESANDO — la IA está analizando\n• PENDIENTE — esperando atención de EMASEO\n• EN ATENCIÓN — operario asignado\n• RESUELTA — incidencia atendida\n• RECHAZADA — imagen no válida o duplicada\n• FALLIDO — no se detectó basura",
    },
    {
      icon: "refresh-outline",
      title: "Actualización automática",
      body: "Si hay reportes en estado PROCESANDO, el Historial hace polling automático cada 5 segundos para actualizar el estado sin que toques nada.",
      tip: "Desliza hacia abajo para refrescar manualmente la lista.",
    },
    {
      icon: "map-outline",
      title: "Detalle del reporte",
      body: "Toca cualquier tarjeta para ver el mapa interactivo con la ubicación exacta, la foto enviada, el nivel de acumulación y el historial de estados.",
    },
  ],
  cuenta: [
    {
      icon: "person-add-outline",
      title: "Crear cuenta",
      body: "Toca «Registrarse» en la pantalla de inicio. Completa tus datos (nombre, cédula ecuatoriana, email), verifica el OTP enviado a tu correo y establece una contraseña segura.",
      tip: "La cédula se valida con el algoritmo del Registro Civil (módulo 10).",
    },
    {
      icon: "lock-closed-outline",
      title: "Contraseña segura",
      body: "Tu contraseña debe tener mínimo 8 caracteres, al menos una letra mayúscula, una minúscula y un número. Esto protege tu cuenta y los datos de tus reportes.",
    },
    {
      icon: "key-outline",
      title: "Olvidé mi contraseña",
      body: "En la pantalla de login toca «¿Olvidaste tu contraseña?». Ingresa tu email, introduce el OTP de 6 dígitos que recibirás y establece una nueva contraseña. El OTP expira en 15 minutos.",
    },
    {
      icon: "shield-checkmark-outline",
      title: "Seguridad de tu cuenta",
      body: "Tu sesión dura 15 minutos; se renueva automáticamente mientras usas la app. Los tokens se guardan en el almacenamiento seguro del dispositivo (SecureStore), nunca en texto plano.",
    },
  ],
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ManualScreen({ navigation }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("reporte")
  const steps = STEPS[activeTab]

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#5B21B6" />

      {/* Header */}
      <Animated.View entering={FadeInUp.duration(400)} style={styles.header}>
        <View style={styles.hdecCircle1} />
        <View style={styles.hdecCircle2} />
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerIconWrap}>
            <Ionicons name="book" size={28} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Manual de uso</Text>
          <Text style={styles.headerSub}>Guía paso a paso</Text>
        </View>
      </Animated.View>

      {/* Tabs */}
      <Animated.View entering={FadeInDown.delay(80).duration(350)} style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = tab.id === activeTab
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.75}
            >
              <Ionicons
                name={tab.icon}
                size={16}
                color={active ? "#7C3AED" : colors.textTertiary}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {steps.map((step, i) => (
          <Animated.View
            key={`${activeTab}-${i}`}
            entering={FadeInDown.delay(i * 70).duration(380)}
          >
            <View style={styles.stepRow}>
              {/* Number + vertical line */}
              <View style={styles.stepLeft}>
                <View style={styles.stepNumWrap}>
                  <Text style={styles.stepNum}>{i + 1}</Text>
                </View>
                {i < steps.length - 1 && <View style={styles.stepLine} />}
              </View>

              {/* Content */}
              <View style={styles.stepCard}>
                <View style={styles.stepCardHeader}>
                  <View style={styles.stepIconWrap}>
                    <Ionicons name={step.icon} size={20} color="#7C3AED" />
                  </View>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                </View>
                <Text style={styles.stepBody}>{step.body}</Text>
                {step.tip && (
                  <View style={styles.tipBox}>
                    <Ionicons name="bulb-outline" size={14} color="#D97706" />
                    <Text style={styles.tipText}>{step.tip}</Text>
                  </View>
                )}
              </View>
            </View>
          </Animated.View>
        ))}

        {/* Soporte */}
        <Animated.View
          entering={FadeInDown.delay(steps.length * 70 + 100).duration(400)}
          style={styles.supportBanner}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>¿Necesitas ayuda?</Text>
            <Text style={styles.supportText}>
              Contacta a EMASEO EP a través de los canales oficiales del Municipio de Quito.
            </Text>
          </View>
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
    backgroundColor: "#7C3AED",
    paddingTop: 52,
    paddingBottom: 28,
    paddingHorizontal: 20,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#5B21B6",
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
    backgroundColor: "rgba(0,0,0,0.1)",
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

  // Tabs
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  tabActive: {
    backgroundColor: "#EDE9FE",
  },
  tabText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textTertiary,
  },
  tabTextActive: {
    color: "#7C3AED",
  },

  // Body
  body: { padding: 16, paddingBottom: 40 },

  // Step rows
  stepRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 4,
  },
  stepLeft: {
    alignItems: "center",
    width: 32,
  },
  stepNumWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#7C3AED",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  stepNum: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
  stepLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#DDD6FE",
    marginTop: 4,
    marginBottom: 4,
    borderRadius: 1,
    minHeight: 20,
  },
  stepCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  stepCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#EDE9FE",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  stepTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  stepBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  tipBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 10,
    backgroundColor: "#FEF3C7",
    padding: 10,
    borderRadius: 10,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: "#92400E",
    lineHeight: 17,
  },

  // Support
  supportBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: colors.primaryLight,
    padding: 16,
    borderRadius: 14,
    marginTop: 8,
  },
  supportTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: 3,
  },
  supportText: {
    fontSize: 13,
    color: colors.primary,
    lineHeight: 18,
    opacity: 0.8,
  },
})
