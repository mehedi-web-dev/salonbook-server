import express from "express";
import { requireAdmin } from "../middleware/auth.js";
import {
  getUsers,
  getUserById,
  updateUserStatus,
  getAllTransactions,
  getTransactionById,
  getDashboardStats,
} from "../controllers/adminController.js";

const router = express.Router();

// Strict administrative access guard across all admin endpoints
router.use(requireAdmin);

// ==========================================
// Admin User Management Routes
// ==========================================

/**
 * GET /api/admin/users
 * Lists registered customers with pagination, search, and status filtering.
 */
router.get("/users", getUsers);

/**
 * GET /api/admin/users/:id
 * Retrieves detailed customer information by ID.
 */
router.get("/users/:id", getUserById);

/**
 * PATCH /api/admin/users/:id/status
 * Blocks or unblocks a customer account.
 */
router.patch("/users/:id/status", updateUserStatus);

// ==========================================
// Admin Transaction Management Routes
// ==========================================

/**
 * GET /api/admin/transactions
 * Lists all transactions with pagination, status filtering, date range, and search.
 */
router.get("/transactions", getAllTransactions);

/**
 * GET /api/admin/transactions/:id
 * Retrieves full details for a single transaction.
 */
router.get("/transactions/:id", getTransactionById);

// ==========================================
// Admin Dashboard Statistics Route
// ==========================================

/**
 * GET /api/admin/dashboard/stats
 * Aggregates live system statistics for the Admin Dashboard.
 */
router.get("/dashboard/stats", getDashboardStats);

export default router;
