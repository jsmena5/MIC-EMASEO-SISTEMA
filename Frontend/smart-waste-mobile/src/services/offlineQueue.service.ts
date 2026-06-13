import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  analyzeImage,
  TaskAnalysisFailedError,
  waitForAnalysisResult,
} from "./image.service"
import { uuidv4 } from "../utils/uuid"

const QUEUE_KEY = "pending_reports"

// Tope de reintentos de ENVÍO (analyzeImage) por reporte. Al superarlo se descarta
// de la cola para no dejar items atascados para siempre con thumbnail roto. Los
// reportes que sí llegaron al servidor (tienen taskId) NUNCA cuentan reintentos:
// se sacan de la cola y se ven en el Historial como "Procesando".
const MAX_QUEUE_RETRIES = 5

export interface PendingReport {
  id: string
  createdAt: string
  imageBase64: string
  latitude: number
  longitude: number
  descripcion?: string
  taskId?: string
  /** Clave de idempotencia estable: el servidor la usa para no duplicar el incidente en reintentos. */
  idempotencyKey?: string
  retries: number
}

export interface QueueProcessResult {
  succeeded: number
  failed: number
  remaining: number
}

async function readQueue(): Promise<PendingReport[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as PendingReport[]) : []
  } catch {
    return []
  }
}

async function writeQueue(queue: PendingReport[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function enqueuePendingReport(
  imageBase64: string,
  latitude: number,
  longitude: number,
  descripcion?: string,
  idempotencyKey?: string,
): Promise<void> {
  const queue = await readQueue()
  queue.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    imageBase64,
    latitude,
    longitude,
    descripcion,
    // Si el caller no provee una clave, generamos una aquí para que el reenvío
    // automático al recuperar conexión tampoco pueda duplicar el incidente.
    idempotencyKey: idempotencyKey ?? uuidv4(),
    retries: 0,
  })
  await writeQueue(queue)
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue()
  return queue.length
}

/**
 * Retorna todos los reportes actualmente en la cola offline.
 * Siempre lee de AsyncStorage (no requiere red).
 */
export async function getPendingReports(): Promise<PendingReport[]> {
  return readQueue()
}

// Envía el reporte si aún no tiene taskId. Garantiza una idempotencyKey estable
// ANTES de enviar y persiste el taskId en la cola. Devuelve el taskId resultante.
// Muta workingQueue[0] en el sitio (igual que el flujo original) para que un fallo
// posterior vea el taskId ya guardado.
async function ensureReportSubmitted(
  workingQueue: PendingReport[],
  report: PendingReport,
): Promise<string> {
  if (report.taskId) return report.taskId

  let idempotencyKey = report.idempotencyKey
  if (!idempotencyKey) {
    idempotencyKey = uuidv4()
    workingQueue[0] = { ...report, idempotencyKey }
    await writeQueue(workingQueue)
  }

  const accepted = await analyzeImage(
    report.imageBase64,
    report.latitude,
    report.longitude,
    report.descripcion,
    { idempotencyKey },
  )
  workingQueue[0] = { ...workingQueue[0], taskId: accepted.task_id }
  await writeQueue(workingQueue)
  return accepted.task_id
}

// Decide el destino de un reporte cuyo procesamiento lanzó error. Devuelve la cola
// resultante y si debe contarse como enviado (succeeded) o fallido (failed).
function resolveQueueAfterError(
  error: unknown,
  workingQueue: PendingReport[],
  currentReport: PendingReport,
): { queue: PendingReport[]; sent: boolean } {
  // El servidor rechazó el análisis (FALLIDO) → no reintentar, descartar.
  if (error instanceof TaskAnalysisFailedError) {
    return { queue: workingQueue.slice(1), sent: false }
  }
  // Si ya hay taskId, el reporte SE ENVIÓ: el incidente existe en el servidor y
  // aparece en el Historial. NO re-subir la imagen — sacarlo de la cola como enviado.
  if (currentReport.taskId) {
    return { queue: workingQueue.slice(1), sent: true }
  }
  // Sin taskId ⇒ el envío falló por red. Reintentar con tope para no atascar el item.
  const nextRetries = currentReport.retries + 1
  const queue =
    nextRetries >= MAX_QUEUE_RETRIES
      ? workingQueue.slice(1)
      : [...workingQueue.slice(1), { ...currentReport, retries: nextRetries }]
  return { queue, sent: false }
}

export async function processQueue(
  onProgress?: (current: number, total: number) => void,
): Promise<QueueProcessResult> {
  const queue = await readQueue()
  if (queue.length === 0) return { succeeded: 0, failed: 0, remaining: 0 }

  const total = queue.length
  let succeeded = 0
  let failed = 0
  let workingQueue = [...queue]

  for (let i = 0; i < total; i++) {
    const report = workingQueue[0]
    if (!report) break

    onProgress?.(i + 1, total)

    try {
      const taskId = await ensureReportSubmitted(workingQueue, report)
      await waitForAnalysisResult(taskId)
      workingQueue = workingQueue.slice(1)
      await writeQueue(workingQueue)
      succeeded++
    } catch (error) {
      const currentReport = workingQueue[0] ?? report
      const { queue, sent } = resolveQueueAfterError(error, workingQueue, currentReport)
      workingQueue = queue
      if (sent) succeeded++
      else failed++
      await writeQueue(workingQueue)
    }
  }

  return { succeeded, failed, remaining: workingQueue.length }
}
