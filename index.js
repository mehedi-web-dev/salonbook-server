import "dotenv/config";
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
  } catch (error) {
    console.warn(
      `Starting server with MongoDB offline: ${error.message}`
    );
  }

  app.listen(PORT, () => {
    console.log(
      `SalonBook Server is running on port ${PORT} [${process.env.NODE_ENV || "development"}]`
    );
    console.log(`Health endpoint: http://localhost:${PORT}/api/health`);
  });
};

// When running directly (local or non-serverless container), listen on PORT
if (process.env.VERCEL !== "1") {
  startServer();
}

export default app;
