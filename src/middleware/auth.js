import { fromNodeHeaders } from "better-auth/node";
import { auth, checkAndPromoteAdmin } from "../config/auth.js";

/**
 * Resolves session and populates req.user and req.session if a valid session exists.
 * Non-blocking: unauthenticated requests still proceed.
 */
export const authenticateUser = async (req, res, next) => {
  try {
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
    }

    next();
  } catch (error) {
    console.error("[Auth Middleware] Session resolution error:", error.message);
    next();
  }
};

/**
 * Enforces that a valid, active session exists and user is not blocked.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Active session required",
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
    next();
  } catch (error) {
    console.error("[Auth Middleware] Authentication check failed:", error.message);
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Failed to verify session",
    });
  }
};

/**
 * Enforces that the user has the 'admin' role.
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
 * Enforces that the user has the 'customer' role.
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
