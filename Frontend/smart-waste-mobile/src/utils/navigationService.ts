import { createNavigationContainerRef } from "@react-navigation/native"

// Ref global al NavigationContainer.
// Tipado con `any` para evitar importar RootStackParamList y crear
// una dependencia circular: api.ts → AppNavigator.tsx → screens → services → api.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const navigationRef = createNavigationContainerRef<any>()
