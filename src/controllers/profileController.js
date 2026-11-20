import { ObjectId } from "mongodb";
import { db, connectDB } from "../config/db.js";

/**
 * Helper to validate HTTP or HTTPS URL.
 */
const isValidHttpUrl = (urlString) => {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Helper to generate a flexible query filter matching user ID by ObjectId or string.
 */
const getUserFilter = (userId) => {
  return ObjectId.isValid(userId)
    ? { $or: [{ _id: new ObjectId(userId) }, { _id: userId }] }
    : { _id: userId };
};

/**
 * GET /api/profile/me (Authenticated Customers and Admins)
 * Retrieves the current authenticated user's profile information.
 * Excludes sensitive fields (passwords, tokens, secrets, sessions).
 */
export const getMyProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Active session required",
      });
    }

    await connectDB();
    const userCollection = db.collection("user");
    const user = await userCollection.findOne(getUserFilter(userId));

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: user._id.toString(),
        name: user.name || "",
        email: user.email || "",
        image: user.image || null,
        phone: user.phone || null,
        role: user.role || "customer",
        isBlocked: Boolean(user.isBlocked),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/profile/me (Authenticated Customers and Admins)
 * Updates the current authenticated user's permitted profile fields: name, image, phone.
 * Strict security:
 * - Rejects any attempt to modify role, isBlocked, email, emailVerified, password, or ID.
 * - Validates input types, lengths, and URL formats.
 * - Rejects empty update requests.
 */
export const updateMyProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Active session required",
      });
    }

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        success: false,
        message: "Request body must be a valid JSON object",
      });
    }

    // Protected fields that must never be updated via profile endpoint
    const FORBIDDEN_FIELDS = [
      "role",
      "isBlocked",
      "email",
      "emailVerified",
      "password",
      "passwordHash",
      "id",
      "_id",
      "createdAt",
      "updatedAt",
    ];

    for (const field of FORBIDDEN_FIELDS) {
      if (field in req.body) {
        return res.status(400).json({
          success: false,
          message: `Field '${field}' cannot be modified through profile updates`,
        });
      }
    }

    const $set = {};

    // Validate name
    if ("name" in req.body) {
      const { name } = req.body;
      if (typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Name must be a non-empty string",
        });
      }
      if (name.trim().length > 100) {
        return res.status(400).json({
          success: false,
          message: "Name cannot exceed 100 characters",
        });
      }
      $set.name = name.trim();
    }

    // Validate phone
    if ("phone" in req.body) {
      const { phone } = req.body;
      if (phone === null || phone === "") {
        $set.phone = null;
      } else if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Phone must be a valid string",
        });
      } else {
        const trimmedPhone = phone.trim();
        if (trimmedPhone.length < 3 || trimmedPhone.length > 30) {
          return res.status(400).json({
            success: false,
            message: "Phone must be between 3 and 30 characters",
          });
        }
        $set.phone = trimmedPhone;
      }
    }

    // Validate image URL
    if ("image" in req.body) {
      const { image } = req.body;
      if (image === null || image === "") {
        $set.image = null;
      } else if (typeof image !== "string") {
        return res.status(400).json({
          success: false,
          message: "Image must be a valid URL string",
        });
      } else {
        const trimmedImage = image.trim();
        if (!isValidHttpUrl(trimmedImage) || trimmedImage.length > 2048) {
          return res.status(400).json({
            success: false,
            message: "Image must be a valid HTTP or HTTPS URL",
          });
        }
        $set.image = trimmedImage;
      }
    }

    // Enforce that at least one permitted field was provided
    if (Object.keys($set).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No permitted fields provided for update. Allowed fields: name, image, phone",
      });
    }

    $set.updatedAt = new Date();

    await connectDB();
    const userCollection = db.collection("user");
    const filter = getUserFilter(userId);

    const updateResult = await userCollection.updateOne(filter, { $set });

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const updatedUser = await userCollection.findOne(filter);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: updatedUser._id.toString(),
        name: updatedUser.name || "",
        email: updatedUser.email || "",
        image: updatedUser.image || null,
        phone: updatedUser.phone || null,
        role: updatedUser.role || "customer",
        isBlocked: Boolean(updatedUser.isBlocked),
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
