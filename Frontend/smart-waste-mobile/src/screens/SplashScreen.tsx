import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useEffect } from "react"
import { ActivityIndicator, Image, Text, View } from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "Splash">

export default function SplashScreen({ navigation }: Props) {


  useEffect(() => {
    setTimeout(() => {
      navigation.replace("Login")
    }, 2500)
  }, [])

  return (
    <View style={globalStyles.container}>

      <Image
        source={{ uri: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Logo_Quito.svg/512px-Logo_Quito.svg.png" }}
        style={{ width: 100, height: 100, marginBottom: 20 }}
      />

      <Text style={globalStyles.title}>
        Bienvenido a EMASEO EP
      </Text>

      <Text style={{ marginBottom: 20 }}>
        Sistema de recolección inteligente
      </Text>

      <ActivityIndicator size="large" color="#00A859" />

    </View>
  )
}