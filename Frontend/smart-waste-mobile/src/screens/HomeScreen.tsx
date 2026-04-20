import AsyncStorage from "@react-native-async-storage/async-storage"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { Ionicons } from "@expo/vector-icons"
import { jwtDecode } from "jwt-decode"
import React, { useEffect, useState } from "react"
import {
  Alert,
  Dimensions,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"

import { RootStackParamList } from "../navigation/AppNavigator"
import { logoutUser } from "../services/auth.service"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "Home">

const { width: SW } = Dimensions.get("window")

interface DecodedToken {
  rol?: string
  nombre?: string
  nombre_completo?: string
  name?: string
  email?: string
  sub?: string
}

export default function HomeScreen({ navigation }: Props) {
  const [displayName, setDisplayName] = useState("")
  const [role, setRole] = useState("")
  const [initial, setInitial] = useState("U")

  const headerScale = useSharedValue(0.95)
  const headerOpacity = useSharedValue(0)

  useEffect(() => {
    headerScale.value = withSpring(1, { damping: 14 })
    headerOpacity.value = withSpring(1)

    const loadUser = async () => {
      const token = await AsyncStorage.getItem("token")
      if (!token) return
      try {
        const dec = jwtDecode<DecodedToken>(token)
        const name =
          dec.nombre_completo ?? dec.nombre ?? dec.name ?? dec.email ?? dec.sub ?? "Usuario"
        setDisplayName(name)
        setRole(dec.rol ?? "ciudadano")
        setInitial((name[0] ?? "U").toUpperCase())
      } catch {}
    }
    loadUser()
  }, [])

  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: headerScale.value }],
    opacity: headerOpacity.value,
  }))

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Estás seguro que deseas salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir",
        style: "destructive",
        onPress: async () => {
          await logoutUser()
          navigation.replace("Login")
        },
      },
    ])
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />

      {/* ── Header ── */}
      <Animated.View style={[styles.header, headerStyle]}>
        {/* Decorative circles */}
        <View style={styles.hdecCircle1} />
        <View style={styles.hdecCircle2} />

        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerGreeting}>Bienvenido,</Text>
            <Text style={styles.headerName} numberOfLines={1}>{displayName || "Usuario"}</Text>
            <View style={styles.roleBadge}>
              <Ionicons name="shield-checkmark" size={12} color={colors.secondary} />
              <Text style={styles.roleBadgeText}>{role}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.avatarCircle} onPress={handleLogout}>
            <Text style={styles.avatarText}>{initial}</Text>
          </TouchableOpacity>
        </View>

        {/* Brand strip */}
        <View style={styles.brandStrip}>
          <Text style={styles.brandStripText}>EMASEO EP</Text>
          <View style={styles.brandStripDot} />
          <Text style={styles.brandStripSub}>Sistema Inteligente</Text>
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Main action card ── */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)}>
          <TouchableOpacity
            style={styles.mainCard}
            onPress={() => navigation.navigate("Scan")}
            activeOpacity={0.88}
          >
            <View style={styles.mainCardIcon}>
              <Ionicons name="camera" size={36} color="#fff" />
            </View>
            <View style={styles.mainCardBody}>
              <Text style={styles.mainCardTitle}>Reportar Incidencia</Text>
              <Text style={styles.mainCardSub}>
                Fotografía y geolocaliza una acumulación de basura
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </Animated.View>

        {/* ── Section label ── */}
        <Animated.Text entering={FadeInDown.delay(320).duration(400)} style={styles.sectionLabel}>
          Más opciones
        </Animated.Text>

        {/* ── Grid of secondary actions ── */}
        <Animated.View entering={FadeInDown.delay(400).duration(500)} style={styles.grid}>
          <GridCard
            icon="time-outline"
            label="Historial"
            sublabel="Mis reportes"
            color={colors.primary}
            onPress={() => navigation.navigate("Historial")}
          />
          <GridCard
            icon="leaf-outline"
            label="Conciencia"
            sublabel="Ambiental"
            color="#059669"
            onPress={() => {}}
          />
          <GridCard
            icon="book-outline"
            label="Manual"
            sublabel="De uso"
            color="#7C3AED"
            onPress={() => {}}
          />
          <GridCard
            icon="notifications-outline"
            label="Alertas"
            sublabel="Notificaciones"
            color="#D97706"
            onPress={() => {}}
          />
        </Animated.View>

        {/* ── Info strip ── */}
        <Animated.View entering={FadeInDown.delay(550).duration(400)} style={styles.infoStrip}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.infoStripText}>
            Las fotos incluyen automáticamente tu ubicación GPS para despacho.
          </Text>
        </Animated.View>

        {/* ── Logout ── */}
        <Animated.View entering={FadeInDown.delay(650).duration(400)}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
            <Text style={styles.logoutText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  )
}

// ─── Grid card component ─────────────────────────────────────────────────────

function GridCard({
  icon,
  label,
  sublabel,
  color,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  sublabel: string
  color: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={styles.gridCard} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.gridCardIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={26} color={color} />
      </View>
      <Text style={styles.gridCardLabel}>{label}</Text>
      <Text style={styles.gridCardSub}>{sublabel}</Text>
    </TouchableOpacity>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header
  header: {
    backgroundColor: colors.primary,
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: 20,
    overflow: "hidden",
    elevation: 8,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  hdecCircle1: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(255,255,255,0.06)",
    top: -80,
    right: -60,
  },
  hdecCircle2: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(0,168,89,0.15)",
    bottom: -40,
    left: -30,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerGreeting: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  headerName: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
    maxWidth: SW * 0.62,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  roleBadgeText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
    letterSpacing: 0.5,
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.secondary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: colors.secondary,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  avatarText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 20,
  },
  brandStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  brandStripText: {
    color: "rgba(255,255,255,0.9)",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 2,
  },
  brandStripDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.secondary,
  },
  brandStripSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    letterSpacing: 0.5,
  },

  // Body
  body: {
    padding: 16,
    paddingBottom: 40,
  },

  // Main action card
  mainCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: colors.secondary,
    padding: 20,
    borderRadius: 18,
    marginBottom: 20,
    elevation: 6,
    shadowColor: colors.secondary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  mainCardIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  mainCardBody: { flex: 1 },
  mainCardTitle: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 17,
  },
  mainCardSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },

  // Section label
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textTertiary,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 12,
    marginLeft: 4,
  },

  // Grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },
  gridCard: {
    width: (SW - 32 - 12) / 2,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  gridCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  gridCardLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  gridCardSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Info strip
  infoStrip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.primaryLight,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  infoStripText: {
    flex: 1,
    color: colors.primary,
    fontSize: 13,
    lineHeight: 19,
  },

  // Logout
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    backgroundColor: colors.surface,
  },
  logoutText: {
    color: colors.error,
    fontWeight: "600",
    fontSize: 15,
  },
})
