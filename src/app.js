import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDB } from "./config/db.js";
import healthRouter from "./routes/health.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";

const app = express();

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  "https://salonbook-virid.vercel.app",
  "http://localhost:3000",
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
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// HTTP request logging
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serverless DB connection middleware
app.use(async (req, res, next) => {
  try {
    await connectDB();
  } catch (err) {
    // Non-blocking: health endpoint will show current readyState, and routes can handle DB availability
  }
  next();
});

// Root informational route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    name: "SalonBook API Server",
    version: "1.0.0",
    status: "active",
    healthCheck: "/api/health",
  });
});

// API Routes
app.use("/api", healthRouter);

// 404 and Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
