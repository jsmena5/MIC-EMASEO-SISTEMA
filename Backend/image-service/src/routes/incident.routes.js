import { Router } from "express"
import { getMyIncidents } from "../services/image.service.js"
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notification.controller.js"

const router = Router()

router.get("/me", getMyIncidents)

// Notificaciones del ciudadano (orden importa: read-all antes de :id/read)
router.get("/notifications",           getNotifications)
router.put("/notifications/read-all",  markAllNotificationsRead)
router.put("/notifications/:id/read",  markNotificationRead)

export default router
