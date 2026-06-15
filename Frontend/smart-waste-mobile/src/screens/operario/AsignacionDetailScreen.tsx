import React, { useEffect, useState } from "react"
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Linking, Alert, TextInput,
} from "react-native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { MapPin, Navigation, CheckCircle, XCircle, ArrowLeft } from "lucide-react-native"
import { getAsignacionDetalle, noAtendible, type Asignacion } from "../../services/operario.service"
import { toPublicMediaUrl } from "../../utils/mediaUrl"
import type { OperarioStackParamList } from "../../navigation/OperarioNavigator"

type Props = NativeStackScreenProps<OperarioStackParamList, "AsignacionDetail">

const NIVEL_COLOR: Record<string, string> = {
  BAJO: "#166534", MEDIO: "#92400E", ALTO: "#C2410C", CRITICO: "#991B1B",
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function AsignacionDetailScreen({ route, navigation }: Props) {
  const { asignacion_id } = route.params
  const [asig, setAsig]     = useState<Asignacion | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  // No atendible
  const [showNoAtenModal, setShowNoAtenModal] = useState(false)
  const [motivo, setMotivo]                   = useState("")
  const [sending, setSending]                 = useState(false)

  useEffect(() => {
    getAsignacionDetalle(asignacion_id)
      .then(setAsig)
      .catch(e => setError(e instanceof Error ? e.message : "Error al cargar el detalle."))
      .finally(() => setLoading(false))
  }, [asignacion_id])

  const handleNavegar = () => {
    if (!asig) return
    const url = `https://www.google.com/maps/dir/?api=1&destination=${asig.latitud},${asig.longitud}`
    Linking.openURL(url).catch(() => Alert.alert("Error", "No se pudo abrir la navegación."))
  }

  const handleNoAtendible = async () => {
    if (!motivo.trim()) { Alert.alert("Requerido", "Indica el motivo."); return }
    setSending(true)
    try {
      await noAtendible(asignacion_id, motivo.trim())
      Alert.alert("Listo", "El caso fue devuelto al supervisor.", [
        { text: "OK", onPress: () => navigation.goBack() }
      ])
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "No se pudo enviar.")
    } finally {
      setSending(false)
    }
  }

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color="#1D4ED8" /></View>
  )

  if (error || !asig) return (
    <View style={styles.center}>
      <Text style={styles.errorText}>{error ?? "No encontrado."}</Text>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backBtnText}>← Volver</Text>
      </TouchableOpacity>
    </View>
  )

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backIcon}>
          <ArrowLeft size={20} color="#0F172A" strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{asig.zona_nombre ?? "Detalle"}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Prioridad + estado */}
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: "#FFFBEB" }]}>
            <Text style={[styles.badgeText, { color: "#92400E" }]}>Prioridad {asig.prioridad ?? "—"}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: "#EFF6FF" }]}>
            <Text style={[styles.badgeText, { color: "#1D4ED8" }]}>{asig.estado.replaceAll("_", " ")}</Text>
          </View>
        </View>

        {/* Zona */}
        <Text style={styles.zone}>{asig.zona_nombre ?? "Sin zona"}</Text>
        {asig.descripcion ? <Text style={styles.desc}>{asig.descripcion}</Text> : null}

        {/* Datos IA */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Análisis IA</Text>
          <View style={styles.rowGrid}>
            <InfoCell label="Tipo" value={asig.tipo_residuo ?? "—"} />
            <InfoCell label="Nivel" value={asig.nivel_acumulacion ?? "—"}
              valueColor={NIVEL_COLOR[asig.nivel_acumulacion ?? ""] ?? "#475569"} />
            <InfoCell label="Volumen" value={asig.volumen_estimado_m3 ? `${Number(asig.volumen_estimado_m3).toFixed(2)} m³` : "—"} />
          </View>
        </View>

        {/* Coordenadas */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ubicación del reporte</Text>
          <View style={[styles.coordBox, { flexDirection: "row", gap: 8, alignItems: "center" }]}>
            <MapPin size={16} color="#1D4ED8" strokeWidth={2} />
            <Text style={styles.coordText}>{asig.latitud.toFixed(6)}, {asig.longitud.toFixed(6)}</Text>
          </View>
          {asig.notas ? (
            <View style={styles.notasBox}>
              <Text style={styles.notasLabel}>Notas del supervisor:</Text>
              <Text style={styles.notasText}>{asig.notas}</Text>
            </View>
          ) : null}
          <Text style={styles.asigMeta}>
            Asignado por {asig.asignado_por_nombre ?? "supervisor"} · {fmtDate(asig.asignado_el)}
          </Text>
        </View>

        {/* Acciones */}
        <View style={styles.actions}>
          {/* Navegar */}
          <TouchableOpacity onPress={handleNavegar} style={styles.btnNavegar} activeOpacity={0.82}>
            <Navigation size={18} color="#fff" strokeWidth={2} />
            <Text style={styles.btnText}>Navegar al sitio</Text>
          </TouchableOpacity>

          {/* Resolver */}
          <TouchableOpacity
            onPress={() => navigation.navigate("Resolver", {
              asignacion_id,
              incident_id:  asig.incident_id,
              incident_lat: asig.latitud,
              incident_lon: asig.longitud,
            })}
            style={styles.btnResolver}
            activeOpacity={0.82}
          >
            <CheckCircle size={18} color="#fff" strokeWidth={2} />
            <Text style={styles.btnText}>Marcar como resuelto</Text>
          </TouchableOpacity>

          {/* No atendible */}
          <TouchableOpacity onPress={() => setShowNoAtenModal(true)} style={styles.btnNoAten} activeOpacity={0.82}>
            <XCircle size={16} color="#991B1B" strokeWidth={2} />
            <Text style={styles.btnNoAtenText}>No puedo atender este caso</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Modal no atendible */}
      {showNoAtenModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>¿Por qué no puedes atenderlo?</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Ej: acceso bloqueado, zona peligrosa, caso ya atendido…"
              placeholderTextColor="#94A3B8"
              multiline
              numberOfLines={3}
              value={motivo}
              onChangeText={setMotivo}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity onPress={() => { setShowNoAtenModal(false); setMotivo("") }}
                style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void handleNoAtendible()} disabled={sending}
                style={[styles.modalConfirm, sending && { opacity: 0.6 }]}>
                <Text style={styles.modalConfirmText}>{sending ? "Enviando…" : "Confirmar"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

function InfoCell({ label, value, valueColor }: Readonly<{ label: string; value: string; valueColor?: string }>) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoCellLabel}>{label}</Text>
      <Text style={[styles.infoCellValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#F8FAFC" },
  center:     { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  errorText:  { fontSize: 14, color: "#991B1B", textAlign: "center" },
  backBtn:    { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "#E2E8F0", borderRadius: 12 },
  backBtnText: { fontSize: 14, fontWeight: "600", color: "#475569" },
  topBar:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  backIcon:   { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  topTitle:   { flex: 1, fontSize: 16, fontWeight: "700", color: "#0F172A", textAlign: "center" },
  scroll:     { padding: 16, paddingBottom: 40, gap: 16 },
  badgeRow:   { flexDirection: "row", gap: 8 },
  badge:      { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText:  { fontSize: 11, fontWeight: "700" },
  zone:       { fontSize: 20, fontWeight: "800", color: "#0F172A" },
  desc:       { fontSize: 14, color: "#475569", lineHeight: 20 },
  section:    { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E2E8F0", gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, color: "#94A3B8" },
  rowGrid:    { flexDirection: "row", gap: 8 },
  infoCell:   { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 10, padding: 10 },
  infoCellLabel: { fontSize: 10, fontWeight: "600", color: "#94A3B8", textTransform: "uppercase", marginBottom: 3 },
  infoCellValue: { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  coordBox:   { backgroundColor: "#EFF6FF", borderRadius: 10, padding: 10 },
  coordText:  { fontSize: 13, color: "#1D4ED8", fontFamily: "monospace", flex: 1 },
  notasBox:   { backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10 },
  notasLabel: { fontSize: 10, fontWeight: "700", color: "#92400E", textTransform: "uppercase", marginBottom: 3 },
  notasText:  { fontSize: 13, color: "#78350F", lineHeight: 18 },
  asigMeta:   { fontSize: 11, color: "#94A3B8" },
  actions:    { gap: 10, marginTop: 4 },
  btnNavegar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1D4ED8", borderRadius: 14, paddingVertical: 14 },
  btnResolver: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#166534", borderRadius: 14, paddingVertical: 14 },
  btnText:    { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnNoAten:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: "#FECACA", borderRadius: 14, paddingVertical: 12 },
  btnNoAtenText: { color: "#991B1B", fontWeight: "600", fontSize: 13 },
  modalOverlay: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  modal:      { backgroundColor: "#fff", borderRadius: 20, padding: 20, gap: 14 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  modalInput: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, padding: 12, fontSize: 14, color: "#0F172A", minHeight: 80, textAlignVertical: "top" },
  modalBtns:  { flexDirection: "row", gap: 10 },
  modalCancel:  { flex: 1, alignItems: "center", paddingVertical: 12, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12 },
  modalCancelText: { fontSize: 14, fontWeight: "600", color: "#475569" },
  modalConfirm:  { flex: 1, alignItems: "center", paddingVertical: 12, backgroundColor: "#991B1B", borderRadius: 12 },
  modalConfirmText: { fontSize: 14, fontWeight: "700", color: "#fff" },
})
