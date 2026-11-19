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

let client;

const getClientPromise = () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      "MONGODB_URI is not defined in environment variables. Please check your .env configuration."
    );
  }

  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect().catch((err) => {
      global._mongoClientPromise = null;
      console.error("MongoDB connection failed:", err.message);
      throw err;
    });
  }

  return global._mongoClientPromise;
};

/**
 * Connect to MongoDB and return the connected MongoClient instance.
 * Reuses existing connection promise across serverless function invocations.
 */
export const connectDB = async () => {
  return await getClientPromise();
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
  const db = await getDB(dbName);
  return db.collection(collectionName);
};

export default connectDB;
