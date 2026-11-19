import { ObjectId } from "mongodb";
import { db, connectDB } from "../config/db.js";
import { isValidDateString, isPastDateTime } from "../utils/appointmentValidators.js";

let indexesInitialized = false;

/**
 * Accesses the appointments collection and initializes required indexes.
 */
export const getAppointmentsCollection = async () => {
  await connectDB();
  const collection = db.collection("appointments");

  if (!indexesInitialized) {
    try {
      await Promise.all([
        // Duplicate active date/time slot prevention:
        // Unique compound partial index over appointmentDate and timeSlot for active (pending / confirmed) bookings.
        // Cancelled bookings are excluded from the index, immediately releasing the slot.
        collection.createIndex(
          { appointmentDate: 1, timeSlot: 1 },
          {
            unique: true,
            partialFilterExpression: {
              status: { $in: ["pending", "confirmed"] },
            },
            name: "idx_appointment_date_slot_active_unique",
          }
        ),
        // Compound index for customer appointment listing and date ordering
        collection.createIndex(
          { customerId: 1, createdAt: -1 },
          { name: "idx_customer_created" }
        ),
        // Index for filtering by appointment status
        collection.createIndex(
          { status: 1 },
          { name: "idx_status" }
        ),
        // Index for filtering/querying by appointment date
        collection.createIndex(
          { appointmentDate: 1 },
          { name: "idx_appointment_date" }
        ),
      ]);
      indexesInitialized = true;
    } catch (err) {
      if (err.code !== 85) {
        console.warn("[Appointments Collection] Index notice:", err.message);
      }
    }
  }

  return collection;
};

/**
 * Accesses the services collection.
 */
const getServicesCollection = async () => {
  await connectDB();
  return db.collection("services");
};

/**
 * Accesses the user collection.
 */
const getUserCollection = async () => {
  await connectDB();
  return db.collection("user");
};

// ==========================================
// Customer Appointment Controllers
// ==========================================

/**
 * POST /api/appointments (Customer Only)
 * Books a new salon appointment with concurrency protection and price extraction from database.
 */
export const createAppointment = async (req, res, next) => {
  try {
    const { serviceId, appointmentDate, timeSlot, message } = req.body;

    // 1. Validate service ID format
    if (!serviceId || typeof serviceId !== "string" || !ObjectId.isValid(serviceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid service ID is required",
      });
    }

    // 2. Fetch service from database and confirm availability
    const servicesCollection = await getServicesCollection();
    const service = await servicesCollection.findOne({ _id: new ObjectId(serviceId) });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "The requested salon service was not found",
      });
    }

    if (!service.isActive) {
      return res.status(400).json({
        success: false,
        message: "This salon service is currently unavailable for booking",
      });
    }

    // 3. Validate appointment date format (YYYY-MM-DD)
    if (!isValidDateString(appointmentDate)) {
      return res.status(400).json({
        success: false,
        message: "Appointment date must be a valid calendar date in YYYY-MM-DD format (e.g. 2026-12-01)",
      });
    }

    // 4. Validate timeSlot
    if (!timeSlot || typeof timeSlot !== "string" || timeSlot.trim().length < 2 || timeSlot.trim().length > 50) {
      return res.status(400).json({
        success: false,
        message: "A valid appointment time slot is required (e.g. '10:00 AM')",
      });
    }

    const trimmedDate = appointmentDate.trim();
    const trimmedTimeSlot = timeSlot.trim();

    // 5. Reject past appointment dates and times
    if (isPastDateTime(trimmedDate, trimmedTimeSlot)) {
      return res.status(400).json({
        success: false,
        message: "Appointment date and time cannot be in the past",
      });
    }

    // 6. Validate message field if provided
    if (message !== undefined && message !== null) {
      if (typeof message !== "string" || message.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Message must be a string up to 500 characters",
        });
      }
    }

    const appointmentsCollection = await getAppointmentsCollection();

    // 7. Concurrency-safe slot pre-check: verify if an active appointment already occupies this slot
    const existingBooking = await appointmentsCollection.findOne({
      appointmentDate: trimmedDate,
      timeSlot: trimmedTimeSlot,
      status: { $in: ["pending", "confirmed"] },
    });

    if (existingBooking) {
      return res.status(409).json({
        success: false,
        message: "This time slot is already booked for the selected date. Please choose another time slot.",
      });
    }

    // 8. Construct immutable appointment record on the server
    const now = new Date();
    const appointmentDoc = {
      serviceId: new ObjectId(serviceId),
      customerId: new ObjectId(req.user.id),
      appointmentDate: trimmedDate,
      timeSlot: trimmedTimeSlot,
      message: message && typeof message === "string" ? message.trim() : "",
      servicePrice: service.price, // Trust ONLY database price
      paymentStatus: "unpaid",     // Initial status is strictly unpaid
      status: "pending",           // Initial status is strictly pending
      createdAt: now,
      updatedAt: now,
    };

    // 9. Atomic insert with compound unique partial index protection against race conditions
    const result = await appointmentsCollection.insertOne(appointmentDoc);

    return res.status(201).json({
      success: true,
      message: "Appointment booked successfully",
      data: {
        _id: result.insertedId,
        ...appointmentDoc,
        service: {
          _id: service._id,
          name: service.name,
          category: service.category,
          duration: service.duration,
          image: service.image || "",
        },
      },
    });
  } catch (error) {
    // Catch duplicate key collision from MongoDB unique partial index
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This time slot has just been booked by another customer. Please choose a different time slot.",
      });
    }
    next(error);
  }
};

