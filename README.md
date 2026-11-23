# SalonBook – Backend

## Project Name and Description

**SalonBook** is a modern salon and barber appointment booking platform that allows customers to explore salon services, discover professional barbers, book appointments, and make secure online payments.

The SalonBook Backend provides RESTful APIs to manage authentication, users, services, barbers, appointments, payments, and administrative operations. It is built with Node.js, Express.js, and MongoDB Native Driver.

**Live Backend:** https://salonbook-server-roan.vercel.app/

## Important Features

- **Authentication & Authorization:** Secure authentication using Better Auth, email/password login, Google OAuth, JWT verification, and role-based access control.
- **Service Management:** Create, retrieve, update, delete, search, and manage salon services.
- **Barber Management:** Dynamic barber profiles with specializations, experience, profile images, and associated services.
- **Appointment Management:** Create, view, confirm, and cancel appointments with duplicate booking prevention.
- **Payment Integration:** Secure Stripe Checkout integration with webhook verification and transaction management.
- **Customer Management:** Customer profile management, account blocking, and administrative controls.
- **Admin Dashboard APIs:** Protected administrative operations for managing services, barbers, customers, appointments, and transactions.
- **Image Upload:** ImgBB integration for uploading and hosting images.
- **Security:** Protected API routes, input validation, role verification, and secure payment processing.

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript Runtime |
| Express.js | Backend Framework |
| MongoDB | Database |
| MongoDB Native Driver | Database Operations |
| Better Auth | Authentication |
| JWT | Token Verification |
| Stripe | Payment Processing |
| ImgBB | Image Hosting |
| JavaScript (ES Modules) | Programming Language |
| Vercel | Deployment Platform |

**Database:** MongoDB Native Driver is used for database operations without Mongoose or Prisma.

## Installation Instructions

### Prerequisites

- Node.js (LTS recommended)
- npm
- MongoDB Atlas account
- Stripe account
- ImgBB API key
- Google OAuth credentials (for Google authentication)

### 1. Clone the Repository

```bash
git clone https://github.com/mehedi-web-dev/salonbook-server.git
```

### 2. Navigate to the Project Directory

```bash
cd salonbook-server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory.

Use `.env.example` as a reference and provide your own configuration values.

## How to Run the Project Locally

After installing dependencies and configuring the environment variables, start the development server:

```bash
npm run dev
```

The backend server will run at the configured local port.

Default local API URL:

```text
http://localhost:5000
```

The actual port depends on the backend configuration.

### Run Tests

Execute the automated test suite:

```bash
npm test
```

## Required Environment Variables

The following environment variable names represent the backend configuration. Add their actual values to your local `.env` file or deployment environment.

```env
PORT
MONGODB_URI
DB_NAME
BETTER_AUTH_SECRET
BETTER_AUTH_URL
FRONTEND_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
IMGBB_API_KEY
```

**Note:** Refer to `.env.example` for the exact environment variable names required by the current implementation. Never commit actual secret values, passwords, API keys, or credentials to GitHub.

## Live Website Link

**Frontend Application:**  
https://salonbook-virid.vercel.app/

**Backend API:**  
https://salonbook-server-roan.vercel.app/

## Client and Server Repository Links

**Client (Frontend) Repository:**  
https://github.com/mehedi-web-dev/salonbook

**Server (Backend) Repository:**  
https://github.com/mehedi-web-dev/salonbook-server

---

**Developed by Mehedi Hasan**
