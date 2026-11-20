import { ObjectId } from "mongodb";
import { db, connectDB } from "../config/db.js";

/**
 * GET /api/admin/users (Admin Only)
 * Lists registered customers with pagination, search, and blocked/unblocked filtering.
 */
export const getUsers = async (req, res, next) => {
  try {
    const { page, limit, search, status, role, isBlocked } = req.query;
    await connectDB();
    const userCollection = db.collection("user");

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    // Role filtering: defaults to customer unless explicitly specified
    if (role && typeof role === "string") {
      if (role.toLowerCase() !== "all") {
        filter.role = role.toLowerCase();
      }
    } else {
      filter.role = "customer";
    }

    // Filter by blocked / unblocked status
    if (typeof isBlocked === "string") {
      if (isBlocked === "true") {
        filter.isBlocked = true;
      } else if (isBlocked === "false") {
        filter.isBlocked = { $ne: true };
      }
    } else if (status && typeof status === "string") {
      const s = status.toLowerCase();
      if (s === "blocked") {
        filter.isBlocked = true;
      } else if (s === "unblocked" || s === "active") {
        filter.isBlocked = { $ne: true };
      }
    }

    // Search by name or email
    if (search && typeof search === "string" && search.trim()) {
      const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { email: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    const total = await userCollection.countDocuments(filter);
    const users = await userCollection
      .find(filter, {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          role: 1,
          isBlocked: 1,
          phone: 1,
          image: 1,
          emailVerified: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    return res.status(200).json({
      success: true,
      count: users.length,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      data: users.map((u) => ({
        ...u,
        isBlocked: Boolean(u.isBlocked),
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/users/:id (Admin Only)
 * Retrieves full customer details by ID (excluding password hashes and tokens).
 */
export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    await connectDB();
    const userCollection = db.collection("user");
    const user = await userCollection.findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          role: 1,
          isBlocked: 1,
          phone: 1,
          image: 1,
          emailVerified: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Include summary counts for this user
    const [appointmentCount, transactionCount] = await Promise.all([
      db.collection("appointments").countDocuments({ customerId: user._id }),
      db.collection("transactions").countDocuments({ customerId: user._id }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...user,
        isBlocked: Boolean(user.isBlocked),
        stats: {
          totalAppointments: appointmentCount,
          totalTransactions: transactionCount,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/users/:id/status (Admin Only)
 * Blocks or unblocks a customer account.
 * Security: Admins cannot block themselves or other admins. Role is never changed.
 */
export const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    await connectDB();
    const userCollection = db.collection("user");
    const targetUser = await userCollection.findOne({ _id: new ObjectId(id) });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Security rule: Admin cannot block or unblock themselves
    const currentUserId = req.user.id?.toString();
    const targetUserId = targetUser._id?.toString();
    const currentUserEmail = (req.user.email || "").toLowerCase();
    const targetUserEmail = (targetUser.email || "").toLowerCase();

    if (currentUserId === targetUserId || currentUserEmail === targetUserEmail) {
      return res.status(400).json({
        success: false,
        message: "Administrators cannot modify their own blocked status",
      });
    }

    // Security rule: Never allow blocking administrator accounts
    if (targetUser.role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Cannot modify status of administrator accounts",
      });
    }

    // Determine target blocked status
    let newBlockedState;
    if (typeof req.body.isBlocked === "boolean") {
      newBlockedState = req.body.isBlocked;
    } else if (typeof req.body.status === "string") {
      const s = req.body.status.toLowerCase();
      if (s === "blocked") newBlockedState = true;
      else if (["active", "unblocked"].includes(s)) newBlockedState = false;
    }

    if (typeof newBlockedState !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Must provide isBlocked: true/false or status: 'blocked'/'active'",
      });
    }

    // Role protection: Only isBlocked and updatedAt are updated; role is immutable!
    await userCollection.updateOne(
      { _id: targetUser._id },
      {
        $set: {
          isBlocked: newBlockedState,
          updatedAt: new Date(),
        },
      }
    );

    const updatedUser = await userCollection.findOne(
      { _id: targetUser._id },
      {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          role: 1,
          isBlocked: 1,
          phone: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: `Customer ${newBlockedState ? "blocked" : "unblocked"} successfully`,
      data: {
        ...updatedUser,
        isBlocked: Boolean(updatedUser.isBlocked),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/transactions (Admin Only)
 * Lists all transactions across customers with pagination, status filtering, date range, and search.
 */
export const getAllTransactions = async (req, res, next) => {
  try {
    const { page, limit, status, startDate, endDate, search, customerId } = req.query;
    await connectDB();
    const transactionsCollection = db.collection("transactions");

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const matchFilter = {};

    // Filter by payment status
    if (status && typeof status === "string") {
      const allowed = ["paid", "failed", "reconciliation_required"];
      if (allowed.includes(status.toLowerCase())) {
        matchFilter.status = status.toLowerCase();
      }
    }

    // Filter by customerId
    if (customerId && typeof customerId === "string" && ObjectId.isValid(customerId)) {
      matchFilter.customerId = new ObjectId(customerId);
    }

    // Filter by date range
    if (startDate || endDate) {
      matchFilter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          matchFilter.createdAt.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          if (typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
            end.setUTCHours(23, 59, 59, 999);
          }
          matchFilter.createdAt.$lte = end;
        }
      }
      if (Object.keys(matchFilter.createdAt).length === 0) {
        delete matchFilter.createdAt;
      }
    }

    const pipeline = [
      { $match: matchFilter },
      {
        $lookup: {
          from: "user",
          localField: "customerId",
          foreignField: "_id",
          as: "customer",
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
                email: 1,
                phone: 1,
              },
            },
          ],
        },
      },
      {
        $lookup: {
          from: "appointments",
          localField: "appointmentId",
          foreignField: "_id",
          as: "appointment",
          pipeline: [
            {
              $project: {
                _id: 1,
                appointmentDate: 1,
                timeSlot: 1,
                status: 1,
                serviceId: 1,
                serviceName: 1,
                servicePrice: 1,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          customer: { $ifNull: [{ $arrayElemAt: ["$customer", 0] }, null] },
          appointment: { $ifNull: [{ $arrayElemAt: ["$appointment", 0] }, null] },
        },
      },
    ];

    // Search filter across customer email/name or transaction references
    if (search && typeof search === "string" && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pipeline.push({
        $match: {
          $or: [
            { "customer.email": { $regex: escaped, $options: "i" } },
            { "customer.name": { $regex: escaped, $options: "i" } },
            { stripeSessionId: { $regex: escaped, $options: "i" } },
            { stripePaymentIntentId: { $regex: escaped, $options: "i" } },
          ],
        },
      });
    }

    // Count total matched documents
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await transactionsCollection.aggregate(countPipeline).toArray();
    const total = countResult[0]?.total || 0;

    // Paginate and project
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          stripeEventId: 0, // Never expose raw Stripe event IDs or secrets
        },
      }
    );

    const transactions = await transactionsCollection.aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      count: transactions.length,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/transactions/:id (Admin Only)
 * Retrieves single transaction details with full customer, appointment, and service information.
 */
export const getTransactionById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction ID format",
      });
    }

    await connectDB();
    const transactionsCollection = db.collection("transactions");
    const transaction = await transactionsCollection.findOne(
      { _id: new ObjectId(id) },
      { projection: { stripeEventId: 0 } }
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    const [customer, appointment] = await Promise.all([
      transaction.customerId
        ? db.collection("user").findOne(
            { _id: transaction.customerId },
            { projection: { _id: 1, name: 1, email: 1, phone: 1 } }
          )
        : null,
      transaction.appointmentId
        ? db.collection("appointments").findOne(
            { _id: transaction.appointmentId },
            {
              projection: {
                _id: 1,
                appointmentDate: 1,
                timeSlot: 1,
                status: 1,
                serviceId: 1,
                serviceName: 1,
                servicePrice: 1,
              },
            }
          )
        : null,
    ]);

    const service = appointment?.serviceId
      ? await db.collection("services").findOne(
          { _id: appointment.serviceId },
          { projection: { _id: 1, name: 1, slug: 1, category: 1, price: 1, duration: 1 } }
        )
      : null;

    return res.status(200).json({
      success: true,
      data: {
        ...transaction,
        customer,
        appointment: appointment
          ? {
              ...appointment,
              service,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/dashboard/stats (Admin Only)
 * Returns aggregated statistics for the Admin Dashboard based on actual database records.
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    await connectDB();
    const userCollection = db.collection("user");
    const servicesCollection = db.collection("services");
    const appointmentsCollection = db.collection("appointments");
    const transactionsCollection = db.collection("transactions");

    const [userStats, serviceStats, appointmentStats, transactionStats] = await Promise.all([
      // 1. Customer stats
      userCollection
        .aggregate([
          { $match: { role: "customer" } },
          {
            $group: {
              _id: "$isBlocked",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),

      // 2. Service stats
      servicesCollection
        .aggregate([
          {
            $group: {
              _id: "$isActive",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),

      // 3. Appointment stats
      appointmentsCollection
        .aggregate([
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),

      // 4. Transaction stats & revenue grouped by currency
      transactionsCollection
        .aggregate([
          {
            $facet: {
              byStatus: [
                {
                  $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                  },
                },
              ],
              revenueByCurrency: [
                { $match: { status: "paid" } },
                {
                  $group: {
                    _id: { $toLower: "$currency" },
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    currency: "$_id",
                    totalAmount: { $round: ["$totalAmount", 2] },
                    count: 1,
                  },
                },
              ],
            },
          },
        ])
        .toArray(),
    ]);

    // Parse Customer Counts
    let totalCustomers = 0;
    let blockedCustomers = 0;
    userStats.forEach((group) => {
      totalCustomers += group.count;
      if (group._id === true) {
        blockedCustomers = group.count;
      }
    });

    // Parse Service Counts
    let totalActiveServices = 0;
    let totalInactiveServices = 0;
    serviceStats.forEach((group) => {
      if (group._id === true) {
        totalActiveServices = group.count;
      } else {
        totalInactiveServices += group.count;
      }
    });
    const totalServices = totalActiveServices + totalInactiveServices;

    // Parse Appointment Counts
    let pendingAppointments = 0;
    let confirmedAppointments = 0;
    let cancelledAppointments = 0;
    let totalAppointments = 0;
    appointmentStats.forEach((group) => {
      totalAppointments += group.count;
      if (group._id === "pending") pendingAppointments = group.count;
      else if (group._id === "confirmed") confirmedAppointments = group.count;
      else if (group._id === "cancelled") cancelledAppointments = group.count;
    });

    // Parse Transaction Counts & Revenue
    const txStatusGroups = transactionStats[0]?.byStatus || [];
    let paidTransactions = 0;
    let failedTransactions = 0;
    let reconciliationRequiredTransactions = 0;
    let totalTransactions = 0;
    txStatusGroups.forEach((group) => {
      totalTransactions += group.count;
      if (group._id === "paid") paidTransactions = group.count;
      else if (group._id === "failed") failedTransactions = group.count;
      else if (group._id === "reconciliation_required") reconciliationRequiredTransactions = group.count;
    });

    const revenueByCurrency = transactionStats[0]?.revenueByCurrency || [];
    const revenueSummary = {};
    revenueByCurrency.forEach((item) => {
      revenueSummary[item.currency] = item.totalAmount;
    });

    return res.status(200).json({
      success: true,
      data: {
        customers: {
          total: totalCustomers,
          active: totalCustomers - blockedCustomers,
          blocked: blockedCustomers,
        },
        services: {
          total: totalServices,
          active: totalActiveServices,
          inactive: totalInactiveServices,
        },
        appointments: {
          total: totalAppointments,
          pending: pendingAppointments,
          confirmed: confirmedAppointments,
          cancelled: cancelledAppointments,
        },
        transactions: {
          total: totalTransactions,
          paid: paidTransactions,
          failed: failedTransactions,
          reconciliationRequired: reconciliationRequiredTransactions,
        },
        revenue: {
          byCurrency: revenueByCurrency,
          summary: revenueSummary,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
