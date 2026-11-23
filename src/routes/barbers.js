import express from "express";
import {
  getBarbers,
  getBarberById,
  createBarber,
  updateBarber,
  updateBarberStatus,
  deleteBarber,
} from "../controllers/barberController.js";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { handleImageUpload } from "../middleware/upload.js";

const router = express.Router();

/**
 * Public Routes
 * Use authenticateUser to optionally resolve requester session:
 * - Public/Customer: only retrieves active barbers (inactive returns 404).
 * - Admin: allows retrieving and inspecting inactive barbers when requested.
 */
router.get("/", authenticateUser, getBarbers);
router.get("/:id", authenticateUser, getBarberById);

/**
 * Admin-Only Management Routes
 * Enforces verified admin session via requireAdmin.
 * Supports image file uploads via handleImageUpload or JSON payloads.
 */
router.post("/", requireAdmin, handleImageUpload, createBarber);
router.patch("/:id", requireAdmin, handleImageUpload, updateBarber);
router.patch("/:id/status", requireAdmin, updateBarberStatus);
router.delete("/:id", requireAdmin, deleteBarber);

export default router;
