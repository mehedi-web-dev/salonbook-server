import express from "express";
import {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  updateServiceStatus,
  deleteService,
} from "../controllers/serviceController.js";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

/**
 * Public Routes
 * Use authenticateUser to optionally resolve requester session:
 * - Public/Customer: only retrieves active services (inactive returns 404).
 * - Admin: allows retrieving and inspecting inactive services when requested.
 */
router.get("/", authenticateUser, getAllServices);
router.get("/:id", authenticateUser, getServiceById);

/**
 * Admin-Only Management Routes
 * Enforces verified admin session via requireAdmin.
 */
router.post("/", requireAdmin, createService);
router.patch("/:id", requireAdmin, updateService);
router.patch("/:id/status", requireAdmin, updateServiceStatus);
router.delete("/:id", requireAdmin, deleteService);

export default router;
