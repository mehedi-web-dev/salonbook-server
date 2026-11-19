import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { toNodeHandler } from "better-auth/node";
import { connectDB } from "./config/db.js";
import { auth } from "./config/auth.js";
import healthRouter from "./routes/health.js";
import servicesRouter from "./routes/services.js";
import testAuthRouter from "./routes/testAuth.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Trust immediate reverse proxy (Vercel Edge / API Gateway) for secure cookies
app.set("trust proxy", 1);

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  "https://salonbook-virid.vercel.app",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
];

if (process.env.CLIENT_URL && !allowedOrigins.includes(process.env.CLIENT_URL)) {
  allowedOrigins.push(process.env.CLIENT_URL);
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  exposedHeaders: ["Set-Cookie"],
};

app.use(cors(corsOptions));

// HTTP request logging
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Serverless DB connection middleware
app.use(async (req, res, next) => {
  try {
    await connectDB();
  } catch (err) {
    // Non-blocking: health endpoint will show current status
  }
  next();
});

// Better Auth Express handler (MUST be mounted before express.json() body parser)
app.all("/api/auth/{*splat}", toNodeHandler(auth));

// Body parsing for standard API routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root informational route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    name: "SalonBook API Server",
    version: "1.0.0",
    status: "active",
    authEndpoints: "/api/auth",
    healthCheck: "/api/health",
  });
});

// API Routes
app.use("/api", healthRouter);
app.use("/api/services", servicesRouter);
app.use("/api/test", testAuthRouter);

// 404 and Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
