// src/components/ProgressBar.tsx
import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { colors } from "../theme/colors"

interface Props {
  currentStep: number
  totalSteps: number
}

export default function ProgressBar({ currentStep, totalSteps }: Props) {
  return (
    <View
      style={styles.wrapper}
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityLabel={`Paso ${currentStep} de ${totalSteps}`}
      accessibilityValue={{ min: 1, max: totalSteps, now: currentStep }}
    >
      <View style={styles.track} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: totalSteps }, (_, i) => (
          <React.Fragment key={i}>
            <View
              style={[
                styles.segment,
                i < currentStep ? styles.filled : styles.empty,
              ]}
            />
            {i < totalSteps - 1 && <View style={styles.gap} />}
          </React.Fragment>
        ))}
      </View>
      <Text style={styles.label}>
        Paso {currentStep} de {totalSteps}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 20,
  },
  track: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 6,
  },
  segment: {
    flex: 1,
    borderRadius: 3,
  },
  gap: {
    width: 4,
  },
  filled: {
    backgroundColor: colors.primary,
  },
  empty: {
    backgroundColor: colors.lightGray,
  },
  label: {
    fontSize: 12,
    color: colors.gray,
    textAlign: "center",
    fontWeight: "500",
  },
})
