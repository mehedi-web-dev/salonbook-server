import multer from "multer";
import path from "node:path";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

// Multer memory storage keeps file buffer in memory without writing to disk
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();

  if (!ALLOWED_MIME_TYPES.has(mime) || !ALLOWED_EXTENSIONS.has(ext)) {
    const error = new Error("Invalid file type. Only JPEG, PNG, and WebP images are allowed");
    error.statusCode = 400;
    return cb(error, false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter,
});

/**
 * Express middleware that wraps multer single image upload.
 * Catches multer errors (size limit, invalid format) and responds with status 400.
 */
export const handleImageUpload = (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "Image size exceeds the 5MB limit",
          });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({
            success: false,
            message: "Unexpected field name. Expected 'image'",
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message,
        });
      }

      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message || "Failed to process image upload",
      });
    }

    next();
  });
};
