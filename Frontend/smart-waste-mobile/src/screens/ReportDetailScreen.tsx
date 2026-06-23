import React, { useState, useEffect, useRef } from "react"
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  Animated,
  Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import * as Location from "expo-location"
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps"

import { RootStackParamList } from "../navigation/AppNavigator"
import { Incident, getMyIncidentById } from "../services/image.service"
import { ESTADO_CONFIG, NIVEL_COLOR, formatDate } from "./HistorialScreen"
import { colors } from "../theme/colors"
import { toPublicMediaUrl } from "../utils/mediaUrl"
import { MOTIVO_RECHAZO_LABEL } from "../types/incident"

type Props = NativeStackScreenProps<RootStackParamList, "ReportDetail">

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Normaliza lat/lon del incidente y valida rango geográfico.
function parseCoords(latitud: unknown, longitud: unknown): {
  lat: number | null
  lon: number | null
  hasCoords: boolean
} {
  const lat = latitud != null && !Number.isNaN(Number(latitud)) ? Number(latitud) : null
  const lon = longitud != null && !Number.isNaN(Number(longitud)) ? Number(longitud) : null
  const hasCoords =
    lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  return { lat, lon, hasCoords }
}

// Construye una dirección legible a partir del resultado de reverseGeocode.
function formatGeocodeResult(result: Location.LocationGeocodedAddress): string | null {
  const street = result.street ?? ""
  const area = result.district ?? result.subregion ?? result.city ?? ""
  const parts = [street, area].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

// Tarjeta "Recibo de IA": estado, metadatos y metricas del análisis. Extraída para
// mantener ReportDetailScreen por debajo del umbral de complejidad cognitiva.
function AiReceiptCard({ incident }: Readonly<{ incident: Incident }>) {
  const cfg = ESTADO_CONFIG[incident.estado] ?? ESTADO_CONFIG.PENDIENTE
  const nivelColor = incident.nivel_acumulacion
    ? (NIVEL_COLOR[incident.nivel_acumulacion] ?? colors.gray400)
    : colors.gray400

  return (
    <View style={styles.receiptCard}>
      {/* Encabezado del recibo */}
      <View style={styles.receiptHeader}>
        <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
          <cfg.LucideIcon size={14} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={styles.receiptDate}>{formatDate(incident.created_at)}</Text>
      </View>

      <View style={styles.divider} />

      <MetaRow icon="calendar-outline" label="Fecha y hora" value={formatDateTime(incident.created_at)} />

      {incident.nivel_acumulacion && (
        <MetaRow
          icon="layers-outline"
          label="Nivel de acumulación"
          value={incident.nivel_acumulacion}
          valueColor={nivelColor}
        />
      )}

      {incident.prioridad && incident.estado !== "PROCESANDO" && (
        <MetaRow
          icon="flag-outline"
          label="Prioridad"
          value={incident.prioridad}
          valueColor={PRIORIDAD_COLOR[incident.prioridad]}
        />
      )}

      {incident.tipo_residuo && (
        <MetaRow icon="trash-outline" label="Tipo de residuo" value={incident.tipo_residuo} />
      )}

      {incident.volumen_estimado_m3 != null && (
        <MetaRow
          icon="cube-outline"
          label="Volumen estimado"
          value={`${incident.volumen_estimado_m3} m³`}
        />
      )}

      {incident.zona_nombre ? (
        <MetaRow icon="map-outline" label="Zona asignada" value={incident.zona_nombre} />
      ) : null}

      {incident.resuelto_at && incident.estado === "RESUELTA" ? (
        <MetaRow
          icon="checkmark-circle-outline"
          label="Resuelto el"
          value={formatDateTime(incident.resuelto_at)}
        />
      ) : null}

      {incident.confianza != null && (
        <MetaRow
          icon="analytics-outline"
          label="Confianza IA"
          value={`${(incident.confianza * 100).toFixed(1)} %`}
        />
      )}

      {incident.num_detecciones != null && (
        <MetaRow
          icon="eye-outline"
          label="Detecciones"
          value={String(incident.num_detecciones)}
        />
      )}

      {incident.descripcion ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.descLabel}>Descripción</Text>
          <Text style={styles.descText}>{incident.descripcion}</Text>
        </>
      ) : null}

      {/* Motivo de rechazo — visible al ciudadano cuando el supervisor rechaza */}
      {incident.estado === "RECHAZADO" && incident.motivo_rechazo ? (
        <>
          <View style={styles.divider} />
          <View style={styles.rechazoCard}>
            <Ionicons name="information-circle-outline" size={18} color="#B45309" />
            <View style={{ flex: 1 }}>
              <Text style={styles.rechazoTitle}>Motivo del rechazo</Text>
              <Text style={styles.rechazoText}>
                {MOTIVO_RECHAZO_LABEL[incident.motivo_rechazo]}
              </Text>
              {incident.observaciones_rechazo ? (
                <Text style={styles.rechazoObs}>{`"${incident.observaciones_rechazo}"`}</Text>
              ) : null}
            </View>
          </View>
        </>
      ) : null}
    </View>
  )
}

// ─── IncidentMap ─────────────────────────────────────────────────────────────
// Mapa embebido con el marcador del incidente y botón de navegación.

