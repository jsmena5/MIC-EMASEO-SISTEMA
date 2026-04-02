import { StyleSheet } from "react-native"
import { colors } from "./colors"

export const globalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 20
  },

  card: {
    width: "100%",
    backgroundColor: colors.white,
    padding: 20,
    borderRadius: 12
  },

  title: {
    fontSize: 26,
    fontWeight: "bold",
    color: colors.primary,
    marginBottom: 10
  },

  input: {
    width: "100%",
    height: 50,
    borderWidth: 1,
    borderColor: colors.lightGray,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 12
  },

  button: {
    backgroundColor: colors.secondary,
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10
  },

  buttonText: {
    color: colors.white,
    fontWeight: "bold"
  }
})