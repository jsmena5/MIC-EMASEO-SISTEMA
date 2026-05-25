import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  analyzeImage,
  TaskAnalysisFailedError,
  waitForAnalysisResult,
} from "./image.service"

const QUEUE_KEY = "pending_reports"

export interface PendingReport {
  id: string
  createdAt: string
  imageBase64: string
  latitude: number
  longitude: number
  descripcion?: string
  taskId?: string
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
): Promise<void> {
  const queue = await readQueue()
  queue.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    imageBase64,
    latitude,
    longitude,
    descripcion,
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
      let taskId = report.taskId

      if (!taskId) {
        const accepted = await analyzeImage(
          report.imageBase64,
          report.latitude,
          report.longitude,
          report.descripcion,
        )
        taskId = accepted.task_id

        workingQueue[0] = { ...report, taskId }
        await writeQueue(workingQueue)
      }

      await waitForAnalysisResult(taskId)
      workingQueue = workingQueue.slice(1)
      await writeQueue(workingQueue)
      succeeded++
    } catch (error) {
      failed++

      if (error instanceof TaskAnalysisFailedError) {
        workingQueue = workingQueue.slice(1)
      } else {
        const currentReport = workingQueue[0] ?? report
        workingQueue = [
          ...workingQueue.slice(1),
          { ...currentReport, retries: currentReport.retries + 1 },
        ]
      }

      await writeQueue(workingQueue)
    }
  }

  return { succeeded, failed, remaining: workingQueue.length }
}
