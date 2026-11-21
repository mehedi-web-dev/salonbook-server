import "dotenv/config";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";
import { client, db } from "./db.js";

const PRODUCTION_FRONTEND = "https://salonbook-virid.vercel.app";

const trustedOrigins = [
  PRODUCTION_FRONTEND,
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
];

if (process.env.CLIENT_URL && !trustedOrigins.includes(process.env.CLIENT_URL)) {
  trustedOrigins.push(process.env.CLIENT_URL);
}

const frontendOrigin = process.env.CLIENT_URL || PRODUCTION_FRONTEND;

/**
 * Idempotently checks and elevates user to admin role if matching ADMIN_EMAIL
 */
export const checkAndPromoteAdmin = async (user) => {
  if (!user || !user.email) return user;
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const userEmail = user.email.trim().toLowerCase();

  if (adminEmail && userEmail === adminEmail && user.role !== "admin") {
    const filter = user._id ? { _id: user._id } : { email: user.email };
    await db.collection("user").updateOne(
      filter,
      { $set: { role: "admin", updatedAt: new Date() } }
    );
    user.role = "admin";
  }
  return user;
};

/**
 * Safely resolves social providers configuration from environment variables.
 * Returns provider map and diagnostic status without exposing secrets.
 */
export const resolveGoogleProviderConfig = (env = process.env) => {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const isPlaceholderSecret =
    clientSecret === "your_google_client_secret" ||
    clientSecret === "your_client_secret";

  const isConfigured = Boolean(clientId && clientSecret && !isPlaceholderSecret);
  const missing = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  else if (isPlaceholderSecret) missing.push("GOOGLE_CLIENT_SECRET (placeholder detected)");

  return {
    isConfigured,
    missing,
    provider: isConfigured
      ? {
          google: {
            clientId,
            clientSecret,
          },
        }
      : {},
  };
};

const googleConfig = resolveGoogleProviderConfig(process.env);

if (googleConfig.isConfigured) {
  if (process.env.NODE_ENV !== "test") {
    console.log("[Better Auth] Google OAuth provider registered successfully.");
  }
} else {
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      `[Better Auth] Google OAuth provider disabled: Missing or invalid environment variable(s): ${googleConfig.missing.join(
        ", "
      )}. Sign-ins using Google will fail with 'Provider not found'.`
    );
  }
}

export const auth = betterAuth({
  database: mongodbAdapter(db, {
    client,
  }),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  secret: process.env.BETTER_AUTH_SECRET || "salonbook-dev-fallback-secret-at-least-32-chars",
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
  socialProviders: {
    ...googleConfig.provider,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false, // Disallows client-supplied roles during signup
      },
      isBlocked: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false, // Disallows client modification of account status
      },
      phone: {
        type: "string",
        required: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await checkAndPromoteAdmin(user);
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: false, // Strictly verify session in database
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  plugins: [
    jwt({
      jwks: {
        keyPairConfig: {
          alg: "EdDSA",
          crv: "Ed25519",
        },
      },
      jwt: {
        issuer: process.env.BETTER_AUTH_URL || "http://localhost:5000",
        audience: frontendOrigin,
        expirationTime: "15m",
        definePayload: ({ user }) => ({
          sub: user.id || (user._id ? user._id.toString() : undefined),
          email: user.email,
          name: user.name,
          role: user.role || "customer",
          isBlocked: Boolean(user.isBlocked),
        }),
      },
    }),
  ],
});

export default auth;
