import api from "../utils/api"

export const validateImage = async (imageBase64: string) => {
  try {
    const res = await api.post("/image/validate-image", { image: imageBase64 })
    return res.data
  } catch (error) {
    console.error("Error validando imagen", error)
    throw error
  }
}

// Returned by GET /image/status/:taskId when the analysis succeeded
export type AnalysisIncidentEstado = "PENDIENTE" | "EN_ATENCION" | "RESUELTA" | "RECHAZADA"
export type IncidentEstado = AnalysisIncidentEstado | "PROCESANDO" | "FALLIDO"

export interface AnalysisResult {
  incident_id: string
  task_id?: string
  estado: AnalysisIncidentEstado
  prioridad: "BAJA" | "MEDIA" | "ALTA" | "CRITICA"
  nivel_acumulacion: "BAJO" | "MEDIO" | "ALTO" | "CRITICO"
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
  | { task_id: string; estado: "FALLIDO"; message: string }
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

export interface Incident {
  id: string
  estado: IncidentEstado
  prioridad: "BAJA" | "MEDIA" | "ALTA" | "CRITICA"
  descripcion: string | null
  created_at: string
  image_url: string | null
  nivel_acumulacion: "BAJO" | "MEDIO" | "ALTO" | "CRITICO" | null
  tipo_residuo: string | null
  confianza: number | null
  num_detecciones: number | null
  latitud?: number | null
  longitud?: number | null
}

export const getMyIncidents = async (): Promise<Incident[]> => {
  const res = await api.get("/incidents/me")
  return res.data.incidents
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
  }
): Promise<AnalyzeAccepted> => {
  const res = await api.post(
    "/image/analyze",
    { image: imageBase64, latitude, longitude, descripcion: descripcion ?? "" },
    {
      signal: options?.signal,
      onUploadProgress: options?.onUploadProgress
        ? (e) => {
            const pct = e.total ? Math.round((e.loaded / e.total) * 100) : 0
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

    if (status.estado !== "PROCESANDO") {
      return status
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new TaskAnalysisTimeoutError(taskId)
    }

    await wait(intervalMs, options.signal)
  }
}
