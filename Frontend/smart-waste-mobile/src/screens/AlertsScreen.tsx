import React, { useCallback, useEffect, useState } from "react"
import {
  FlatList,
  RefreshControl,
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
import api from "../utils/api"

type Props = NativeStackScreenProps<RootStackParamList, "Alerts">

// ─── Tipos ───────────────────────────────────────────────────────────────────

type AlertType = "info" | "success" | "warning" | "update"

interface AppAlert {
  id: string
  type: AlertType
  title: string
  body: string
  date: string
  read: boolean
}

interface RawNotification {
  id: string
  incident_id: string | null
  titulo: string
  mensaje: string
  estado: "PENDIENTE" | "ENVIADA" | "LEIDA" | "FALLIDA"
  created_at: string
}

// ─── Configuración visual por tipo ───────────────────────────────────────────

const ALERT_CONFIG: Record<
  AlertType,
  { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; bg: string }
> = {
  success: { icon: "checkmark-circle",    color: colors.success, bg: "#DCFCE7" },
  info:    { icon: "information-circle",  color: colors.primary, bg: colors.primaryLight },
  warning: { icon: "alert-circle",        color: colors.warning, bg: "#FEF3C7" },
  update:  { icon: "person-circle",       color: "#7C3AED",      bg: "#EDE9FE" },
}

function inferType(titulo: string): AlertType {
  const t = titulo.toLowerCase()
  if (t.includes("resuelto") || t.includes("aceptado")) return "success"
  if (t.includes("rechazado") || t.includes("sin residuos")) return "warning"
  if (t.includes("atención") || t.includes("atencion") || t.includes("asignado")) return "update"
  return "info"
}

function mapNotification(n: RawNotification): AppAlert {
  return {
    id:    n.id,
    type:  inferType(n.titulo),
    title: n.titulo,
    body:  n.mensaje,
    date:  n.created_at,
    read:  n.estado === "LEIDA",
  }
}

function formatRelativeDate(iso: string): string {
  const now  = new Date()
  const date = new Date(iso)
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return "Hoy"
  if (diffDays === 1) return "Ayer"
  if (diffDays < 7)  return `Hace ${diffDays} días`
  return date.toLocaleDateString("es-EC", { day: "2-digit", month: "short" })
}

// ─── Alert Item ──────────────────────────────────────────────────────────────

function AlertItem({
  item, index, onMarkRead,
}: { item: AppAlert; index: number; onMarkRead: (id: string) => void }) {
  const cfg = ALERT_CONFIG[item.type]
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(380)}>
      <TouchableOpacity
        style={[styles.alertCard, !item.read && styles.alertCardUnread]}
        onPress={() => !item.read && onMarkRead(item.id)}
        activeOpacity={0.82}
      >
        {!item.read && <View style={styles.unreadDot} />}
        <View style={[styles.alertIconWrap, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon} size={24} color={cfg.color} />
        </View>
        <View style={styles.alertBody}>
          <View style={styles.alertTopRow}>
            <Text style={styles.alertTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.alertDate}>{formatRelativeDate(item.date)}</Text>
          </View>
          <Text style={styles.alertText} numberOfLines={3}>{item.body}</Text>
          {!item.read && <Text style={styles.tapHint}>Toca para marcar como leída</Text>}
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function AlertsScreen({ navigation }: Props) {
  const [alerts,     setAlerts]     = useState<AppAlert[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const unreadCount = alerts.filter((a) => !a.read).length

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    setError(null)
    try {
      const res = await api.get("/incidents/notifications")
      const raw: RawNotification[] = Array.isArray(res.data?.notifications)
        ? res.data.notifications
        : []
      setAlerts(raw.map(mapNotification))
    } catch {
      setError("No se pudieron cargar las notificaciones.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  const markRead = useCallback(async (id: string) => {
    // Actualizar UI optimistamente
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)))
    try {
      await api.put(`/incidents/notifications/${id}/read`)
    } catch {
      // Revertir si falla
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: false } : a)))
    }
  }, [])

  const markAllRead = useCallback(async () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })))
    try {
      await api.put("/incidents/notifications/read-all")
    } catch {
      setAlerts((prev) => prev.map((a) => ({ ...a, read: false })))
    }
  }, [])

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#B45309" />

      {/* Header */}
      <Animated.View entering={FadeInUp.duration(400)} style={styles.header}>
        <View style={styles.hdecCircle1} />
        <View style={styles.hdecCircle2} />
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconWrap}>
              <Ionicons name="notifications" size={26} color="#fff" />
              {unreadCount > 0 && (
                <View style={styles.headerBadge}>
                  <Text style={styles.headerBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </View>
            <View>
              <Text style={styles.headerTitle}>Alertas</Text>
              <Text style={styles.headerSub}>
                {unreadCount > 0
                  ? `${unreadCount} notificación${unreadCount !== 1 ? "es" : ""} sin leer`
                  : "Todo al día"}
              </Text>
            </View>
          </View>
          {unreadCount > 0 && (
            <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
              <Text style={styles.markAllText}>Leer todo</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* Lista */}
      {loading ? (
        <View style={styles.center}>
          <Ionicons name="notifications-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.loadingText}>Cargando notificaciones…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textTertiary} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchNotifications()}>
            <Ionicons name="refresh-outline" size={16} color="#fff" />
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchNotifications(true)}
              colors={[colors.warning]}
            />
          }
          ListHeaderComponent={
            alerts.length > 0 ? (
              <Animated.Text
                entering={FadeInDown.delay(80).duration(350)}
                style={styles.sectionLabel}
              >
                Notificaciones recientes
              </Animated.Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={52} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>Sin notificaciones</Text>
              <Text style={styles.emptyText}>
                Aquí aparecerán los cambios de estado de tus reportes.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <AlertItem item={item} index={index} onMarkRead={markRead} />
          )}
        />
      )}
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: "#D97706",
    paddingTop: 52,
    paddingBottom: 24,
    paddingHorizontal: 20,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#B45309",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  hdecCircle1: {
    position: "absolute", width: 220, height: 220, borderRadius: 110,
    backgroundColor: "rgba(255,255,255,0.07)", top: -60, right: -50,
  },
  hdecCircle2: {
    position: "absolute", width: 140, height: 140, borderRadius: 70,
    backgroundColor: "rgba(0,0,0,0.1)", bottom: -40, left: -20,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center", alignItems: "center", marginBottom: 14,
  },
  headerContent:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft:     { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center", alignItems: "center",
  },
  headerBadge: {
    position: "absolute", top: -2, right: -2,
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.error,
    justifyContent: "center", alignItems: "center",
    paddingHorizontal: 4, borderWidth: 2, borderColor: "#D97706",
  },
  headerBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  headerTitle:    { color: "#fff", fontSize: 20, fontWeight: "800" },
  headerSub:      { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2 },
  markAllBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
  },
  markAllText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  listContent:  { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11, fontWeight: "700", color: colors.textTertiary,
    letterSpacing: 1.2, textTransform: "uppercase",
    marginBottom: 12, marginLeft: 2,
  },
  alertCard: {
    flexDirection: "row", backgroundColor: colors.surface,
    borderRadius: 16, padding: 14, marginBottom: 10,
    gap: 12, alignItems: "flex-start",
    elevation: 2, shadowColor: "#000",
    shadowOpacity: 0.05, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, position: "relative",
  },
  alertCardUnread: { borderLeftWidth: 4, borderLeftColor: "#D97706" },
  unreadDot: {
    position: "absolute", top: 12, right: 12,
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#D97706",
  },
  alertIconWrap: {
    width: 46, height: 46, borderRadius: 13,
    justifyContent: "center", alignItems: "center", flexShrink: 0,
  },
  alertBody:   { flex: 1 },
  alertTopRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 4, gap: 8,
  },
  alertTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  alertDate:  { fontSize: 11, color: colors.textTertiary, flexShrink: 0 },
  alertText:  { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  tapHint:    { fontSize: 11, color: "#D97706", marginTop: 6, fontWeight: "600" },
  center:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  loadingText: { fontSize: 14, color: colors.textSecondary, marginTop: 8 },
  errorText:  { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  retryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
})