function IncidentMap({
  lat,
  lon,
  address,
}: Readonly<{ lat: number; lon: number; address: string | null }>) {
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
      ]),
    )
    pulse.start()
    return () => pulse.stop()
  }, [pulseAnim])

  const openInMaps = () => {
    const label = encodeURIComponent("Incidente EMASEO")
    const url =
      Platform.OS === "ios"
        ? `maps:?q=${label}&ll=${lat},${lon}`
        : `geo:${lat},${lon}?q=${lat},${lon}(${label})`
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`),
    )
  }

  return (
    <View style={styles.mapContainer}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude:       lat,
          longitude:      lon,
          latitudeDelta:  0.003,
          longitudeDelta: 0.003,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        accessibilityLabel="Mapa de ubicación del incidente"
      >
        <Marker
          coordinate={{ latitude: lat, longitude: lon }}
          title="Incidente reportado"
          description={address ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`}
        >
          {/* Marcador personalizado con anillo pulsante */}
          <View style={styles.markerWrapper}>
            <Animated.View
              style={[
                styles.markerPulse,
                { transform: [{ scale: pulseAnim }] },
              ]}
            />
            <View style={styles.markerCore}>
              <Ionicons name="location" size={16} color="#fff" />
            </View>
          </View>
        </Marker>
      </MapView>

      {/* Capa de info + botón de navegación sobre el mapa */}
      <View style={styles.mapOverlay}>
        <View style={styles.mapAddressChip}>
          <Ionicons name="location-outline" size={13} color={colors.primary} />
          <Text style={styles.mapAddressText} numberOfLines={1}>
            {address ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.mapNavBtn}
          onPress={openInMaps}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Abrir en el mapa del dispositivo"
        >
          <Ionicons name="navigate-outline" size={16} color="#fff" />
          <Text style={styles.mapNavBtnText}>Navegar</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default function ReportDetailScreen({ route, navigation }: Readonly<Props>) {
  const [incident, setIncident] = useState<Incident>(route.params.incident)

  if (__DEV__) console.log("Datos recibidos en detalle:", JSON.stringify(route.params, null, 2))

  const { lat, lon, hasCoords } = parseCoords(incident.latitud, incident.longitud)

  const [address, setAddress] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  // Refrescar el incidente al montar: garantiza datos al día (zona, estado actualizado)
  // y campos que la lista no siempre trae (volumen, dirección backend).
  useEffect(() => {
    getMyIncidentById(incident.id)
      .then(setIncident)
      .catch(() => {})
  }, [incident.id])

  useEffect(() => {
    if (!hasCoords) return
    Location.reverseGeocodeAsync({ latitude: lat!, longitude: lon! })
      .then(([result]) => {
        if (!result) return
        setAddress(formatGeocodeResult(result))
      })
      .catch(() => {})
  }, [lat, lon, hasCoords])

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detalle del Reporte</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Mapa embebido / fallback ───────────────────────────────── */}
        {hasCoords ? (
          <IncidentMap lat={lat!} lon={lon!} address={address} />
        ) : (
          <View style={[styles.mapContainer, styles.mapFallback]}>
            <Ionicons name="map-outline" size={32} color={colors.gray400} />
            <Text style={styles.mapFallbackText}>Ubicación no disponible</Text>
          </View>
        )}

        {/* ── Foto de la incidencia ──────────────────────────────────── */}
        {toPublicMediaUrl(incident.image_url) && !imgError ? (
          <Image
            source={{ uri: toPublicMediaUrl(incident.image_url)! }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.image, styles.imageFallback]}>
            <Ionicons name="image-outline" size={52} color={colors.gray400} />
            <Text style={styles.imageFallbackText}>
              {incident.estado === "PROCESANDO"
                ? "Imagen disponible cuando termine el análisis"
                : "Sin imagen disponible"}
            </Text>
          </View>
        )}

        {/* ── Recibo de IA ───────────────────────────────────────────── */}
        <AiReceiptCard incident={incident} />

      </ScrollView>
    </View>
  )
}

// ─── MetaRow ──────────────────────────────────────────────────────────────────

function MetaRow({
  icon,
  label,
  value,
  valueColor,
}: Readonly<{
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  value: string
  valueColor?: string
}>) {
  return (
    <View style={styles.metaRow}>
      <View style={styles.metaLeft}>
        <Ionicons name={icon} size={15} color={colors.gray500} />
        <Text style={styles.metaLabel}>{label}</Text>
      </View>
      <Text style={[styles.metaValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORIDAD_COLOR: Record<Incident["prioridad"], string> = {
  BAJA:    colors.bajo,
  MEDIA:   colors.medio,
  ALTA:    colors.alto,
  CRITICA: colors.critico,
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.primary,
    paddingTop: 52,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    elevation: 8,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
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
    fontSize: 18,
    fontWeight: "800",
  },
  scroll: {
    paddingBottom: 48,
  },

  // ── Map ──────────────────────────────────────────────────────────────────────
  mapContainer: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 16,
    overflow: "hidden",
    height: 220,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapFallback: {
    backgroundColor: colors.gray100,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  mapFallbackText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  mapOverlay: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  mapAddressChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  mapAddressText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  mapNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  mapNavBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  // Marcador personalizado con anillo pulsante
  markerWrapper: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  markerPulse: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${colors.primary}40`,
  },
  markerCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },

  // Image
  image: {
    width: "100%",
    height: 240,
  },
  imageFallback: {
    backgroundColor: colors.gray100,
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  imageFallbackText: {
    fontSize: 13,
    color: colors.textTertiary,
  },

  // Receipt card
  receiptCard: {
    margin: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  receiptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  receiptDate: {
    fontSize: 12,
    color: colors.textTertiary,
    fontWeight: "600",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: colors.gray100,
    marginVertical: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  descLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  descText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  rechazoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FFFBEB",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  rechazoTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400E",
    marginBottom: 2,
  },
  rechazoText: {
    fontSize: 13,
    color: "#78350F",
    lineHeight: 18,
  },
  rechazoObs: {
    fontSize: 12,
    color: "#92400E",
    fontStyle: "italic",
    marginTop: 4,
  },
})
