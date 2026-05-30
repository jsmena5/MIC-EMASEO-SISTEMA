/**
 * Configuración de Babel para Expo SDK 54.
 *
 * IMPORTANTE — orden de plugins de worklets (no reordenar a la ligera):
 *
 *   1. `react-native-worklets-core/plugin`  → lo añadimos AQUÍ (plugins de config
 *      corren ANTES que los del preset). Es OBLIGATORIO para que los frame
 *      processors de react-native-vision-camera v4 funcionen: transforma las
 *      funciones marcadas con la directiva `'worklet'` (p. ej. el hook
 *      useLiveDistanceGuidance) al runtime C++ de worklets-core que VisionCamera
 *      usa para leer píxeles del frame en tiempo real.
 *
 *   2. `react-native-worklets/plugin` (reanimated 4) → lo inyecta
 *      `babel-preset-expo` automáticamente como ÚLTIMO plugin cuando detecta
 *      `react-native-worklets` instalado. NO hay que añadirlo a mano (duplicarlo
 *      rompe el build). Maneja los worklets de reanimated (animaciones).
 *
 * Sin este archivo, VisionCamera no encuentra el plugin de worklets-core y el
 * frame processor nunca se ejecuta → la guía de distancia queda congelada.
 *
 * Tras tocar este archivo hay que limpiar caché de Metro (`expo start -c`) o
 * recompilar el APK; un OTA solo no basta para cambios de transformación nativa.
 */
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-worklets-core/plugin"],
  }
}
