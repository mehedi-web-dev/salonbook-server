import express from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { handleImageUpload } from "../middleware/upload.js";
import { uploadServiceImage, uploadProfileImage } from "../controllers/uploadController.js";

const router = express.Router();

/**
 * Admin-Only Image Upload Route
 * POST /api/uploads/service-image
 *
 * 1. requireAdmin: Rejects unauthenticated requests (401) and non-admin requests (403)
 * 2. handleImageUpload: Validates multipart/form-data payload, file format (JPEG/PNG/WebP), and size (<=5MB)
 * 3. uploadServiceImage: Uploads file buffer to ImgBB and returns hosted URLs
 */
router.post(
  "/service-image",
  requireAdmin,
  handleImageUpload,
  uploadServiceImage
);

/**
 * Authenticated User Profile Image Upload Route
 * POST /api/uploads/profile-image
 *
 * 1. requireAuth: Rejects unauthenticated requests (401) and blocked accounts (403)
 * 2. handleImageUpload: Validates multipart/form-data payload, file format (JPEG/PNG/WebP), and size (<=5MB)
 * 3. uploadProfileImage: Uploads file buffer to ImgBB and returns hosted URLs
 */
router.post(
  "/profile-image",
  requireAuth,
  handleImageUpload,
  uploadProfileImage
);

export default router;
