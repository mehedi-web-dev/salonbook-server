import express from "express";
import { connectDB } from "../config/db.js";

const router = express.Router();

router.get("/health", async (req, res) => {
  let dbStatus = "disconnected";

  try {
    const client = await connectDB();
    await client.db().command({ ping: 1 });
    dbStatus = "connected";
  } catch (error) {
    dbStatus = "disconnected";
  }

  res.status(200).json({
    success: true,
    message: "SalonBook API server is healthy",
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    database: {
      driver: "mongodb-native",
      status: dbStatus,
    },
    environment: process.env.NODE_ENV || "development",
  });
});

export default router;
