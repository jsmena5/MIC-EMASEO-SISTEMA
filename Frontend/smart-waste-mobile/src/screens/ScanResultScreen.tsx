import React from "react"
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import MapView, { Marker } from "react-native-maps"
import { useNavigation, useRoute } from "@react-navigation/native"
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack"
import type { RootStackParamList } from "../navigation/AppNavigator"

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

export default function ScanResultScreen() {
  const navigation = useNavigation<NavProp>()
  const route = useRoute<Props["route"]>()
  const { result, latitude, longitude } = route.params

  const color = NIVEL_COLORS[result.nivel_acumulacion] ?? "#6B7280"
  const label = NIVEL_LABELS[result.nivel_acumulacion] ?? result.nivel_acumulacion
  const shortId = result.incident_id.slice(-8).toUpperCase()

  const region = {
    latitude,
    longitude,
    latitudeDelta: 0.003,
    longitudeDelta: 0.003,
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>

      {/* Encabezado con color semafórico */}
      <View style={[styles.header, { backgroundColor: color }]}>
        <Text style={styles.headerTitle}>{label}</Text>
        <Text style={styles.headerSub}>Reporte #{shortId}</Text>
      </View>

      {/* Aviso de penalización por foto muy cercana */}
      {result.scale_penalty_applied && (
        <View style={styles.penaltyBanner}>
          <Text style={styles.penaltyText}>
            ⚠️ Aviso: La foto parece tomada muy de cerca y la prioridad fue ajustada. Para la próxima, use el marco guía de la cámara.
          </Text>
        </View>
      )}

      {/* Minimapa — ubicación del reporte */}
      <View style={styles.mapCard}>
        <MapView
          style={styles.map}
          initialRegion={region}
          scrollEnabled={false}
          zoomEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          pointerEvents="none"
        >
          <Marker coordinate={{ latitude, longitude }} />
        </MapView>
      </View>

      {/* Tarjetas de métricas */}
      <View style={styles.grid}>
        <MetricCard label="Volumen estimado" value={`${result.volumen_estimado_m3} m³`} />
        <MetricCard label="Prioridad"         value={result.prioridad} />
        <MetricCard label="Detecciones"       value={String(result.num_detecciones)} />
        <MetricCard label="Confianza"         value={`${Math.round(result.confianza * 100)}%`} />
      </View>

      {/* Detalles adicionales */}
      <View style={styles.detailsBox}>
        <DetailRow label="Tipo de residuo"   value={result.tipo_residuo} />
        <DetailRow label="Cobertura"          value={`${Math.round(result.coverage_ratio * 100)}%`} />
        <DetailRow label="Tiempo inferencia"  value={`${result.tiempo_inferencia_ms} ms`} />
        <DetailRow label="Estado"             value="PENDIENTE — En cola para atención" />
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

    </ScrollView>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

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
  },
  map: {
    width: "100%",
    height: 200,
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
  cardLabel: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 4,
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
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
})
