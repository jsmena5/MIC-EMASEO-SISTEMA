import { CameraView, useCameraPermissions } from "expo-camera"
import * as Location from "expo-location"
import React, { useEffect, useRef, useState } from "react"
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { analyzeImage } from "../services/image.service"
import type { RootStackParamList } from "../navigation/AppNavigator"

type ScanNavProp = NativeStackNavigationProp<RootStackParamList, "Scan">

export default function ScanScreen() {
  const navigation = useNavigation<ScanNavProp>()
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const [locationPermission, requestLocationPermission] = Location.useForegroundPermissions()
  const [loading, setLoading] = useState(false)
  const cameraRef = useRef<any>(null)

  useEffect(() => {
    requestLocationPermission()
  }, [])

  if (!cameraPermission) {
    return <Text>Cargando permisos...</Text>
  }

  if (!cameraPermission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Necesitamos acceso a la cámara</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestCameraPermission}>
          <Text style={styles.permissionButtonText}>Dar permiso de cámara</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const takePicture = async () => {
    if (!cameraRef.current) return

    try {
      setLoading(true)

      // 1. Verificar permiso de ubicación
      if (!locationPermission?.granted) {
        const perm = await requestLocationPermission()
        if (!perm.granted) {
          Alert.alert(
            "Ubicación requerida",
            "Necesitamos tu ubicación para registrar el lugar del incidente."
          )
          return
        }
      }

      // 2. Obtener coordenadas GPS
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })

      // 3. Tomar foto (quality: 0.7 reduce tamaño sin afectar la detección ML)
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.7,
      })

      // 4. Analizar imagen + crear incidente
      const result = await analyzeImage(
        photo.base64!,
        location.coords.latitude,
        location.coords.longitude
      )

      // 5. Navegar a pantalla de resultados
      navigation.navigate("ScanResult", { result })

    } catch (error: any) {
      console.error("[ScanScreen] Error:", error?.response?.data ?? error?.message ?? error)
      Alert.alert(
        "Error",
        error?.response?.data?.error ?? "No se pudo procesar la imagen. Intenta de nuevo."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        <View style={styles.overlay}>
          <View style={styles.frame} />
          <Text style={styles.hint}>Apunta al área con basura</Text>
        </View>
      </CameraView>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={takePicture}
        disabled={loading}
      >
        <Text style={styles.text}>
          {loading ? "Analizando..." : "📷 Tomar Foto y Analizar"}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  frame: {
    width: 280,
    height: 280,
    borderWidth: 3,
    borderColor: "#00A859",
    borderRadius: 12,
  },
  hint: {
    marginTop: 12,
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  button: {
    backgroundColor: "#00A859",
    padding: 18,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#6B7280",
  },
  text: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  permissionText: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: "#00A859",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },
})
