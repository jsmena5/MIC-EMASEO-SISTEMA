import React, { useState, useCallback, useEffect } from "react"
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import Animated, { FadeInDown } from "react-native-reanimated"
import * as Location from "expo-location"

import { RootStackParamList } from "../navigation/AppNavigator"
import { getMyIncidents, Incident } from "../services/image.service"
import { getPendingReports, PendingReport } from "../services/offlineQueue.service"
import { useNetwork } from "../contexts/NetworkContext"
import { colors } from "../theme/colors"
import { toPublicMediaUrl } from "../utils/mediaUrl"

type Props = NativeStackScreenProps<RootStackParamList, "Historial">

// ─── Tipos de item de la lista combinada ─────────────────────────────────────

type ListItem =
  | { kind: "online";  data: Incident;       key: string }
  | { kind: "pending"; data: PendingReport;  key: string }

// ─── Filtros ─────────────────────────────────────────────────────────────────

type HistorialFilter = "todos" | "cola" | "procesando" | "revision" | "resueltos" | "fallidos"

const FILTERS: { key: HistorialFilter; label: string }[] = [
  { key: "todos",      label: "Todos" },
  { key: "cola",       label: "En cola" },
  { key: "procesando", label: "Procesando" },
  { key: "revision",   label: "En revisión" },
  { key: "resueltos",  label: "Resueltos" },
  { key: "fallidos",   label: "Fallidos" },
]

function applyFilter(data: ListItem[], filter: HistorialFilter): ListItem[] {
  switch (filter) {
    case "cola":       return data.filter((i) => i.kind === "pending")
    case "procesando": return data.filter((i) => i.kind === "online" && (i.data.estado === "PROCESANDO" || i.data.estado === "PENDIENTE"))
    case "revision":   return data.filter((i) => i.kind === "online" && i.data.estado === "EN_REVISION")
    case "resueltos":  return data.filter((i) => i.kind === "online" && (i.data.estado === "RESUELTA" || i.data.estado === "EN_ATENCION"))
    case "fallidos":   return data.filter((i) => i.kind === "online" && (i.data.estado === "FALLIDO" || i.data.estado === "RECHAZADA" || i.data.estado === "DESCARTADO"))
    default:           return data
  }
}

// ─── Configuración de estados ─────────────────────────────────────────────────

export const ESTADO_CONFIG: Record<
  Incident["estado"],
  { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Ionicons>["name"] }
> = {
  PENDIENTE:   { label: "Pendiente",   color: "#D97706", bg: "#FEF3C7", icon: "time-outline" },
  EN_ATENCION: { label: "En proceso",  color: "#005BAC", bg: "#EBF4FF", icon: "construct-outline" },
  RESUELTA:    { label: "Atendido",    color: "#16A34A", bg: "#DCFCE7", icon: "checkmark-circle-outline" },
  RECHAZADA:   { label: "Rechazado",   color: "#DC2626", bg: "#FEE2E2", icon: "close-circle-outline" },
  PROCESANDO:  { label: "Procesando",  color: "#2563EB", bg: "#DBEAFE", icon: "hourglass-outline" },
  FALLIDO:     { label: "Fallido",     color: "#DC2626", bg: "#FEE2E2", icon: "alert-circle-outline" },
  EN_REVISION: { label: "En revisión", color: "#C2410C", bg: "#FFF7ED", icon: "eye-outline" },
  DESCARTADO:  { label: "Descartado",  color: "#475569", bg: "#F1F5F9", icon: "trash-outline" },
}

export const NIVEL_COLOR: Record<string, string> = {
  BAJO:    colors.bajo,
  MEDIO:   colors.medio,
  ALTO:    colors.alto,
  CRITICO: colors.critico,
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" })
}

// ─── ReportCard (reporte del servidor) ───────────────────────────────────────

interface CardProps {
  item: Incident
  index: number
  onPress: () => void
}

