import { Dimensions, StyleSheet } from "react-native"

const { width } = Dimensions.get("window")

export const colors = {
  primary: "#1E3A8A",
  secondary: "#2563EB",
  background: "#F4F6F9",
  white: "#FFFFFF",
  black: "#000000",
  gray: "#6B7280",
  success: "#16A34A"
}

export const globalStyles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },

  card: {
    width: width * 0.9,
    backgroundColor: colors.white,
    padding: 25,
    borderRadius: 12,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    alignItems: "center"
  },

  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: colors.primary,
    marginBottom: 10
  },

  subtitle: {
    fontSize: 16,
    color: colors.gray,
    textAlign: "center",
    marginBottom: 20
  },

  successText: {
    fontSize: 18,
    color: colors.success,
    marginBottom: 10,
    textAlign: "center"
  },

  input: {
    width: "100%",
    height: 50,
    borderColor: "#D1D5DB",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    marginBottom: 15,
    backgroundColor: colors.white
  },

  primaryButton: {
    width: "100%",
    height: 50,
    backgroundColor: colors.secondary,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10
  },

  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "bold"
  },

  secondaryButton: {
    width: "100%",
    height: 50,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10
  },

  secondaryButtonText: {
    color: colors.secondary,
    fontSize: 16,
    fontWeight: "bold"
  }

})