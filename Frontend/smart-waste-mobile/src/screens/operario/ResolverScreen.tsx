import React, { useEffect, useRef, useState } from "react"
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
} from "react-native"
import * as Location from "expo-location"
import { Camera, useCameraPermissions, CameraView } from "expo-camera"
import * as ImageManipulator from "expo-image-manipulator"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { MapPin, Camera as CameraIcon, CheckCircle, AlertTriangle, ArrowLeft } from "lucide-react-native"
import { completarAsignacion } from "../../services/operario.service"
import { toPublicMediaUrl } from "../../utils/mediaUrl"
import type { OperarioStackParamList } from "../../navigation/OperarioNavigator"

type Props = NativeStackScreenProps<OperarioStackParamList, "Resolver">

export default function ResolverScreen({ route, navigation }: Props) {
  const { asignacion_id, incident_id, incident_lat, incident_lon } = route.params

  const [permission, requestPermission] = useCameraPermissions()
  const [gps, setGps]                   = useState<{ lat: number; lon: number; dist: number } | null>(null)
  const [gpsLoading, setGpsLoading]     = useState(false)
  const [photoUri, setPhotoUri]         = useState<string | null>(null)
  const [submitting, setSubmitting]     = useState(false)
  const cameraRef = useRef<CameraView>(null)

  // Captura GPS al montar la pantalla
  useEffect(() => {
    void captureGPS()
  }, [])

  const captureGPS = async () => {
    setGpsLoading(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") {
        Alert.alert("Permiso de ubicación", "Necesitamos tu ubicación para validar que estás en el sitio.")
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

  const takePhoto = async () => {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 })
      if (!photo?.uri) return
      // Comprimir para no sobrecargar el upload
      const compressed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      )
      setPhotoUri(compressed.uri)
    } catch {
      Alert.alert("Error", "No se pudo tomar la foto.")
    }
  }

  const handleSubmit = async () => {
    if (!gps) { Alert.alert("GPS requerido", "Captura tu ubicación primero."); return }
    if (!photoUri) { Alert.alert("Foto requerida", "Toma una foto del estado actual del sitio."); return }

    setSubmitting(true)
    try {
      // En esta versión enviamos sin foto_cierre_url (el upload a R2 se añade en P1)
      const result = await completarAsignacion(asignacion_id, {
        cierre_lat: gps.lat,
        cierre_lon: gps.lon,
      })
      Alert.alert(
        "¡Caso resuelto!",
        `Gracias por tu trabajo. Distancia al punto: ${result.distancia_cierre_m} m.`,
        [{ text: "OK", onPress: () => navigation.popToTop() }],
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo resolver el caso."
      Alert.alert("Error", msg)
    } finally {
      setSubmitting(false)
    }
  }

  // Solicitar permiso de cámara si no lo tiene
  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <CameraIcon size={48} color="#94A3B8" strokeWidth={1.2} />
        <Text style={styles.permTitle}>Permiso de cámara requerido</Text>
        <Text style={styles.permDesc}>Necesitamos la cámara para tomar la foto de evidencia del sitio limpio.</Text>
        <TouchableOpacity onPress={() => void requestPermission()} style={styles.permBtn}>
          <Text style={styles.permBtnText}>Permitir acceso a la cámara</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const distColor = gps
    ? gps.dist <= 50 ? "#166534" : gps.dist <= 200 ? "#92400E" : "#991B1B"
    : "#94A3B8"

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

        {/* GPS status */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsRow}>
            <MapPin size={18} color={distColor} strokeWidth={2} />
            <Text style={styles.gpsTitle}>Tu ubicación</Text>
          </View>
          {gpsLoading ? (
            <ActivityIndicator size="small" color="#1D4ED8" style={{ marginTop: 8 }} />
          ) : gps ? (
            <>
              <Text style={[styles.gpsDist, { color: distColor }]}>{gps.dist} m del punto reportado</Text>
              <Text style={styles.gpsCoords}>{gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}</Text>
              {gps.dist > 50 && (
                <View style={styles.gpsWarn}>
                  <AlertTriangle size={14} color="#92400E" strokeWidth={2} />
                  <Text style={styles.gpsWarnText}>
                    {gps.dist > 200
                      ? "Estás muy lejos del punto. Acércate más antes de resolver."
                      : "Estás a cierta distancia. El sistema puede rechazar el cierre si superas el límite configurado."}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <TouchableOpacity onPress={() => void captureGPS()} style={styles.gpsRetry}>
              <Text style={styles.gpsRetryText}>Reintentar captura de GPS</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Cámara / foto capturada */}
        <View style={styles.cameraSection}>
          <Text style={styles.sectionLabel}>Foto del sitio después de la limpieza</Text>
          {!photoUri ? (
            <View style={styles.cameraBox}>
              <CameraView ref={cameraRef} style={styles.camera} facing="back" />
              <TouchableOpacity onPress={() => void takePhoto()} style={styles.shutterBtn}>
                <CameraIcon size={24} color="#fff" strokeWidth={2} />
                <Text style={styles.shutterText}>Tomar foto</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photoPreview}>
              {/* Simple preview placeholder — expo-image no siempre disponible */}
              <View style={[styles.photoBg, { justifyContent: "center", alignItems: "center" }]}>
                <CheckCircle size={40} color="#166534" strokeWidth={1.5} />
                <Text style={styles.photoOk}>Foto tomada ✓</Text>
              </View>
              <TouchableOpacity onPress={() => setPhotoUri(null)} style={styles.retakeBtn}>
                <Text style={styles.retakeText}>Volver a tomar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Enviar */}
        <TouchableOpacity
          onPress={() => void handleSubmit()}
          disabled={submitting || !gps || !photoUri}
          style={[styles.submitBtn, (submitting || !gps || !photoUri) && { opacity: 0.5 }]}
          activeOpacity={0.82}
        >
          {submitting ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <CheckCircle size={20} color="#fff" strokeWidth={2} />
              <Text style={styles.submitText}>Confirmar resolución</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </View>
  )
}

// Distancia Haversine aproximada en metros
function calcDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: "#F8FAFC" },
  center:     { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 12 },
  topBar:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  backIcon:   { width: 36, height: 36, justifyContent: "center", alignItems: "center" },
  topTitle:   { flex: 1, fontSize: 16, fontWeight: "700", color: "#0F172A", textAlign: "center" },
  scroll:     { padding: 16, gap: 16, paddingBottom: 40 },
  gpsCard:    { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E2E8F0", gap: 6 },
  gpsRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  gpsTitle:   { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  gpsDist:    { fontSize: 20, fontWeight: "800" },
  gpsCoords:  { fontSize: 11, color: "#94A3B8", fontFamily: "monospace" },
  gpsWarn:    { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#FFFBEB", borderRadius: 8, padding: 8, marginTop: 4 },
  gpsWarnText: { fontSize: 12, color: "#92400E", flex: 1, lineHeight: 17 },
  gpsRetry:   { backgroundColor: "#EFF6FF", borderRadius: 10, padding: 10, alignItems: "center" },
  gpsRetryText: { fontSize: 13, fontWeight: "600", color: "#1D4ED8" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: "#475569", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  cameraSection: { gap: 0 },
  cameraBox:  { borderRadius: 14, overflow: "hidden", height: 300, position: "relative" },
  camera:     { flex: 1 },
  shutterBtn: { position: "absolute", bottom: 16, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#1D4ED8", borderRadius: 40, paddingHorizontal: 24, paddingVertical: 12 },
  shutterText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  photoPreview: { gap: 10 },
  photoBg:    { height: 180, backgroundColor: "#F0FDF4", borderRadius: 14, borderWidth: 1, borderColor: "#BBF7D0" },
  photoOk:    { fontSize: 14, fontWeight: "700", color: "#166534", marginTop: 8 },
  retakeBtn:  { alignItems: "center", paddingVertical: 10, borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12 },
  retakeText: { fontSize: 13, fontWeight: "600", color: "#475569" },
  submitBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#166534", borderRadius: 14, paddingVertical: 16, marginTop: 4 },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  permTitle:  { fontSize: 17, fontWeight: "700", color: "#0F172A", textAlign: "center" },
  permDesc:   { fontSize: 13, color: "#475569", textAlign: "center", lineHeight: 19 },
  permBtn:    { backgroundColor: "#1D4ED8", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  permBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
})
