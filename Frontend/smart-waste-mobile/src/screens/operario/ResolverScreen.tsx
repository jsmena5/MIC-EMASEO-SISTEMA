import React, { useEffect, useState } from "react"
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from "react-native"
import * as Location from "expo-location"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { MapPin, CheckCircle, AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react-native"
import { completarAsignacion } from "../../services/operario.service"
import type { OperarioStackParamList } from "../../navigation/OperarioNavigator"

type Props = NativeStackScreenProps<OperarioStackParamList, "Resolver">

export default function ResolverScreen({ route, navigation }: Props) {
  const { asignacion_id, incident_lat, incident_lon } = route.params

  const [gps, setGps]           = useState<{ lat: number; lon: number; dist: number } | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [confirmed, setConfirmed]   = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { void captureGPS() }, [])

  const captureGPS = async () => {
    setGpsLoading(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") {
        Alert.alert("Permiso requerido", "Necesitamos tu ubicación para validar que estás en el sitio.")
        return
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const dist = calcDist(loc.coords.latitude, loc.coords.longitude, incident_lat, incident_lon)
      setGps({ lat: loc.coords.latitude, lon: loc.coords.longitude, dist: Math.round(dist) })
    } catch {
      Alert.alert("Error de GPS", "No se pudo obtener tu ubicación. Intenta de nuevo.")
    } finally {
      setGpsLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!gps) { Alert.alert("GPS requerido", "Captura tu ubicación primero."); return }
    if (!confirmed) { Alert.alert("Confirmación requerida", "Marca la casilla de confirmación antes de continuar."); return }

    setSubmitting(true)
    try {
      const result = await completarAsignacion(asignacion_id, {
        cierre_lat: gps.lat,
        cierre_lon: gps.lon,
      })
      Alert.alert(
        "¡Caso resuelto!",
        `El reporte fue cerrado. Distancia al punto: ${result.distancia_cierre_m} m.\n\nEl ciudadano será notificado.`,
        [{ text: "OK", onPress: () => navigation.popToTop() }],
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo resolver el caso."
      Alert.alert("Error", msg)
    } finally {
      setSubmitting(false)
    }
  }

  const distColor = gps
    ? gps.dist <= 50  ? "#166534"
    : gps.dist <= 150 ? "#92400E"
    : "#991B1B"
    : "#94A3B8"

  const canSubmit = gps !== null && confirmed && !submitting

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backIcon}>
          <ArrowLeft size={20} color="#0F172A" strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Resolver caso</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Instrucción */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>¿Terminaste la limpieza?</Text>
          <Text style={styles.infoDesc}>
            Captura tu ubicación actual para confirmar que estás en el sitio del reporte.
            El sistema validará que estás dentro del radio de tolerancia.
          </Text>
        </View>

        {/* GPS card */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsHeader}>
            <MapPin size={18} color={distColor} strokeWidth={2} />
            <Text style={styles.gpsTitle}>Tu ubicación actual</Text>
          </View>

          {gpsLoading ? (
            <View style={styles.gpsLoading}>
              <ActivityIndicator size="small" color="#1D4ED8" />
              <Text style={styles.gpsLoadingText}>Obteniendo GPS…</Text>
            </View>
          ) : gps ? (
            <>
              <Text style={[styles.gpsDist, { color: distColor }]}>
                {gps.dist} m del punto reportado
              </Text>
              <Text style={styles.gpsCoords}>
                {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}
              </Text>

              {gps.dist > 150 && (
                <View style={styles.warnBox}>
                  <AlertTriangle size={14} color="#92400E" strokeWidth={2} />
                  <Text style={styles.warnText}>
                    Estás lejos del punto. El servidor puede rechazar el cierre si superas el límite configurado. Acércate más.
                  </Text>
                </View>
              )}

              {gps.dist <= 50 && (
                <View style={styles.okBox}>
                  <CheckCircle size={14} color="#166534" strokeWidth={2} />
                  <Text style={styles.okText}>Estás dentro del rango — puedes resolver.</Text>
                </View>
              )}

              <TouchableOpacity onPress={() => void captureGPS()} style={styles.refreshBtn}>
                <RefreshCw size={13} color="#475569" strokeWidth={2} />
                <Text style={styles.refreshText}>Actualizar ubicación</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={() => void captureGPS()} style={styles.captureBtn}>
              <MapPin size={16} color="#fff" strokeWidth={2} />
              <Text style={styles.captureBtnText}>Capturar mi ubicación</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Confirmación manual */}
        <TouchableOpacity
          onPress={() => setConfirmed(v => !v)}
          style={styles.checkRow}
          activeOpacity={0.75}
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxActive]}>
            {confirmed && <CheckCircle size={16} color="#fff" strokeWidth={2.5} />}
          </View>
          <Text style={styles.checkLabel}>
            Confirmo que el punto fue atendido y el área está limpia.
          </Text>
        </TouchableOpacity>

        {/* Nota P1 */}
        <Text style={styles.p1Note}>
          📷 La foto de evidencia estará disponible próximamente.
        </Text>

        {/* Botón enviar */}
        <TouchableOpacity
          onPress={() => void handleSubmit()}
          disabled={!canSubmit}
          style={[styles.submitBtn, !canSubmit && { opacity: 0.45 }]}
          activeOpacity={0.82}
        >
          {submitting
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <CheckCircle size={20} color="#fff" strokeWidth={2} />
                <Text style={styles.submitText}>Confirmar resolución</Text>
              </>
          }
        </TouchableOpacity>

      </ScrollView>
    </View>
  )
}

function calcDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: "#F8FAFC" },
  topBar:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  backIcon:      { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  topTitle:      { flex: 1, fontSize: 16, fontWeight: "700", color: "#0F172A", textAlign: "center" },
  scroll:        { padding: 16, gap: 16, paddingBottom: 40 },
  infoBox:       { backgroundColor: "#EFF6FF", borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: "#BFDBFE" },
  infoTitle:     { fontSize: 15, fontWeight: "700", color: "#1E40AF" },
  infoDesc:      { fontSize: 13, color: "#3730A3", lineHeight: 19 },
  gpsCard:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E2E8F0", gap: 10 },
  gpsHeader:     { flexDirection: "row", alignItems: "center", gap: 7 },
  gpsTitle:      { fontSize: 14, fontWeight: "700", color: "#0F172A" },
  gpsLoading:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  gpsLoadingText: { fontSize: 13, color: "#64748B" },
  gpsDist:       { fontSize: 22, fontWeight: "800" },
  gpsCoords:     { fontSize: 11, color: "#94A3B8", fontFamily: "monospace" },
  warnBox:       { flexDirection: "row", gap: 7, alignItems: "flex-start", backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10 },
  warnText:      { fontSize: 12, color: "#92400E", flex: 1, lineHeight: 17 },
  okBox:         { flexDirection: "row", gap: 7, alignItems: "center", backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10 },
  okText:        { fontSize: 12, color: "#166534", fontWeight: "600" },
  refreshBtn:    { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "#E2E8F0" },
  refreshText:   { fontSize: 12, color: "#475569", fontWeight: "600" },
  captureBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#1D4ED8", borderRadius: 12, paddingVertical: 12 },
  captureBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  checkRow:      { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E2E8F0" },
  checkbox:      { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#CBD5E1", justifyContent: "center", alignItems: "center", marginTop: 1 },
  checkboxActive: { backgroundColor: "#166534", borderColor: "#166534" },
  checkLabel:    { flex: 1, fontSize: 14, color: "#0F172A", lineHeight: 20 },
  p1Note:        { fontSize: 12, color: "#94A3B8", textAlign: "center" },
  submitBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#166534", borderRadius: 14, paddingVertical: 16 },
  submitText:    { color: "#fff", fontWeight: "800", fontSize: 16 },
})
