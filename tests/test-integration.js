/**
 * test-integration.js — Prueba de integración: Reporte de incidente con IA
 *
 * Requisitos:
 *   - Node.js 18+  (fetch nativo)
 *   - Una imagen de prueba en: test.jpg  (en la misma carpeta que este archivo)
 *   - Todos los servicios corriendo:
 *       Gateway     → puerto 4000
 *       Image svc   → puerto 5000
 *       ML service  → puerto 8000  (uvicorn main:app --port 8000)
 *
 * Cómo obtener el JWT_TOKEN (usuario de prueba del seed):
 *   curl -s -X POST http://localhost:4000/api/auth/login \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"ana.ciudadana@gmail.com","password":"Test1234!"}' \
 *     | python3 -c "import sys,json; print(json.load(sys.stdin).get('token','SIN TOKEN'))"
 *
 * Uso:
 *   node test-integration.js
 */

import fs   from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const GATEWAY_URL = "http://localhost:4000"
// Obtén el token con el comando indicado en el encabezado de este archivo,
// luego expórtalo: export JWT_TOKEN="<token>" antes de ejecutar el script.
const JWT_TOKEN   = process.env.JWT_TOKEN ?? "PEGA_AQUI_TU_TOKEN_JWT"
const IMAGE_PATH  = path.join(__dirname, "basura.jpg")

// Coordenadas de prueba (Quito — Sector La Mariscal)
const LATITUDE  = -0.180653
const LONGITUDE = -78.467838
// ─────────────────────────────────────────────────────────────────────────────

function hr(char = "─", n = 60) { return char.repeat(n) }

const ML_URL = "http://localhost:8000"

// ─── Helpers de aserción ──────────────────────────────────────────────────────
function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ ASSERTION FAILED: ${message}`)
    process.exit(1)
  }
  console.log(`  ✓ ${message}`)
}

// ─── Test de guidance pre-check ───────────────────────────────────────────────
async function testGuidancePreCheck(imageBase64) {
  console.log("\n" + hr())
  console.log("  [Guidance] POST /ml/pre-check con guidance_mode=true")
  console.log(hr())

  const resp = await fetch(`${ML_URL}/pre-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64, guidance_mode: true }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await resp.json()

  assert(resp.status === 200, `HTTP 200 (got ${resp.status})`)
  assert(typeof data.garbage_score === "number", `garbage_score es número: ${data.garbage_score}`)
  assert(typeof data.is_garbage === "boolean", `is_garbage es boolean: ${data.is_garbage}`)
  assert(typeof data.threshold === "number", `threshold es número: ${data.threshold}`)
  assert(typeof data.coverage_ratio === "number", `coverage_ratio presente: ${data.coverage_ratio}`)
  assert(data.coverage_ratio >= 0 && data.coverage_ratio <= 1, `coverage_ratio en [0,1]: ${data.coverage_ratio}`)
  assert(["TOO_CLOSE", "OPTIMAL", "TOO_FAR"].includes(data.distance_hint),
    `distance_hint válido: ${data.distance_hint}`)

  console.log(`\n  coverage_ratio : ${data.coverage_ratio}`)
  console.log(`  distance_hint  : ${data.distance_hint}`)
}

