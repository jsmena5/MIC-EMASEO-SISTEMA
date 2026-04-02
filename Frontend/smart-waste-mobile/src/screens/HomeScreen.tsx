import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React from "react"
import { Text, View } from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "Home">

export default function HomeScreen({ navigation }: Props) {
  return (
    <View style={globalStyles.container}>
      <Text style={globalStyles.title}>
        Bienvenido a EMASEO 🚛
      </Text>
    </View>
  )
}