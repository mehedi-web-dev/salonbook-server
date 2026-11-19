import express from "express";
import { requireAdmin } from "../middleware/auth.js";
import { handleImageUpload } from "../middleware/upload.js";
import { uploadServiceImage } from "../controllers/uploadController.js";

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

export default router;