/**
 * GET /api/appointments/my (Customer Only)
 * Retrieves paginated appointments for the authenticated customer.
 */
export const getMyAppointments = async (req, res, next) => {
  try {
    const appointmentsCollection = await getAppointmentsCollection();
    const { page, limit, status } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Filter strictly by the current customer's ID
    const filter = {
      customerId: new ObjectId(req.user.id),
    };

    // Optional status filtering
    if (status && typeof status === "string") {
      const allowedStatuses = ["pending", "confirmed", "cancelled"];
      if (!allowedStatuses.includes(status.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: "Invalid status filter. Allowed values: pending, confirmed, cancelled",
        });
      }
      filter.status = status.toLowerCase();
    }

    const total = await appointmentsCollection.countDocuments(filter);

    // Aggregate with services collection to attach service information
    const pipeline = [
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $lookup: {
          from: "services",
          localField: "serviceId",
          foreignField: "_id",
          as: "service",
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
                slug: 1,
                category: 1,
                duration: 1,
                image: 1,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          service: { $ifNull: [{ $arrayElemAt: ["$service", 0] }, null] },
        },
      },
    ];

    const appointments = await appointmentsCollection.aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      count: appointments.length,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      data: appointments,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/appointments/my/:id (Customer Only)
 * Retrieves a single appointment belonging to the authenticated customer.
 */
