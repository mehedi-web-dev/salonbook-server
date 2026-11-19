import express from "express";
import { requireCustomer, requireAdmin } from "../middleware/auth.js";
import {
  createAppointment,
  getMyAppointments,
  getMyAppointmentById,
  cancelMyAppointment,
  getAllAppointments,
  getAppointmentById,
  updateAppointmentStatus,
} from "../controllers/appointmentController.js";

const router = express.Router();

// ==========================================
// Customer Routes (Authenticated Customers)
// ==========================================

/**
 * POST /api/appointments
 * Only authenticated customers can create appointments.
 * Identity is derived from session; service price fetched from DB.
 */
router.post("/", requireCustomer, createAppointment);

/**
 * GET /api/appointments/my
 * Returns paginated appointments for the authenticated customer.
 */
router.get("/my", requireCustomer, getMyAppointments);

/**
 * GET /api/appointments/my/:id
 * Returns a specific appointment belonging to the authenticated customer.
 */
router.get("/my/:id", requireCustomer, getMyAppointmentById);

/**
 * PATCH /api/appointments/my/:id/cancel
 * Cancels a pending appointment belonging to the authenticated customer.
 */
router.patch("/my/:id/cancel", requireCustomer, cancelMyAppointment);

// ==========================================
// Admin Routes (Authenticated Administrators)
// ==========================================

/**
 * GET /api/appointments
 * Returns all salon appointments with pagination and filtering.
 */
router.get("/", requireAdmin, getAllAppointments);

/**
 * GET /api/appointments/:id
 * Returns a single appointment with full service and customer information.
 */
router.get("/:id", requireAdmin, getAppointmentById);

/**
 * PATCH /api/appointments/:id/status
 * Updates appointment status to 'confirmed' or 'cancelled'.
 */
router.patch("/:id/status", requireAdmin, updateAppointmentStatus);

export default router;
