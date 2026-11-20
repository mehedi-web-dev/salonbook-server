import { ObjectId } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";
import { auth, checkAndPromoteAdmin } from "../config/auth.js";
import { db, connectDB } from "../config/db.js";

/**
 * Helper to generate a flexible query filter matching user ID by ObjectId or string.
 */
const getUserFilter = (userId) => {
  return ObjectId.isValid(userId)
    ? { $or: [{ _id: new ObjectId(userId) }, { _id: userId }] }
    : { _id: userId };
};

/**
 * Cryptographically verifies a JWT access token using the official Better Auth API.
 * Returns the verification result with payload if valid, or null if invalid or expired.
 * Never logs the raw token string.
 */
export const verifyJWTToken = async (token) => {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    return null;
  }

  try {
    const result = await auth.api.verifyJWT({
      body: { token: token.trim() },
    });

    if (result?.payload && result.payload.sub) {
      return result;
    }
    return null;
  } catch (error) {
    console.error("[Auth Middleware] JWT verification failed:", error.name, error.message);
    return null;
  }
};

/**
 * Resolves user identity from a Bearer Authorization header.
 * Enforces cryptographic verification, database record presence, admin promotion, and suspension status.
 */
const resolveBearerAuth = async (authHeader) => {
  if (!authHeader || typeof authHeader !== "string") {
    return {
      error: {
        status: 401,
        message: "Unauthorized: Invalid authorization header format",
      },
    };
  }

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return {
      error: {
        status: 401,
        message: "Unauthorized: Authorization scheme must be Bearer",
      },
    };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return {
      error: {
        status: 401,
        message: "Unauthorized: Invalid authorization token",
      },
    };
  }

  const verified = await verifyJWTToken(token);
  if (!verified || !verified.payload || !verified.payload.sub) {
    return {
      error: {
        status: 401,
        message: "Unauthorized: Invalid or expired token",
      },
    };
  }

  await connectDB();
  const user = await db.collection("user").findOne(getUserFilter(verified.payload.sub));

  if (!user) {
    return {
      error: {
        status: 401,
        message: "Unauthorized: User account not found",
      },
    };
  }

  await checkAndPromoteAdmin(user);

  if (user.isBlocked) {
    return {
      error: {
        status: 403,
        message: "Forbidden: Account is suspended",
      },
    };
  }

  const reqUser = {
    id: user._id ? user._id.toString() : user.id,
    _id: user._id,
    email: user.email,
    name: user.name || "",
    role: user.role || "customer",
    isBlocked: Boolean(user.isBlocked),
    phone: user.phone || null,
    image: user.image || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  return { user: reqUser, authType: "jwt" };
};

/**
 * Resolves user identity and populates req.user if a valid token or session exists.
 * Non-blocking: unauthenticated requests still proceed (req.user remains undefined).
 * If an explicit Bearer header is supplied, it must be valid or access is rejected with 401.
 */
export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (authHeader) {
      const result = await resolveBearerAuth(authHeader);
      if (result.error) {
        return res.status(result.error.status).json({
          success: false,
          message: result.error.message,
        });
      }

      req.user = result.user;
      req.authType = result.authType;
      return next();
    }

    // No Bearer header supplied -> Optional session cookie resolution
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session?.user) {
      await checkAndPromoteAdmin(session.user);

      if (session.user.isBlocked) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: Account is suspended",
        });
      }

      req.user = session.user;
      req.session = session.session;
      req.authType = "session";
    }

    return next();
  } catch (error) {
    console.error("[Auth Middleware] Session resolution error:", error.name, error.message);
    return next();
  }
};

/**
 * Enforces that a valid, active authentication exists (Bearer JWT or Cookie Session)
 * and the user is not suspended.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (authHeader) {
      const result = await resolveBearerAuth(authHeader);
      if (result.error) {
        return res.status(result.error.status).json({
          success: false,
          message: result.error.message,
        });
      }

      req.user = result.user;
      req.authType = result.authType;
      return next();
    }

    // No Bearer header supplied -> Cookie session verification
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Active session or valid token required",
      });
    }

    await checkAndPromoteAdmin(session.user);

    if (session.user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Account is suspended",
      });
    }

    req.user = session.user;
    req.session = session.session;
    req.authType = "session";
    return next();
  } catch (error) {
    console.error("[Auth Middleware] Authentication check failed:", error.name, error.message);
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Failed to verify authentication",
    });
  }
};

/**
 * Enforces that the authenticated user has the authoritative 'admin' role.
 */
export const requireAdmin = async (req, res, next) => {
  return requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Administrative access required",
      });
    }
    next();
  });
};

/**
 * Enforces that the authenticated user has the authoritative 'customer' role.
 */
export const requireCustomer = async (req, res, next) => {
  return requireAuth(req, res, () => {
    if (req.user?.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Customer access required",
      });
    }
    next();
  });
};
