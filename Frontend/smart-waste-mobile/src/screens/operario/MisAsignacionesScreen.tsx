import React, { useCallback, useState } from "react"
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, StatusBar,
} from "react-native"
import { useFocusEffect } from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { ClipboardList, MapPin, Calendar, AlertCircle, Clock } from "lucide-react-native"
import { getAsignaciones, type Asignacion } from "../../services/operario.service"
import { useAuth } from "../../contexts/AuthContext"
import type { OperarioStackParamList } from "../../navigation/OperarioNavigator"

type Props = NativeStackScreenProps<OperarioStackParamList, "MisAsignaciones">

const PRIORIDAD_COLOR: Record<string, string> = {
  CRITICA: "#991B1B", ALTA: "#92400E", MEDIA: "#CA8A04", BAJA: "#166534",
}
const PRIORIDAD_BG: Record<string, string> = {
  CRITICA: "#FFF1F2", ALTA: "#FFFBEB", MEDIA: "#FEFCE8", BAJA: "#F0FDF4",
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" })
}

function DeadlineBadge({ fecha_esperada }: Readonly<{ fecha_esperada: string | null }>) {
  if (!fecha_esperada) return null
  const hrs = (new Date(fecha_esperada).getTime() - Date.now()) / 3_600_000
  let bg: string, fg: string, label: string
  if (hrs < 0)   { bg = "#FFF1F2"; fg = "#991B1B"; label = "Vencido" }
  else if (hrs <= 2)  { bg = "#FFF7ED"; fg = "#C2410C"; label = `${Math.ceil(hrs * 60)} min restantes` }
  else if (hrs <= 8)  { bg = "#FEFCE8"; fg = "#92400E"; label = `${Math.round(hrs)} h restantes` }
  else                { bg = "#F0FDF4"; fg = "#166534"; label = fmtDate(fecha_esperada) }
  const Icon = hrs < 0 ? AlertCircle : Clock
  return (
    <View style={[styles.deadlineBadge, { backgroundColor: bg }]}>
      <Icon size={11} color={fg} strokeWidth={2.2} />
      <Text style={[styles.deadlineText, { color: fg }]}>{label}</Text>
    </View>
  )
}

function AsignacionCard({ item, onPress }: Readonly<{ item: Asignacion; onPress: () => void }>) {
  const prioColor = PRIORIDAD_COLOR[item.prioridad ?? ""] ?? "#475569"
  const prioBg    = PRIORIDAD_BG[item.prioridad ?? ""]   ?? "#F8FAFC"
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={styles.card}>
      {/* Prioridad badge + deadline */}
      <View style={styles.badgeRow}>
        <View style={[styles.prioBadge, { backgroundColor: prioBg }]}>
          <Text style={[styles.prioText, { color: prioColor }]}>
            {item.prioridad ?? "Sin prioridad"}
          </Text>
        </View>
        <DeadlineBadge fecha_esperada={item.fecha_esperada} />
      </View>

      {/* Zona */}
      <Text style={styles.zona}>{item.zona_nombre ?? "Sin zona"}</Text>

      {/* Descripción */}
      {item.descripcion ? (
        <Text style={styles.desc} numberOfLines={2}>{item.descripcion}</Text>
      ) : null}

      {/* Metadata */}
      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <MapPin size={12} color="#64748B" strokeWidth={2} />
          <Text style={styles.metaText}>
            {item.latitud.toFixed(5)}, {item.longitud.toFixed(5)}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Calendar size={12} color="#64748B" strokeWidth={2} />
          <Text style={styles.metaText}>Asignado el {fmtDate(item.asignado_el)}</Text>
        </View>
      </View>

      <Text style={styles.cta}>Ver detalle →</Text>
    </TouchableOpacity>
  )
}

export default function MisAsignacionesScreen({ navigation }: Props) {
  const { user } = useAuth()
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([])
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const data = await getAsignaciones()
      setAsignaciones(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar tus asignaciones.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#1D4ED8" />
    </View>
  )

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Hola, {user?.nombre ?? "Operario"}</Text>
        <Text style={styles.subtitle}>Tus casos asignados para hoy</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <AlertCircle size={16} color="#991B1B" strokeWidth={2} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!error && asignaciones.length === 0 ? (
        <View style={styles.empty}>
          <ClipboardList size={52} color="#CBD5E1" strokeWidth={1.2} />
          <Text style={styles.emptyTitle}>Sin asignaciones activas</Text>
          <Text style={styles.emptyDesc}>Cuando el supervisor te asigne un caso, aparecerá aquí.</Text>
        </View>
      ) : (
        <FlatList
          data={asignaciones}
          keyExtractor={item => item.asignacion_id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true) }}
              colors={["#1D4ED8"]} tintColor="#1D4ED8" />
          }
          renderItem={({ item }) => (
            <AsignacionCard item={item} onPress={() =>
              navigation.navigate("AsignacionDetail", { asignacion_id: item.asignacion_id })
            } />
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#F8FAFC" },
  center:     { flex: 1, justifyContent: "center", alignItems: "center" },
  header:     { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  greeting:   { fontSize: 20, fontWeight: "800", color: "#0F172A" },
  subtitle:   { fontSize: 13, color: "#64748B", marginTop: 2 },
  list:       { padding: 16, gap: 12 },
  card:       { backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2E8F0", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  prioBadge:  { alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  prioText:   { fontSize: 11, fontWeight: "700" },
  zona:       { fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 4 },
  desc:       { fontSize: 13, color: "#475569", marginBottom: 10, lineHeight: 19 },
  meta:       { gap: 4, marginBottom: 10 },
  metaRow:    { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText:   { fontSize: 11, color: "#64748B" },
  cta:        { fontSize: 12, fontWeight: "700", color: "#1D4ED8", textAlign: "right" },
  badgeRow:   { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 },
  deadlineBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  deadlineText:  { fontSize: 11, fontWeight: "700" },
  errorBox:   { flexDirection: "row", alignItems: "center", gap: 8, margin: 16, padding: 12, backgroundColor: "#FFF1F2", borderRadius: 12, borderWidth: 1, borderColor: "#FECACA" },
  errorText:  { fontSize: 13, color: "#991B1B", flex: 1 },
  empty:      { flex: 1, justifyContent: "center", alignItems: "center", padding: 40, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#475569" },
  emptyDesc:  { fontSize: 13, color: "#94A3B8", textAlign: "center" },
})
