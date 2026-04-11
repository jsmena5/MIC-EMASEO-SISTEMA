import { CameraView, useCameraPermissions } from "expo-camera"
import React, { useRef, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"

import { validateImage } from "../services/image.service"

export default function ScanScreen() {

  const [permission, requestPermission] = useCameraPermissions()
  const [isValid, setIsValid] = useState(false)
  const [loading, setLoading] = useState(false)

  const cameraRef = useRef<any>(null)

  if (!permission) {
    return <Text>Cargando permisos...</Text>
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text>Necesitamos acceso a la cámara</Text>
        <TouchableOpacity onPress={requestPermission}>
          <Text>Dar permiso</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const takePicture = async () => {
    if (!cameraRef.current) return

    try {
      setLoading(true)

      const photo = await cameraRef.current.takePictureAsync({
        base64: true
      })

      const data = await validateImage(photo.base64!)

      setIsValid(data.valid)

    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={{ flex: 1 }}>

      {/* NUEVA CÁMARA */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
      >

        {/*  MARCO */}
        <View style={styles.overlay}>
          <View
            style={[
              styles.frame,
              { borderColor: isValid ? "green" : "red" }
            ]}
          />
        </View>

      </CameraView>

      {/* BOTÓN */}
      <TouchableOpacity
        style={styles.button}
        onPress={takePicture}
      >
        <Text style={styles.text}>
          {loading ? "Procesando..." : "📷 Tomar Foto"}
        </Text>
      </TouchableOpacity>

    </View>
  )
}

const styles = StyleSheet.create({
  camera: {
    flex: 1
  },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },
  frame: {
    width: 250,
    height: 250,
    borderWidth: 4,
    borderRadius: 10
  },
  button: {
    backgroundColor: "#00A859",
    padding: 15,
    alignItems: "center"
  },
  text: {
    color: "#fff",
    fontWeight: "bold"
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  }
})