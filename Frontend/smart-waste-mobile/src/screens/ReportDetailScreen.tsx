import React, { useState, useEffect } from "react"
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import * as Location from "expo-location"

import { RootStackParamList } from "../navigation/AppNavigator"
import { Incident, getMyIncidentById } from "../services/image.service"
import { ESTADO_CONFIG, NIVEL_COLOR, formatDate } from "./HistorialScreen"
import { colors } from "../theme/colors"
import { toPublicMediaUrl } from "../utils/mediaUrl"
import { MOTIVO_RECHAZO_LABEL, type MotivoRechazo } from "../types/incident"

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

export default function ReportDetailScreen({ route, navigation }: Props) {
  const [incident, setIncident] = useState<Incident>(route.params.incident)

  if (__DEV__) console.log("Datos recibidos en detalle:", JSON.stringify(route.params, null, 2))

  const lat = incident.latitud != null && !isNaN(Number(incident.latitud)) ? Number(incident.latitud) : null
  const lon = incident.longitud != null && !isNaN(Number(incident.longitud)) ? Number(incident.longitud) : null
  const hasCoords = lat != null && lon != null &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180

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
        const street = result.street ?? ""
        const area = result.district ?? result.subregion ?? result.city ?? ""
        const parts = [street, area].filter(Boolean)
        setAddress(parts.length > 0 ? parts.join(", ") : null)
      })
      .catch(() => {})
  }, [lat, lon, hasCoords])

  const cfg = ESTADO_CONFIG[incident.estado] ?? ESTADO_CONFIG.PENDIENTE
  const nivelColor = incident.nivel_acumulacion
    ? (NIVEL_COLOR[incident.nivel_acumulacion] ?? colors.gray400)
    : colors.gray400

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

        {/* ── Ubicación ──────────────────────────────────────────────── */}
        {hasCoords ? (
          <TouchableOpacity
            style={styles.mapCard}
            activeOpacity={0.75}
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
              )
            }
          >
            <View style={styles.mapCardLeft}>
              <View style={styles.mapPin}>
                <Ionicons name="location" size={22} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.mapCardTitle}>Ver ubicación</Text>
                <Text style={styles.mapCardCoords}>{`${lat!.toFixed(5)}, ${lon!.toFixed(5)}`}</Text>
              </View>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <View style={[styles.mapCard, { opacity: 0.5 }]}>
            <Ionicons name="map-outline" size={22} color={colors.gray400} />
            <Text style={[styles.mapCardTitle, { color: colors.gray400, marginLeft: 10 }]}>
              Ubicación no disponible
            </Text>
          </View>
        )}

        {/* ── Dirección geocodificada ────────────────────────────────── */}
        <View style={styles.addressRow}>
          <Ionicons
            name="location-outline"
            size={16}
            color={address ? colors.primary : colors.gray400}
          />
          <Text
            style={address ? styles.addressText : styles.coordText}
            numberOfLines={2}
          >
            {address
              ? address
              : hasCoords
              ? `${lat!.toFixed(5)}, ${lon!.toFixed(5)}`
              : "Sin coordenadas registradas"}
          </Text>
        </View>

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
        <View style={styles.receiptCard}>
          {/* Encabezado del recibo */}
          <View style={styles.receiptHeader}>
            <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cfg.icon} size={14} color={cfg.color} />
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
          {incident.estado === "RECHAZADA" && incident.motivo_rechazo ? (
            <>
              <View style={styles.divider} />
              <View style={styles.rechazoCard}>
                <Ionicons name="information-circle-outline" size={18} color="#B45309" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rechazoTitle}>Motivo del rechazo</Text>
                  <Text style={styles.rechazoText}>
                    {MOTIVO_RECHAZO_LABEL[incident.motivo_rechazo as MotivoRechazo]}
                  </Text>
                  {incident.observaciones_rechazo ? (
                    <Text style={styles.rechazoObs}>"{incident.observaciones_rechazo}"</Text>
                  ) : null}
                </View>
              </View>
            </>
          ) : null}
        </View>

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
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  label: string
  value: string
  valueColor?: string
}) {
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

  // Location card (replaces MapView)
  mapCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 14,
    padding: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  mapCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  mapPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  mapCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: 2,
  },
  mapCardCoords: {
    fontSize: 11,
    color: colors.textTertiary,
    fontFamily: "monospace",
  },

  // Address
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  coordText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
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
