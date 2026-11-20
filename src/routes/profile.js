import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { getMyProfile, updateMyProfile } from "../controllers/profileController.js";

const router = express.Router();

// Strict session authentication required for all profile operations
router.use(requireAuth);

/**
 * GET /api/profile/me
 * Retrieves current authenticated user's safe profile.
 */
router.get("/me", getMyProfile);

/**
 * PATCH /api/profile/me
 * Updates permitted profile fields (name, image, phone) for authenticated user.
 */
router.patch("/me", updateMyProfile);

export default router;
