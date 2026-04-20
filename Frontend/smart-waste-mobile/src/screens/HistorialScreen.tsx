import React, { useState, useCallback } from "react"
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import Animated, { FadeInDown } from "react-native-reanimated"

import { RootStackParamList } from "../navigation/AppNavigator"
import { getMyIncidents, Incident } from "../services/image.service"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "Historial">

const { width: SW } = Dimensions.get("window")

const ESTADO_CONFIG: Record<
  Incident["estado"],
  { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Ionicons>["name"] }
> = {
  PENDIENTE:   { label: "Pendiente",  color: "#D97706", bg: "#FEF3C7", icon: "time-outline" },
  EN_ATENCION: { label: "En proceso", color: "#005BAC", bg: "#EBF4FF", icon: "construct-outline" },
  RESUELTA:    { label: "Atendido",   color: "#16A34A", bg: "#DCFCE7", icon: "checkmark-circle-outline" },
  RECHAZADA:   { label: "Rechazado",  color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline" },
}

const NIVEL_COLOR: Record<string, string> = {
  BAJO:    colors.bajo,
  MEDIO:   colors.medio,
  ALTO:    colors.alto,
  CRITICO: colors.critico,
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" })
}

export default function HistorialScreen({ navigation }: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchIncidents = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const data = await getMyIncidents()
      setIncidents(data)
    } catch {
      setError("No se pudo cargar el historial.\nVerifica tu conexión e inténtalo de nuevo.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      fetchIncidents()
    }, [fetchIncidents])
  )

  function renderItem({ item, index }: { item: Incident; index: number }) {
    const cfg = ESTADO_CONFIG[item.estado] ?? ESTADO_CONFIG.PENDIENTE
    const nivelColor = item.nivel_acumulacion ? (NIVEL_COLOR[item.nivel_acumulacion] ?? colors.gray400) : colors.gray400

    return (
      <Animated.View entering={FadeInDown.delay(index * 60).duration(380)}>
        <View style={styles.card}>
          {/* Thumbnail */}
          <View style={styles.thumbWrap}>
            {item.image_url ? (
              <Image
                source={{ uri: item.image_url }}
                style={styles.thumbImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.thumbImage, styles.thumbFallback]}>
                <Ionicons name="image-outline" size={24} color={colors.gray400} />
              </View>
            )}
          </View>

          {/* Content */}
          <View style={styles.cardContent}>
            {/* Estado badge */}
            <View style={[styles.estadoBadge, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cfg.icon} size={11} color={cfg.color} />
              <Text style={[styles.estadoText, { color: cfg.color }]}>{cfg.label}</Text>
            </View>

            <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>

            {item.nivel_acumulacion && (
              <Text style={[styles.cardNivel, { color: nivelColor }]}>
                {item.nivel_acumulacion}
                {item.tipo_residuo ? ` · ${item.tipo_residuo}` : ""}
              </Text>
            )}

            {item.descripcion ? (
              <Text style={styles.cardDesc} numberOfLines={1}>{item.descripcion}</Text>
            ) : null}
          </View>

          {/* Nivel indicator bar */}
          {item.nivel_acumulacion && (
            <View style={[styles.nivelBar, { backgroundColor: nivelColor }]} />
          )}
        </View>
      </Animated.View>
    )
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.hdecCircle1} />
        <View style={styles.hdecCircle2} />
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Mis Reportes</Text>
            <Text style={styles.headerSub}>Historial de incidencias</Text>
          </View>
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando historial…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={52} color={colors.gray300} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchIncidents()} activeOpacity={0.85}>
            <Ionicons name="refresh-outline" size={16} color="#fff" />
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={incidents}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={
            incidents.length === 0 ? styles.emptyContainer : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchIncidents(true)}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            incidents.length > 0 ? (
              <Text style={styles.listCount}>{incidents.length} reporte{incidents.length !== 1 ? "s" : ""}</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={60} color={colors.gray300} />
              <Text style={styles.emptyTitle}>Sin reportes aún</Text>
              <Text style={styles.emptySub}>Aquí aparecerán las incidencias que hayas reportado.</Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => navigation.navigate("Scan")}
                activeOpacity={0.88}
              >
                <Ionicons name="camera-outline" size={18} color="#fff" />
                <Text style={styles.emptyBtnText}>Hacer un reporte</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
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
    paddingBottom: 22,
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
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(255,255,255,0.06)",
    top: -70,
    right: -50,
  },
  hdecCircle2: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "rgba(0,168,89,0.15)",
    bottom: -40,
    left: -20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
  },
  headerSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 2,
  },

  // Loading / Error
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    padding: 32,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  retryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },

  // List
  listContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 10,
  },
  listCount: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textTertiary,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 2,
  },

  // Card
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  thumbWrap: {
    width: 80,
    height: 80,
    flexShrink: 0,
  },
  thumbImage: {
    width: 80,
    height: 80,
  },
  thumbFallback: {
    backgroundColor: colors.gray100,
    justifyContent: "center",
    alignItems: "center",
  },
  cardContent: {
    flex: 1,
    padding: 12,
    gap: 4,
  },
  estadoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 2,
  },
  estadoText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  cardDate: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  cardNivel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardDesc: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  nivelBar: {
    width: 4,
    alignSelf: "stretch",
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    alignItems: "center",
    padding: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
    marginTop: 4,
  },
  emptySub: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.secondary,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 14,
    marginTop: 8,
    elevation: 4,
    shadowColor: colors.secondary,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  emptyBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
})
