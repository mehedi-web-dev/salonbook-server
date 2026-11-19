import express from "express";
import { requireCustomer } from "../middleware/auth.js";
import {
  createCheckoutSession,
  getMyPayments,
  getMyPaymentById,
} from "../controllers/paymentController.js";

const router = express.Router();

/**
 * POST /api/payments/create-checkout-session
 * Authenticated customers only.
 * Creates a Stripe Checkout session for an active, confirmed, unpaid appointment.
 */
router.post("/create-checkout-session", requireCustomer, createCheckoutSession);

/**
 * GET /api/payments/my
 * Authenticated customers only.
 * Retrieves paginated payment history for the current customer.
 */
router.get("/my", requireCustomer, getMyPayments);

/**
 * GET /api/payments/my/:id
 * Authenticated customers only.
 * Retrieves specific payment details for the current customer.
 */
router.get("/my/:id", requireCustomer, getMyPaymentById);

export default router;