export const getMyAppointmentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID format",
      });
    }

    const appointmentsCollection = await getAppointmentsCollection();
    const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // IDOR protection: confirm ownership
    if (appointment.customerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view this appointment",
      });
    }

    // Attach service information
    const servicesCollection = await getServicesCollection();
    const service = await servicesCollection.findOne(
      { _id: appointment.serviceId },
      {
        projection: {
          _id: 1,
          name: 1,
          slug: 1,
          category: 1,
          duration: 1,
          image: 1,
          description: 1,
        },
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        ...appointment,
        service: service || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/appointments/my/:id/cancel (Customer Only)
 * Allows a customer to cancel their own pending appointment.
 */
export const cancelMyAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID format",
      });
    }

    const appointmentsCollection = await getAppointmentsCollection();
    const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // IDOR protection: confirm ownership
    if (appointment.customerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to cancel this appointment",
      });
    }

    // Only pending appointments can be cancelled by the customer
    if (appointment.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Appointment is already cancelled",
      });
    }

    if (appointment.status === "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Confirmed appointments cannot be cancelled by customer. Please contact salon support directly.",
      });
    }

    if (appointment.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Only pending appointments can be cancelled",
      });
    }

    const now = new Date();
    await appointmentsCollection.updateOne(
      { _id: new ObjectId(id), customerId: new ObjectId(req.user.id), status: "pending" },
      {
        $set: {
          status: "cancelled",
          updatedAt: now,
        },
      }
    );

    const updatedAppointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });

    return res.status(200).json({
      success: true,
      message: "Appointment cancelled successfully",
      data: updatedAppointment,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// Admin Appointment Management Controllers
// ==========================================

/**
 * GET /api/appointments (Admin Only)
 * Retrieves all appointments with pagination, filtering, and enriched service/customer details.
 */
export const getAllAppointments = async (req, res, next) => {
  try {
    const appointmentsCollection = await getAppointmentsCollection();
    const { page, limit, status, paymentStatus, appointmentDate, customerId } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    // Filter by status
    if (status && typeof status === "string") {
      const allowedStatuses = ["pending", "confirmed", "cancelled"];
      if (allowedStatuses.includes(status.toLowerCase())) {
        filter.status = status.toLowerCase();
      }
    }

    // Filter by paymentStatus
    if (paymentStatus && typeof paymentStatus === "string") {
      const allowedPaymentStatuses = ["unpaid", "paid"];
      if (allowedPaymentStatuses.includes(paymentStatus.toLowerCase())) {
        filter.paymentStatus = paymentStatus.toLowerCase();
      }
    }

    // Filter by appointmentDate
    if (appointmentDate && typeof appointmentDate === "string" && isValidDateString(appointmentDate)) {
      filter.appointmentDate = appointmentDate.trim();
    }

    // Filter by customerId
    if (customerId && typeof customerId === "string" && ObjectId.isValid(customerId)) {
      filter.customerId = new ObjectId(customerId);
    }

    const total = await appointmentsCollection.countDocuments(filter);

    const pipeline = [
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $lookup: {
          from: "services",
          localField: "serviceId",
          foreignField: "_id",
          as: "service",
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
                slug: 1,
                category: 1,
                duration: 1,
                image: 1,
              },
            },
          ],
        },
      },
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
                role: 1,
              },
            },
          ],
        },
      },
      {
        $addFields: {
          service: { $ifNull: [{ $arrayElemAt: ["$service", 0] }, null] },
          customer: { $ifNull: [{ $arrayElemAt: ["$customer", 0] }, null] },
        },
      },
    ];

    const appointments = await appointmentsCollection.aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      count: appointments.length,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      data: appointments,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/appointments/:id (Admin Only)
 * Retrieves a single appointment with full service and customer information.
 */
export const getAppointmentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID format",
      });
    }

    const appointmentsCollection = await getAppointmentsCollection();
    const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    const servicesCollection = await getServicesCollection();
    const userCollection = await getUserCollection();

    const [service, customer] = await Promise.all([
      servicesCollection.findOne(
        { _id: appointment.serviceId },
        {
          projection: {
            _id: 1,
            name: 1,
            slug: 1,
            category: 1,
            duration: 1,
            image: 1,
            description: 1,
          },
        }
      ),
      userCollection.findOne(
        { _id: appointment.customerId },
        {
          projection: {
            _id: 1,
            name: 1,
            email: 1,
            phone: 1,
            role: 1,
          },
        }
      ),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...appointment,
        service: service || null,
        customer: customer || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/appointments/:id/status (Admin Only)
 * Updates appointment status to 'confirmed' or 'cancelled' with strict transition rules.
 */
export const updateAppointmentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment ID format",
      });
    }

    const allowedStatuses = ["confirmed", "cancelled"];
    if (!status || typeof status !== "string" || !allowedStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Admin can set status to 'confirmed' or 'cancelled'",
      });
    }

    const targetStatus = status.toLowerCase();
    const appointmentsCollection = await getAppointmentsCollection();
    const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    // 1. Cancelled appointments cannot be changed back to pending or confirmed
    if (appointment.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cancelled appointments cannot be changed to another status",
      });
    }

    // 2. Already confirmed appointments cannot be confirmed again
    if (appointment.status === "confirmed" && targetStatus === "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Appointment is already confirmed",
      });
    }

    // Update status and updatedAt; paymentStatus is intentionally unchanged
    const now = new Date();
    await appointmentsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: targetStatus,
          updatedAt: now,
        },
      }
    );

    const updatedAppointment = await appointmentsCollection.findOne({ _id: new ObjectId(id) });

    return res.status(200).json({
      success: true,
      message: `Appointment status updated to '${targetStatus}' successfully`,
      data: updatedAppointment,
    });
  } catch (error) {
    next(error);
  }
};