// ─── Test de analyze con client_coverage_ratio ────────────────────────────────
async function testAnalyzeWithCoverage(imageBase64, jwtToken) {
  console.log("\n" + hr())
  console.log("  [Guidance] POST /api/image/analyze con client_coverage_ratio=0.45")
  console.log(hr())

  const resp = await fetch(`${GATEWAY_URL}/api/image/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwtToken}`,
    },
    body: JSON.stringify({
      image: imageBase64,
      latitude: LATITUDE,
      longitude: LONGITUDE,
      descripcion: "Test integración con coverage",
      client_coverage_ratio: 0.45,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await resp.json()

  assert(resp.status === 202, `HTTP 202 (got ${resp.status}: ${JSON.stringify(data)})`)
  assert(typeof data.task_id === "string" && data.task_id.length > 0,
    `task_id presente: ${data.task_id}`)
  assert(data.estado === "PROCESANDO", `estado=PROCESANDO: ${data.estado}`)

  console.log(`\n  task_id : ${data.task_id}`)
}

async function main() {
  console.log("\n" + hr("="))
  console.log("  Test de Integración — Flujo Reporte de Incidente con IA")
  console.log(hr("=") + "\n")

  // ── Paso 1: Leer imagen ────────────────────────────────────────────────────
  console.log(`[1/3] Leyendo imagen de prueba...`)
  console.log(`      Ruta: ${IMAGE_PATH}`)

  if (!fs.existsSync(IMAGE_PATH)) {
    console.error("\n  ERROR: No se encontró test.jpg")
    console.error("  Coloca una imagen JPG en la raíz del proyecto con ese nombre.")
    process.exit(1)
  }

  const imageBuffer = await fs.promises.readFile(IMAGE_PATH)
  const imageBase64 = imageBuffer.toString("base64")
  console.log(`      Tamaño original : ${(imageBuffer.length / 1024).toFixed(1)} KB`)
  console.log(`      Tamaño en Base64: ${(imageBase64.length / 1024).toFixed(1)} KB`)

  // ── Paso 2: Armar y enviar payload ────────────────────────────────────────
  const payload = {
    image:       imageBase64,
    latitude:    LATITUDE,
    longitude:   LONGITUDE,
    descripcion: "Prueba de integración automática — acumulación de residuos",
  }

  const payloadSizeKB = (JSON.stringify(payload).length / 1024).toFixed(1)
  console.log(`\n[2/3] Enviando POST ${GATEWAY_URL}/api/image/analyze`)
  console.log(`      Payload total : ${payloadSizeKB} KB`)
  console.log(`      Timeout       : 70 segundos (espera cold start del modelo)\n`)

  if (JWT_TOKEN === "PEGA_AQUI_TU_TOKEN_JWT") {
    console.warn("  ADVERTENCIA: JWT_TOKEN no configurado. El gateway responderá 401.")
    console.warn("  Edita la constante JWT_TOKEN al inicio del script.\n")
  }

  const t0 = Date.now()
  let response, data

  try {
    response = await fetch(`${GATEWAY_URL}/api/image/analyze`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${JWT_TOKEN}`,
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(70_000),
    })
    data = await response.json()
  } catch (err) {
    console.error(`\n  ERROR de red: ${err.message}`)
    console.error("  Verifica que el Gateway esté corriendo en el puerto 4000.")
    process.exit(1)
  }

  const elapsed = Date.now() - t0

  // ── Paso 3: Mostrar resultado ──────────────────────────────────────────────
  console.log(`[3/3] Respuesta recibida en ${elapsed} ms — HTTP ${response.status}`)
  console.log(hr())

  if (!response.ok) {
    console.error("  RESULTADO: FALLO")
    console.error(`  HTTP ${response.status}:`)
    console.error(JSON.stringify(data, null, 2))
    console.log(hr())
    diagnostico(response.status, data)
    process.exit(1)
  }

  // Éxito
  const confianzaPct = data.confianza != null
    ? `${(data.confianza * 100).toFixed(1)}%`
    : "N/A"

  console.log("  RESULTADO: ÉXITO ✓\n")
  console.log(`  incident_id       : ${data.incident_id}`)
  console.log(`  zona_id           : ${data.zona_id ?? "(sin zona asignada — punto fuera de polígonos)"}`)
  console.log(`  tipo_residuo      : ${data.tipo_residuo}`)
  console.log(`  nivel_acumulacion : ${data.nivel_acumulacion}`)
  console.log(`  prioridad         : ${data.prioridad}`)
  console.log(`  confianza         : ${confianzaPct}`)
  console.log(`  num_detecciones   : ${data.num_detecciones}`)
  console.log(`  coverage_ratio    : ${(data.coverage_ratio * 100).toFixed(1)}%`)
  console.log(`  volumen_estimado  : ${data.volumen_estimado_m3} m³`)
  console.log(`  tiempo_inferencia : ${data.tiempo_inferencia_ms} ms`)
  console.log(`  estado            : ${data.estado}`)
  console.log(hr())
  console.log("\n  Ejecuta esta consulta en DBeaver para verificar en la DB:")
  console.log(`\n  SELECT * FROM incidents.incidents i`)
  console.log(`  JOIN ai.analysis_results ar ON ar.incident_id = i.id`)
  console.log(`  WHERE i.id = '${data.incident_id}';\n`)

  // ── Nuevos tests de guidance ───────────────────────────────────────────────
  try {
    await testGuidancePreCheck(imageBase64)
  } catch (err) {
    console.error(`\n  ERROR en testGuidancePreCheck: ${err.message}`)
  }

  if (JWT_TOKEN !== "PEGA_AQUI_TU_TOKEN_JWT") {
    try {
      await testAnalyzeWithCoverage(imageBase64, JWT_TOKEN)
    } catch (err) {
      console.error(`\n  ERROR en testAnalyzeWithCoverage: ${err.message}`)
    }
  } else {
    console.log("\n  [Guidance] testAnalyzeWithCoverage omitido — JWT_TOKEN no configurado")
  }

  console.log("\n" + hr("="))
  console.log("  Todos los tests finalizados")
  console.log(hr("=") + "\n")
}

function diagnostico(status, data) {
  const msg = data?.error ?? data?.message ?? ""
  console.log("\n  Diagnóstico:")
  if (status === 401) {
    console.log("  → JWT inválido o expirado. Obtén un token fresco con POST /api/auth/login")
  } else if (status === 403) {
    console.log("  → El usuario no tiene rol CIUDADANO. Revisa requireCiudadano en el Gateway.")
  } else if (status === 503) {
    console.log("  → ML Service no disponible (puerto 8000).")
    console.log("    Inícialo con: uvicorn main:app --host 0.0.0.0 --port 8000")
    console.log("    Si el modelo .pt no existe, verifica ML/modelos/rtdetr_l_best.pt")
  } else if (status === 502) {
    console.log("  → El Gateway no pudo conectar con el Image Service (puerto 5000).")
  } else if (status === 500 && msg.includes("invalid input value for enum")) {
    console.log("  → tipo_residuo devuelto por el ML no coincide con ai.waste_type ENUM.")
    console.log("    Valores válidos: DOMESTICO, ORGANICO, RECICLABLE, ESCOMBROS, PELIGROSO, MIXTO, OTRO")
  } else {
    console.log(`  → ${msg || "Revisa los logs de cada servicio."}`)
  }
  console.log("")
}

main()
