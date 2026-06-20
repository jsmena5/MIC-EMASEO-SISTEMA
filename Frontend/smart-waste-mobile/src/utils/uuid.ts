/**
 * uuidv4 — genera un UUID v4 en JS puro (sin dependencia nativa).
 *
 * Se usa para la clave de idempotencia de los reportes: un identificador estable
 * por reporte que se reenvía en cada reintento para que el backend no cree
 * incidentes duplicados cuando la red está lenta (el POST hace timeout pero el
 * servidor sí lo recibió). NO requiere aleatoriedad criptográfica — solo basta
 * con que dos reportes distintos no colisionen, y Math.random es suficiente para
 * eso. Al ser JS puro, el cambio se puede entregar por OTA (sin recompilar).
 */
export function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
