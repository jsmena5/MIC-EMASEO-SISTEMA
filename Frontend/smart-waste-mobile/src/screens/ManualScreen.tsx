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
      title: "Ingresa a la app",
      body: "Abre EMASEO e ingresa tu correo y contraseña. Si aún no tienes cuenta, toca «Registrarse» y sigue los pasos — solo te tomará un par de minutos.",
    },
    {
      icon: "home-outline",
      title: "Toca «Reportar Incidencia»",
      body: "En la pantalla de inicio verás un botón verde grande. Tócalo para abrir la cámara. La primera vez te pedirá permiso para usar la cámara y tu ubicación.",
      tip: "Activa el GPS de tu teléfono antes de reportar para que podamos registrar exactamente dónde está el problema.",
    },
    {
      icon: "camera-outline",
      title: "Fotografía la basura",
      body: "Apunta la cámara hacia la acumulación de basura y encuádrala dentro del recuadro verde que aparece en pantalla. Asegúrate de que se vean bien los residuos.",
      tip: "Trata de no incluir personas en la foto.",
    },
    {
      icon: "send-outline",
      title: "Envía el reporte",
      body: "Toca «Analizar y Reportar». La app subirá la foto junto con tu ubicación. Verás una barra de progreso mientras se envía.",
    },
    {
      icon: "hourglass-outline",
      title: "Espera el análisis",
      body: "La inteligencia artificial revisa tu foto en segundos. Si quieres seguir usando la app, toca «Continuar navegando» — el análisis seguirá en segundo plano y recibirás un aviso cuando esté listo.",
      tip: "El resultado aparecerá en tu Historial automáticamente.",
    },
    {
      icon: "checkmark-circle-outline",
      title: "Ve el resultado",
      body: "Cuando termine verás si se detectó basura, qué tipo de residuos son y qué tan grave es la acumulación. Tu reporte queda registrado para que EMASEO lo atienda.",
    },
  ],
  historial: [
    {
      icon: "time-outline",
      title: "Abre el Historial",
      body: "Desde el inicio toca «Historial». Ahí verás todos los reportes que has hecho, del más reciente al más antiguo.",
    },
    {
      icon: "filter-outline",
      title: "¿Qué significa cada estado?",
      body: "Cada reporte tiene un estado que te dice en qué punto está:\n• Analizando — la IA está revisando tu foto\n• Pendiente — esperando que EMASEO lo atienda\n• En atención — ya hay un operario asignado\n• Resuelto — el problema fue atendido\n• Rechazado — la foto no mostraba basura o ya estaba reportado\n• Fallido — no se pudo analizar la imagen",
    },
    {
      icon: "refresh-outline",
      title: "La lista se actualiza sola",
      body: "Si tienes reportes en análisis, el historial se actualiza automáticamente cada pocos segundos. También puedes deslizar hacia abajo para refrescar.",
      tip: "No necesitas salir y volver a entrar para ver cambios.",
    },
    {
      icon: "map-outline",
      title: "Ver detalle de un reporte",
      body: "Toca cualquier reporte para ver el mapa con la ubicación, la foto que enviaste y toda la información del análisis.",
    },
  ],
  cuenta: [
    {
      icon: "person-add-outline",
      title: "Crear una cuenta",
      body: "Toca «Registrarse». Ingresa tu nombre, número de cédula y correo electrónico. Te llegará un código de verificación al correo — ingrésalo y listo.",
    },
    {
      icon: "lock-closed-outline",
      title: "Tu contraseña",
      body: "Elige una contraseña de al menos 6 caracteres. Usa una combinación de letras y números para que sea más segura. Nadie más puede verla.",
    },
    {
      icon: "key-outline",
      title: "Olvidé mi contraseña",
      body: "En la pantalla de inicio toca «¿Olvidaste tu contraseña?». Ingresa tu correo, introduce el código que recibirás y escribe una nueva contraseña. Tienes 15 minutos para usarlo.",
    },
    {
      icon: "shield-checkmark-outline",
      title: "Tu cuenta está protegida",
      body: "Tus datos y sesión están guardados de forma segura en tu teléfono. Si cierras la app, tu sesión se mantiene activa para que no tengas que volver a entrar cada vez.",
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
