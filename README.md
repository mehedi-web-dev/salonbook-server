# SalonBook Server

The backend REST API server for the SalonBook platform, providing salon service management, appointment booking workflows, and administrative endpoints.

## 🛠️ Technology Stack

- **Runtime:** Node.js (ESM)
- **Framework:** Express.js 5
- **Database:** MongoDB Atlas with Mongoose ODM
- **Security & Utilities:** Helmet, CORS, Morgan, Dotenv
- **Deployment Platform:** Vercel (Serverless Functions)

## 📁 Project Structure

```text
salonbook-server/
├── api/
│   └── index.js              # Vercel serverless entrypoint
├── src/
│   ├── config/
│   │   └── db.js             # Mongoose connection with serverless caching
│   ├── controllers/          # Business logic handlers
│   ├── middleware/
│   │   └── errorHandler.js   # Centralized error and 404 handlers
│   ├── models/               # Mongoose data schemas and models
│   ├── routes/
│   │   └── health.js         # Health check and status route
│   ├── utils/                # Helper utilities
│   └── app.js                # Express app setup and middleware chain
├── .env.example              # Safe environment variable template
├── .gitignore                # Security-first Git exclusion rules
├── index.js                  # Local development server entrypoint
├── package.json              # Project scripts and dependencies
├── vercel.json               # Vercel deployment rewrite rules
└── README.md                 # Project documentation
```

## ⚙️ Environment Configuration

Create a `.env` file in the root directory based on `.env.example`:

```env
# MongoDB Atlas Connection String
MONGODB_URI=

# Server Port (default: 5000)
PORT=5000

# Environment Mode (development | production)
NODE_ENV=development

# Allowed Frontend Client URL (for CORS)
CLIENT_URL=https://salonbook-virid.vercel.app
```

> **Note:** Never commit `.env` or any production credentials to version control.

## 🚀 Installation & Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run in development mode (with auto-reload):**
   ```bash
   npm run dev
   ```

3. **Start production server:**
   ```bash
   npm start
   ```

## 🩺 API Health Endpoint

- **Route:** `GET /api/health`
- **Description:** Verifies server runtime status, uptime, and database connection state.
- **Example Response:**
  ```json
  {
    "success": true,
    "message": "SalonBook API server is healthy",
    "status": "ok",
    "timestamp": "2026-11-19T00:30:00.000Z",
    "uptime": 120,
    "database": {
      "status": "connected",
      "readyState": 1
    },
    "environment": "development"
  }
  ```
