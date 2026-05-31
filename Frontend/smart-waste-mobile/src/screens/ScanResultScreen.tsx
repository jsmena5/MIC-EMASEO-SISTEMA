import React, { useState } from "react"
import {
  Image, Linking, Modal, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native"
import { useNavigation, useRoute } from "@react-navigation/native"
import { Ionicons } from "@expo/vector-icons"
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack"
import type { RootStackParamList } from "../navigation/AppNavigator"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "ScanResult">
type NavProp = NativeStackNavigationProp<RootStackParamList>

const NIVEL_COLORS: Record<string, string> = {
  BAJO:    "#16A34A",
  MEDIO:   "#CA8A04",
  ALTO:    "#EA580C",
  CRITICO: "#DC2626",
}

const NIVEL_LABELS: Record<string, string> = {
  BAJO:    "Acumulación Baja",
  MEDIO:   "Acumulación Media",
  ALTO:    "Acumulación Alta",
  CRITICO: "Acumulación Crítica",
}

const TIPO_LABELS: Record<string, string> = {
  DOMESTICO:  "Doméstico",
  ORGANICO:   "Orgánico",
  RECICLABLE: "Reciclable",
  ESCOMBROS:  "Escombros",
  PELIGROSO:  "Peligroso",
  MIXTO:      "Mixto",
  OTRO:       "Otro",
}

const TOOLTIPS = {
  detecciones:
    "Número de objetos de basura que la IA identificó en la imagen. Más objetos suelen indicar mayor acumulación.",
  confianza:
    "Qué tan segura está la IA de su análisis. Por encima del 70 % se considera una detección confiable.",
  prioridad:
    "Urgencia de atención estimada por la IA según el volumen y tipo de residuo:\n\n• Baja — puede esperar\n• Media — atención próxima\n• Alta — requiere atención pronto\n• Crítica — atención inmediata",
  mixto:
    "La IA detectó varios tipos de residuos mezclados (plásticos, orgánicos, cartón, etc.) y no pudo determinar un tipo dominante. El equipo de recolección llevará los materiales adecuados.",
  estado:
    "Tu reporte fue recibido y está en cola para ser revisado por un supervisor. Puedes seguir el estado desde 'Mis Reportes'.",
}

export default function ScanResultScreen() {
  const navigation = useNavigation<NavProp>()
  const route = useRoute<Props["route"]>()
  const { result, latitude, longitude, imageUri } = route.params

  const [tooltip, setTooltip] = useState<{ title: string; text: string } | null>(null)

  const color = NIVEL_COLORS[result.nivel_acumulacion] ?? "#6B7280"
  const label = NIVEL_LABELS[result.nivel_acumulacion] ?? result.nivel_acumulacion
  const shortId = result.incident_id.slice(-8).toUpperCase()

  const tipoLabel = TIPO_LABELS[result.tipo_residuo] ?? result.tipo_residuo
  const esMixto = result.tipo_residuo === "MIXTO"

  return (
    <ScrollView contentContainerStyle={styles.container}>

      {/* Encabezado con color semafórico */}
      <View style={[styles.header, { backgroundColor: color }]}>
        <Text style={styles.headerTitle}>{label}</Text>
        <Text style={styles.headerSub}>Reporte #{shortId}</Text>
      </View>

      {/* Imagen analizada */}
      {imageUri && (
        <View style={styles.capturedImageCard}>
          <Image
            source={{ uri: imageUri }}
            style={styles.capturedImage}
            resizeMode="contain"
            accessibilityLabel="Región analizada por la IA"
          />
          <View style={styles.imageLabel}>
            <Text style={styles.imageLabelText}>📐 Imagen enviada al análisis IA</Text>
          </View>
        </View>
      )}

      {/* Aviso de penalización por foto muy cercana */}
      {result.scale_penalty_applied && (
        <View style={styles.penaltyBanner}>
          <Text style={styles.penaltyText}>
            ⚠️ La foto parece tomada muy de cerca y la prioridad fue ajustada. Para la próxima, usa el marco guía de la cámara.
          </Text>
        </View>
      )}

      {/* Ubicación */}
      <TouchableOpacity
        style={styles.mapCard}
        activeOpacity={0.75}
        onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`)}
      >
        <View style={styles.mapCardLeft}>
          <View style={styles.mapPin}>
            <Ionicons name="location" size={22} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.mapCardTitle}>Ver ubicación en mapa</Text>
            <Text style={styles.mapCardCoords}>{`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}</Text>
          </View>
        </View>
        <Ionicons name="open-outline" size={18} color={colors.primary} />
      </TouchableOpacity>

      {/* Métricas principales con tooltips */}
      <View style={styles.grid}>
        <MetricCard label="Volumen estimado" value={`${result.volumen_estimado_m3} m³`} />
        <MetricCard
          label="Prioridad"
          value={result.prioridad}
          onInfo={() => setTooltip({ title: "Prioridad", text: TOOLTIPS.prioridad })}
        />
        <MetricCard
          label="Detecciones"
          value={String(result.num_detecciones)}
          onInfo={() => setTooltip({ title: "Detecciones", text: TOOLTIPS.detecciones })}
        />
        <MetricCard
          label="Confianza"
          value={`${Math.round(result.confianza * 100)}%`}
          onInfo={() => setTooltip({ title: "Confianza", text: TOOLTIPS.confianza })}
        />
      </View>

      {/* Detalles adicionales */}
      <View style={styles.detailsBox}>
        <DetailRow
          label="Tipo de residuo"
          value={tipoLabel}
          onInfo={esMixto ? () => setTooltip({ title: "Tipo Mixto", text: TOOLTIPS.mixto }) : undefined}
        />
        {result.coverage_ratio != null && (
          <DetailRow
            label="Cobertura de imagen"
            value={`${Math.round(result.coverage_ratio * 100)}%`}
          />
        )}
        <DetailRow
          label="Estado"
          value="PENDIENTE — En cola"
          onInfo={() => setTooltip({ title: "Estado del reporte", text: TOOLTIPS.estado })}
        />
      </View>

      {/* Acciones */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: color }]}
        onPress={() => navigation.navigate("Scan")}
      >
        <Text style={styles.buttonText}>Reportar otro</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.buttonSecondary}
        onPress={() => navigation.navigate("Home")}
      >
        <Text style={styles.buttonSecondaryText}>Ir al inicio</Text>
      </TouchableOpacity>

      {/* Tooltip modal */}
      <Modal
        visible={tooltip !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setTooltip(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setTooltip(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{tooltip?.title}</Text>
            <Text style={styles.modalText}>{tooltip?.text}</Text>
            <TouchableOpacity style={styles.modalClose} onPress={() => setTooltip(null)}>
              <Text style={styles.modalCloseText}>Entendido</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

    </ScrollView>
  )
}

// ─── Componentes internos ────────────────────────────────────────────────────

function MetricCard({
  label, value, onInfo,
}: { label: string; value: string; onInfo?: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardValue}>{value}</Text>
      <View style={styles.cardLabelRow}>
        <Text style={styles.cardLabel}>{label}</Text>
        {onInfo && (
          <TouchableOpacity onPress={onInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="information-circle-outline" size={15} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

function DetailRow({
  label, value, onInfo,
}: { label: string; value: string; onInfo?: () => void }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLabelRow}>
        <Text style={styles.detailLabel}>{label}</Text>
        {onInfo && (
          <TouchableOpacity onPress={onInfo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="information-circle-outline" size={14} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#F9FAFB",
    paddingBottom: 32,
  },
  header: {
    paddingVertical: 36,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "bold",
    textAlign: "center",
  },
  headerSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    marginTop: 6,
  },
  mapCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    marginHorizontal: 12,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 12,
    padding: 16,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
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
    color: "#6B7280",
    fontFamily: "monospace",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    gap: 8,
  },
  card: {
    width: "47%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardValue: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#111827",
  },
  cardLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  cardLabel: {
    fontSize: 12,
    color: "#6B7280",
    textAlign: "center",
  },
  detailsBox: {
    backgroundColor: "#fff",
    marginHorizontal: 12,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  detailLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  detailLabel: {
    color: "#6B7280",
    fontSize: 14,
  },
  detailValue: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "600",
    maxWidth: "55%",
    textAlign: "right",
  },
  button: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  buttonSecondary: {
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
  },
  buttonSecondaryText: {
    color: "#374151",
    fontSize: 16,
    fontWeight: "600",
  },
  penaltyBanner: {
    backgroundColor: "#FEF9C3",
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: "#EAB308",
  },
  penaltyText: {
    color: "#713F12",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  capturedImageCard: {
    marginHorizontal: 12,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 12,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    backgroundColor: "#000",
  },
  capturedImage: {
    width: "100%",
    height: 220,
  },
  imageLabel: {
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  imageLabelText: {
    color: "#A7F3D0",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  // Modal tooltip
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 360,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },
  modalText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 22,
    marginBottom: 20,
  },
  modalClose: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  modalCloseText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
})
