import path from "node:path";

/**
 * Shared internal helper for uploading image file buffers to ImgBB.
 * Enforces file presence, non-empty buffer, and server configuration.
 */
export const uploadFileToImgBB = async (file) => {
  if (!file) {
    const error = new Error("Image file is required");
    error.statusCode = 400;
    throw error;
  }

  if (!file.buffer || file.buffer.length === 0) {
    const error = new Error("Uploaded image file is empty");
    error.statusCode = 400;
    throw error;
  }

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "your_imgbb_api_key") {
    const error = new Error("Server image upload configuration is missing");
    error.statusCode = 500;
    throw error;
  }

  // Prepare FormData payload for ImgBB API
  const formData = new FormData();
  formData.append("image", file.buffer.toString("base64"));

  if (file.originalname) {
    const baseName = path.parse(file.originalname).name;
    if (baseName) {
      formData.append("name", baseName);
    }
  }

  const uploadUrl = `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey.trim())}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(30000),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result || !result.success) {
    const errorMsg = result?.error?.message || `External upload failed with status ${response.status}`;
    console.error("[Upload Controller] ImgBB error:", errorMsg);
    const error = new Error(`Failed to upload image to external storage: ${errorMsg}`);
    error.statusCode = 502;
    throw error;
  }

  const imgData = result.data || {};

  return {
    url: imgData.url || "",
    displayUrl: imgData.display_url || imgData.url || "",
    deleteUrl: imgData.delete_url || null,
    thumbUrl: imgData.thumb?.url || null,
    title: imgData.title || "",
  };
};

/**
 * POST /api/uploads/service-image (Admin Only)
 * Uploads a service image to ImgBB and returns hosted URLs.
 */
export const uploadServiceImage = async (req, res, next) => {
  try {
    const data = await uploadFileToImgBB(req.file);
    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    console.error("[Upload Controller] Service image upload failed:", error.name, error.message);
    return res.status(isTimeout ? 504 : 502).json({
      success: false,
      message: isTimeout
        ? "Image upload request timed out"
        : "Failed to connect to external image upload service",
    });
  }
};

/**
 * POST /api/uploads/profile-image (Authenticated Customers & Administrators)
 * Uploads a user profile image to ImgBB and returns hosted URLs.
 */
export const uploadProfileImage = async (req, res, next) => {
  try {
    const data = await uploadFileToImgBB(req.file);
    return res.status(200).json({
      success: true,
      message: "Profile image uploaded successfully",
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    console.error("[Upload Controller] Profile image upload failed:", error.name, error.message);
    return res.status(isTimeout ? 504 : 502).json({
      success: false,
      message: isTimeout
        ? "Image upload request timed out"
        : "Failed to connect to external image upload service",
    });
  }
};

/**
 * POST /api/uploads/barber-image (Admin Only)
 * Uploads a barber profile image to ImgBB and returns hosted URLs.
 */
export const uploadBarberImage = async (req, res, next) => {
  try {
    const data = await uploadFileToImgBB(req.file);
    return res.status(200).json({
      success: true,
      message: "Barber image uploaded successfully",
      data,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    console.error("[Upload Controller] Barber image upload failed:", error.name, error.message);
    return res.status(isTimeout ? 504 : 502).json({
      success: false,
      message: isTimeout
        ? "Image upload request timed out"
        : "Failed to connect to external image upload service",
    });
  }
};
