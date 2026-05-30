import api from "../utils/api"
import { toPublicMediaUrl } from "../utils/mediaUrl"
import type {
  AnalysisIncidentEstado,
  DistanceHint,
  IncidentEstado,
  NivelAcum,
  Prioridad,
} from "../types/incident"

export type { DistanceHint }

export type { AnalysisIncidentEstado, IncidentEstado }


export const validateImage = async (imageBase64: string) => {
  try {
    const res = await api.post("/image/validate-image", { image: imageBase64 })
    return res.data
  } catch (error) {
    if (__DEV__) console.warn("[image.service] Error validando imagen:", error)
    throw error
  }
}

export interface AnalysisResult {
  incident_id: string
  task_id?: string
  estado: AnalysisIncidentEstado
  prioridad: Prioridad
  nivel_acumulacion: NivelAcum
  volumen_estimado_m3: number
  tipo_residuo: string
  confianza: number
  num_detecciones: number
  tiempo_inferencia_ms: number
  coverage_ratio?: number
  scale_penalty_applied?: boolean
  zona_id?: string | null
}

// Discriminated union for GET /image/status/:taskId responses
export type TaskStatusResponse =
  | { task_id: string; estado: "PROCESANDO"; message: string }
  | { task_id: string; estado: "FALLIDO";    message: string; nota_fallo: string | null }
  | { task_id: string; estado: "DESCARTADO"; message?: string; decision_automatica?: string | null }
  | (AnalysisResult & { task_id: string })

// Immediate 202 response from POST /image/analyze
export interface AnalyzeAccepted {
  task_id: string
  estado: "PROCESANDO"
  message: string
  poll_url: string
}

export interface WaitForAnalysisOptions {
  intervalMs?: number
  timeoutMs?: number
  signal?: AbortSignal
  onStatus?: (status: TaskStatusResponse) => void
}

export class TaskAnalysisFailedError extends Error {
  constructor(
    public readonly taskId: string,
    message: string,
  ) {
    super(message)
    this.name = "TaskAnalysisFailedError"
  }
}

export class TaskAnalysisTimeoutError extends Error {
  constructor(public readonly taskId: string) {
    super("El analisis no termino dentro del tiempo esperado.")
    this.name = "TaskAnalysisTimeoutError"
  }
}

// El mobile siempre recibe `prioridad` con valor (la API la garantiza para incidentes
// del ciudadano). `tipo_residuo` queda como string libre por compat con la API.
export type Incident = Omit<
  import("../types/incident").IncidentBase,
  "tipo_residuo" | "prioridad"
> & {
  tipo_residuo: string | null
  prioridad: Prioridad
}

export const getMyIncidents = async (): Promise<Incident[]> => {
  const res = await api.get("/incidents/me")
  const incidents: Incident[] = res.data.incidents
  return incidents.map((inc) => ({
    ...inc,
    image_url: toPublicMediaUrl(inc.image_url),
  }))
}

// Submits the image and returns immediately with a task_id (HTTP 202).
// The caller is responsible for polling getTaskStatus until done.
export const analyzeImage = async (
  imageBase64: string,
  latitude: number,
  longitude: number,
  descripcion?: string,
  options?: {
    signal?: AbortSignal
    onUploadProgress?: (percentage: number) => void
    ubicacion_aproximada?: boolean
    clientCoverageRatio?: number
  }
): Promise<AnalyzeAccepted> => {
  const body: Record<string, unknown> = {
    image: imageBase64,
    latitude,
    longitude,
    descripcion: descripcion ?? "",
    ubicacion_aproximada: options?.ubicacion_aproximada ?? false,
  }
  if (options?.clientCoverageRatio !== undefined) {
    body.client_coverage_ratio = options.clientCoverageRatio
  }
  const res = await api.post(
    "/image/analyze",
    body,
    {
      signal: options?.signal,
      onUploadProgress: options?.onUploadProgress
        ? (e) => {
            // e.loaded can exceed e.total in React Native (HTTP headers are counted
            // in loaded but not in total). Clamp to 100 to avoid > 100% display.
            const pct = e.total
              ? Math.min(100, Math.round((e.loaded / e.total) * 100))
              : 0
            options.onUploadProgress!(pct)
          }
        : undefined,
    }
  )
  return res.data as AnalyzeAccepted
}

// Single poll of GET /image/status/:taskId.
// Returns PROCESANDO while the ML pipeline runs, FALLIDO on error,
// or a full AnalysisResult when the incident is created.
export const getTaskStatus = async (
  taskId: string,
  options?: { signal?: AbortSignal },
): Promise<TaskStatusResponse> => {
  const res = await api.get(`/image/status/${taskId}`, { signal: options?.signal })
  return res.data as TaskStatusResponse
}

// ─── Pre-check de basura ──────────────────────────────────────────────────────

export interface PreCheckResult {
  garbage_score: number
  is_garbage:    boolean
  threshold:     number
  /** Solo presente cuando guidance_mode=true en el request. */
  coverage_ratio?: number
  /** Solo presente cuando guidance_mode=true en el request. */
  distance_hint?:  DistanceHint
}

/**
 * Envía un thumbnail pequeño (~15 KB, 320 px de ancho) al endpoint /ml/pre-check
 * para detectar si la imagen tiene aspecto de basura ANTES de correr YOLO.
 *
 * Con guidanceMode=true devuelve también coverage_ratio y distance_hint.
 *
 * Fail-closed: si el pre-check falla (red, timeout, server error) propaga el
 * error y el caller decide. NO devuelve un resultado optimista que dejaría
 * pasar reportes inválidos cuando la red es inestable.
 */
export async function preCheckImage(
  thumbnailBase64: string,
  opts?: { guidanceMode?: boolean },
): Promise<PreCheckResult> {
  const body: Record<string, unknown> = { image_base64: thumbnailBase64 }
  if (opts?.guidanceMode) body.guidance_mode = true
  const { data } = await api.post<PreCheckResult>("/ml/pre-check", body, { timeout: 12_000 })
  return data
}

const createCanceledError = () =>
  Object.assign(new Error("Analisis cancelado."), { code: "ERR_CANCELED" })

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCanceledError())
      return
    }

    const onAbort = () => {
      clearTimeout(timeout)
      reject(createCanceledError())
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort)
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    signal?.addEventListener("abort", onAbort, { once: true })
  })

export const waitForAnalysisResult = async (
  taskId: string,
  options: WaitForAnalysisOptions = {},
): Promise<AnalysisResult> => {
  const intervalMs = options.intervalMs ?? 2000
  const timeoutMs = options.timeoutMs ?? 120000
  const startedAt = Date.now()

  while (true) {
    const status = await getTaskStatus(taskId, { signal: options.signal })
    options.onStatus?.(status)

    if (status.estado === "FALLIDO") {
      throw new TaskAnalysisFailedError(taskId, status.message)
    }

    if (status.estado === "DESCARTADO" || status.estado !== "PROCESANDO") {
      return status as AnalysisResult & { task_id: string }
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new TaskAnalysisTimeoutError(taskId)
    }

    await wait(intervalMs, options.signal)
  }
}
