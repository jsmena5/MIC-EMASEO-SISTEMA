import AsyncStorage from "@react-native-async-storage/async-storage"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { jwtDecode } from "jwt-decode"
import React, { useEffect, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"

import { RootStackParamList } from "../navigation/AppNavigator"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "Home">

export default function HomeScreen({ navigation }: Props) {

  const [role, setRole] = useState("")

  useEffect(() => {
    const loadUser = async () => {
      const token = await AsyncStorage.getItem("token")

      if (token) {
        const decoded: any = jwtDecode(token)
        setRole(decoded.rol)
        
      }
    }

    loadUser()
  }, [])

  const handleLogout = async () => {
    await AsyncStorage.removeItem("token")
    navigation.navigate("Login")
  }

  return (
    <View style={globalStyles.container}>

      <Text style={globalStyles.title}>
        Bienvenido a EMASEO 🚛
      </Text>

      {/* CAJA DE ROL */}
      <View style={styles.roleBox}>
        <Text style={styles.roleText}>
          Bienvenido {role || "usuario"}
        </Text>
      </View>

      {/* BOTONES */}
      <TouchableOpacity 
  style={styles.button}
  onPress={() => navigation.navigate("Scan")}
>
  <Text style={styles.buttonText}>📷 Escanear Acumulacion Basura</Text>
</TouchableOpacity>

      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>📜 Historial</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>🌱 Conciencia ambiental</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>📘 Manual de uso</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.buttonText}>🚪 Salir</Text>
      </TouchableOpacity>

    </View>
  )
}

const styles = StyleSheet.create({
  roleBox: {
    backgroundColor: "#E0F2FE",
    padding: 15,
    borderRadius: 10,
    marginVertical: 15,
    width: "100%",
    alignItems: "center"
  },
  roleText: {
    fontSize: 16,
    fontWeight: "bold"
  },
  button: {
    backgroundColor: "#00A859",
    padding: 15,
    borderRadius: 10,
    marginVertical: 8,
    width: "100%",
    alignItems: "center"
  },
  logoutButton: {
    backgroundColor: "#DC2626",
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
    width: "100%",
    alignItems: "center"
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold"
  }
})