import pino from "pino"
import { randomUUID } from "crypto"

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: "users-service" },
})

export const childLogger = (req) =>
  logger.child({ requestId: req.headers["x-request-id"] ?? randomUUID() })
