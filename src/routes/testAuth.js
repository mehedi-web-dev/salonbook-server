import express from "express";
import { requireAuth, requireAdmin, requireCustomer } from "../middleware/auth.js";

const router = express.Router();

router.get("/protected", requireAuth, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Protected endpoint access granted",
    authType: req.authType,
    user: req.user,
  });
});

router.get("/admin", requireAdmin, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Admin endpoint access granted",
    authType: req.authType,
    user: req.user,
  });
});

router.get("/customer", requireCustomer, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Customer endpoint access granted",
    authType: req.authType,
    user: req.user,
  });
});

export default router;
