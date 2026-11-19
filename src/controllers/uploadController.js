import path from "node:path";

/**
 * Controller for handling image uploads to ImgBB
 * POST /api/uploads/service-image
 */
export const uploadServiceImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image file is required",
      });
    }

    if (!req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Uploaded image file is empty",
      });
    }

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey || apiKey.trim() === "" || apiKey === "your_imgbb_api_key") {
      return res.status(500).json({
        success: false,
        message: "Server image upload configuration is missing",
      });
    }

    // Prepare FormData payload for ImgBB API
    const formData = new FormData();
    formData.append("image", req.file.buffer.toString("base64"));

    if (req.file.originalname) {
      const baseName = path.parse(req.file.originalname).name;
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
      return res.status(502).json({
        success: false,
        message: `Failed to upload image to external storage: ${errorMsg}`,
      });
    }

    const imgData = result.data || {};

    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      data: {
        url: imgData.url || "",
        displayUrl: imgData.display_url || imgData.url || "",
        deleteUrl: imgData.delete_url || null,
        thumbUrl: imgData.thumb?.url || null,
        title: imgData.title || "",
      },
    });
  } catch (error) {
    const isTimeout = error.name === "TimeoutError" || error.name === "AbortError";
    console.error("[Upload Controller] Upload failed:", error.name, error.message);
    return res.status(isTimeout ? 504 : 502).json({
      success: false,
      message: isTimeout
        ? "Image upload request timed out"
        : "Failed to connect to external image upload service",
    });
  }
};
