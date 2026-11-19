import "dotenv/config";
import { MongoClient, ServerApiVersion } from "mongodb";

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
};

const getUri = () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not defined in environment variables. Please check your .env configuration."
    );
  }
  return uri;
};

// Singleton MongoClient and Db instance across hot-reloads and serverless functions
if (!global._mongoClient) {
  const uri = getUri();
  global._mongoClient = new MongoClient(uri, options);
  global._mongoClientPromise = global._mongoClient.connect().catch((err) => {
    global._mongoClientPromise = null;
    console.error("MongoDB connection failed:", err.message);
    throw err;
  });
}

export const client = global._mongoClient;
export const db = client.db("salonbook");

/**
 * Connect to MongoDB and return the connected MongoClient instance.
 * Reuses existing connection promise across serverless function invocations.
 */
export const connectDB = async () => {
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = client.connect().catch((err) => {
      global._mongoClientPromise = null;
      console.error("MongoDB connection failed:", err.message);
      throw err;
    });
  }
  return await global._mongoClientPromise;
};

/**
 * Return a MongoDB Database instance.
 * @param {string} [dbName="salonbook"]
 */
export const getDB = async (dbName = "salonbook") => {
  const connectedClient = await connectDB();
  return connectedClient.db(dbName);
};

/**
 * Return a specific MongoDB Collection instance.
 * @param {string} collectionName
 * @param {string} [dbName="salonbook"]
 */
export const getCollection = async (collectionName, dbName = "salonbook") => {
  const database = await getDB(dbName);
  return database.collection(collectionName);
};

export default connectDB;