function ReportCard({ item, index, onPress }: CardProps) {
  const [address, setAddress] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    if (item.latitud != null && item.longitud != null) {
      Location.reverseGeocodeAsync({ latitude: item.latitud, longitude: item.longitud })
        .then(([result]) => {
          if (result) {
            // NFC normalization fixes garbled characters (e.g. ñ) returned by
            // some Android Geocoder implementations that produce decomposed Unicode.
            const street = (result.street ?? "").normalize("NFC")
            const area   = (result.district ?? result.subregion ?? result.city ?? "").normalize("NFC")
            const parts  = [street, area].filter(Boolean)
            setAddress(parts.length > 0 ? parts.join(", ") : null)
          }
        })
        .catch(() => {})
    }
  }, [item.latitud, item.longitud])

  const cfg = ESTADO_CONFIG[item.estado] ?? ESTADO_CONFIG.PENDIENTE
  const nivelColor = item.nivel_acumulacion
    ? (NIVEL_COLOR[item.nivel_acumulacion] ?? colors.gray400)
    : colors.gray400

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(380)}>
      <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={styles.card}>
        {/* Thumbnail */}
        <View style={styles.thumbWrap}>
          {toPublicMediaUrl(item.image_url) && !imgError ? (
            <Image
              source={{ uri: toPublicMediaUrl(item.image_url)! }}
              style={styles.thumbImage}
              resizeMode="cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <View style={[styles.thumbImage, styles.thumbFallback]}>
              <Ionicons name="image-outline" size={28} color={colors.gray400} />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.cardContent}>
          <View style={[styles.estadoBadge, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={11} color={cfg.color} />
            <Text style={[styles.estadoText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>

          {address ? (
            <Text style={styles.cardAddress} numberOfLines={1}>{address}</Text>
          ) : null}

          <Text style={styles.cardDate}>{formatDate(item.created_at)}</Text>

          {item.nivel_acumulacion && (
            <Text style={[styles.cardNivel, { color: nivelColor }]}>
              {item.nivel_acumulacion}
              {item.tipo_residuo ? ` · ${item.tipo_residuo}` : ""}
            </Text>
          )}
        </View>

        {/* Chevron */}
        <Ionicons name="chevron-forward" size={16} color={colors.gray300} style={styles.chevronIcon} />

        {/* Nivel bar */}
        {item.nivel_acumulacion && (
          <View style={[styles.nivelBar, { backgroundColor: nivelColor }]} />
        )}
      </TouchableOpacity>
    </Animated.View>
  )
}

// ─── PendingCard (reporte en cola offline) ────────────────────────────────────

interface PendingCardProps {
  item: PendingReport
  index: number
  isSyncing: boolean
  isConnected: boolean
  onRetry: () => void
}

function PendingCard({ item, index, isSyncing, isConnected, onRetry }: PendingCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(380)}>
      {/* No es TouchableOpacity: el item pendiente aún no existe en el servidor */}
      <View style={[styles.card, styles.pendingCardBorder]}>
        {/* Thumbnail — placeholder offline */}
        <View style={styles.thumbWrap}>
          <View style={[styles.thumbImage, styles.thumbFallback, styles.thumbPending]}>
            <Ionicons name="cloud-offline-outline" size={26} color={colors.warning} />
          </View>
        </View>

        {/* Content */}
        <View style={styles.cardContent}>
          {/* Badge "En cola" / "Sincronizando..." */}
          <View style={[styles.estadoBadge, { backgroundColor: "#FEF3C7" }]}>
            {isSyncing ? (
              <ActivityIndicator
                size="small"
                color={colors.warning}
                style={styles.syncSpinner}
              />
            ) : (
              <Ionicons name="time-outline" size={11} color={colors.warning} />
            )}
            <Text style={[styles.estadoText, { color: colors.warning }]}>
              {isSyncing ? "Sincronizando..." : "En cola"}
            </Text>
          </View>

          <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>

          <Text style={[styles.cardNivel, { color: colors.textSecondary }]}>
            Pendiente de envio
            {item.retries > 0 ? ` · Intento ${item.retries + 1}` : ""}
          </Text>

          {/* Retry / offline hint */}
          {!isSyncing && isConnected && (
            <TouchableOpacity style={styles.pendingRetryBtn} onPress={onRetry} activeOpacity={0.7}>
              <Ionicons name="refresh-outline" size={12} color={colors.primary} />
              <Text style={styles.pendingRetryText}>Reintentar ahora</Text>
            </TouchableOpacity>
          )}
          {!isSyncing && !isConnected && (
            <View style={styles.pendingOfflineRow}>
              <Ionicons name="wifi-outline" size={12} color={colors.textTertiary} />
              <Text style={styles.pendingOfflineText}>Sin conexión</Text>
            </View>
          )}
        </View>

        {/* Sin chevron */}
        <View style={styles.chevronPlaceholder} />

        {/* Barra lateral warning */}
        <View style={[styles.nivelBar, { backgroundColor: colors.warning }]} />
      </View>
    </Animated.View>
  )
}

// ─── HistorialScreen ──────────────────────────────────────────────────────────

export default function HistorialScreen({ navigation }: Props) {
  const { pendingCount, isProcessingQueue, isConnected, triggerFlush } = useNetwork()

  const [incidents, setIncidents]           = useState<Incident[]>([])
  const [pendingReports, setPendingReports] = useState<PendingReport[]>([])
  const [loading, setLoading]               = useState(true)
  const [refreshing, setRefreshing]         = useState(false)
  const [serverError, setServerError]       = useState<string | null>(null)
  const [activeFilter, setActiveFilter]     = useState<HistorialFilter>("todos")

  // ── Cargar reportes offline (AsyncStorage, siempre disponible) ──────────────
  const loadPending = useCallback(async () => {
    try {
      const pending = await getPendingReports()
      setPendingReports(pending)
    } catch {
      // Fallo silencioso — no cortar la UI por un error de AsyncStorage
    }
  }, [])

  // ── Carga principal ───────────────────────────────────────────────────────
  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setServerError(null)

    // Siempre carga pending primero (no requiere red)
    await loadPending()

    try {
      const data = await getMyIncidents()
      setIncidents(data)
    } catch {
      setServerError("No se pudo cargar el historial del servidor.\nVerifica tu conexion e intentalo de nuevo.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loadPending])

  // Carga al ganar foco
  useFocusEffect(
    useCallback(() => {
      fetchAll()
    }, [fetchAll])
  )

  // Refresca la cola cuando pendingCount cambia
  useEffect(() => {
    loadPending()
  }, [pendingCount, loadPending])

  // Auto-polling: si hay incidentes en PROCESANDO, refresca cada 5 s
  const hasProcessing = incidents.some((i) => i.estado === "PROCESANDO")
  useEffect(() => {
    if (!hasProcessing) return
    const timer = setInterval(() => {
      getMyIncidents()
        .then((data) => setIncidents(data))
        .catch(() => {})
    }, 5_000)
    return () => clearInterval(timer)
  }, [hasProcessing])

  // ── Lista combinada y filtrada ────────────────────────────────────────────
  const listData: ListItem[] = [
    ...pendingReports.map((r) => ({ kind: "pending" as const, data: r, key: `p_${r.id}` })),
    ...incidents.map((i) => ({ kind: "online" as const, data: i, key: `o_${i.id}` })),
  ]
  const totalCount    = listData.length
  const filteredData  = applyFilter(listData, activeFilter)
  const filteredCount = filteredData.length

  // ── Render de cada item ──────────────────────────────────────────────────
  function renderItem({ item, index }: { item: ListItem; index: number }) {
    if (item.kind === "pending") {
      return (
        <PendingCard
          item={item.data}
          index={index}
          isSyncing={isProcessingQueue}
          isConnected={isConnected}
          onRetry={triggerFlush}
        />
      )
    }
    return (
      <ReportCard
        item={item.data}
        index={index}
        onPress={() => navigation.navigate("ReportDetail", { incident: item.data })}
      />
    )
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.hdecCircle1} />
        <View style={styles.hdecCircle2} />
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate("Home")} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Mis Reportes</Text>
            <Text style={styles.headerSub}>Historial de incidencias</Text>
          </View>
        </View>
      </View>

      {/* Filter bar */}
      {!loading && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filterBarContent}
        >
          {FILTERS.map((f) => {
            const active = f.key === activeFilter
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setActiveFilter(f.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      )}

      {/* Body */}
      {loading ? (
        // ── Spinner inicial ────────────────────────────────────────────────
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando historial...</Text>
        </View>
      ) : (serverError && totalCount === 0) ? (
        // ── Error total (sin datos que mostrar) ───────────────────────────
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={52} color={colors.gray300} />
          <Text style={styles.errorText}>{serverError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAll()} activeOpacity={0.85}>
            <Ionicons name="refresh-outline" size={16} color="#fff" />
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // ── Lista combinada ───────────────────────────────────────────────
        <FlatList
          data={filteredData}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          contentContainerStyle={
            filteredCount === 0 ? styles.emptyContainer : styles.listContent
          }
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchAll(true)}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <>
              {/* Banner inline de error del servidor (cuando sí hay datos offline) */}
              {serverError && totalCount > 0 && (
                <View style={styles.inlineBanner}>
                  <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
                  <Text style={styles.inlineBannerText}>
                    Sin acceso al servidor. Mostrando datos guardados localmente.
                  </Text>
                  <TouchableOpacity onPress={() => fetchAll()} style={styles.inlineRetryBtn}>
                    <Text style={styles.inlineRetryText}>Reintentar</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Contador */}
              {totalCount > 0 && (
                <Text style={styles.listCount}>
                  {activeFilter === "todos"
                    ? `${incidents.length} reporte${incidents.length !== 1 ? "s" : ""}${pendingReports.length > 0 ? ` · ${pendingReports.length} en cola` : ""}`
                    : `${filteredCount} resultado${filteredCount !== 1 ? "s" : ""}`
                  }
                </Text>
              )}
            </>
          }
          ListEmptyComponent={
            totalCount === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={60} color={colors.gray300} />
                <Text style={styles.emptyTitle}>Sin reportes aun</Text>
                <Text style={styles.emptySub}>
                  Aqui apareceran las incidencias que hayas reportado.
                </Text>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => navigation.navigate("Scan")}
                  activeOpacity={0.88}
                >
                  <Ionicons name="camera-outline" size={18} color="#fff" />
                  <Text style={styles.emptyBtnText}>Hacer un reporte</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="filter-outline" size={48} color={colors.gray300} />
                <Text style={styles.emptyTitle}>Sin resultados</Text>
                <Text style={styles.emptySub}>No hay reportes con este filtro.</Text>
                <TouchableOpacity
                  style={styles.filterResetBtn}
                  onPress={() => setActiveFilter("todos")}
                  activeOpacity={0.88}
                >
                  <Text style={styles.filterResetText}>Ver todos</Text>
                </TouchableOpacity>
              </View>
            )
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

  // Filter bar
  filterBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
    flexGrow: 0,
  },
  filterBarContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.gray100,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: "#fff",
  },

  // Loading / Error states
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

  // Inline error banner (cuando hay datos offline pero falla el servidor)
  inlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  inlineBannerText: {
    flex: 1,
    fontSize: 12,
    color: colors.warning,
    lineHeight: 17,
  },
  inlineRetryBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: colors.warning,
  },
  inlineRetryText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
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

  // Card (compartido por ReportCard y PendingCard)
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
  pendingCardBorder: {
    borderWidth: 1,
    borderColor: "#FDE68A",
  },

  // Thumbnail
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
  thumbPending: {
    backgroundColor: "#FFF7ED",
  },

  // Card content
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
  cardAddress: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
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
  chevronIcon: {
    marginLeft: 4,
    marginRight: 10,
  },
  chevronPlaceholder: {
    width: 30,
    marginLeft: 4,
  },
  nivelBar: {
    width: 4,
    alignSelf: "stretch",
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  syncSpinner: {
    transform: [{ scale: 0.65 }],
  },

  // Pending card retry
  pendingRetryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  pendingRetryText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  pendingOfflineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  pendingOfflineText: {
    fontSize: 12,
    color: colors.textTertiary,
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
  filterResetBtn: {
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    marginTop: 4,
  },
  filterResetText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 14,
  },
})
