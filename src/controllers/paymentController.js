import { ObjectId } from "mongodb";
import { db, client, connectDB } from "../config/db.js";
import {
  getStripeClient,
  getStripeWebhookSecret,
  getStripeCurrency,
  getFrontendUrl,
  formatStripeAmount,
} from "../config/stripe.js";

let indexesInitialized = false;

/**
 * Accesses the transactions collection and ensures unique indexes exist.
 */
export const getTransactionsCollection = async () => {
  await connectDB();
  const collection = db.collection("transactions");

  if (!indexesInitialized) {
    try {
      await Promise.all([
        // Enforce uniqueness per Stripe Checkout Session to prevent duplicate transactions
        collection.createIndex(
          { stripeSessionId: 1 },
          { unique: true, name: "idx_stripe_session_id_unique" }
        ),
        // Compound index for customer payment history queries and sorting
        collection.createIndex(
          { customerId: 1, createdAt: -1 },
          { name: "idx_customer_created" }
        ),
        // Index by appointment ID
        collection.createIndex(
          { appointmentId: 1 },
          { name: "idx_appointment_id" }
        ),
        // Sparse index on Stripe Event ID for webhook idempotency
        collection.createIndex(
          { stripeEventId: 1 },
          { sparse: true, name: "idx_stripe_event_id" }
        ),
      ]);
      indexesInitialized = true;
    } catch (err) {
      if (err.code !== 85) {
        console.warn("[Transactions Collection] Index notice:", err.message);
      }
    }
  }

  return collection;
};

/**
 * POST /api/payments/create-checkout-session (Customer Only)
 * Creates a Stripe Checkout Session for a confirmed, unpaid salon appointment.
 */
export const createCheckoutSession = async (req, res, next) => {
  try {
    const { appointmentId } = req.body;

    if (!appointmentId || typeof appointmentId !== "string" || !ObjectId.isValid(appointmentId)) {
      return res.status(400).json({
        success: false,
        message: "A valid appointment ID is required",
      });
    }

    await connectDB();
    const appointmentsCollection = db.collection("appointments");
    const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(appointmentId) });

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
        message: "Forbidden: You are not authorized to pay for this appointment",
      });
    }

    // Check appointment status: only confirmed appointments can be paid
    if (appointment.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cancelled appointments cannot be paid",
      });
    }

    if (appointment.status === "pending") {
      return res.status(400).json({
        success: false,
        message: "Only confirmed appointments can be paid. Please wait for salon confirmation.",
      });
    }

    if (appointment.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Only confirmed appointments can be paid",
      });
    }

    // Check payment status: already paid appointments cannot be paid again
    if (appointment.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "This appointment has already been paid",
      });
    }

    // Verify Stripe configuration
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(500).json({
        success: false,
        message: "Stripe payment service is not configured on the server",
      });
    }

    // Retrieve service details for line item metadata
    const service = await db.collection("services").findOne({ _id: appointment.serviceId });

    // Derive amount and currency strictly from server-side appointment servicePrice
    const currency = getStripeCurrency();
    const unitAmount = formatStripeAmount(appointment.servicePrice, currency);

    if (!unitAmount || unitAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid appointment service price",
      });
    }

    // Avoid creating redundant multiple sessions for the same unpaid appointment if an open session exists
    if (appointment.stripeSessionId) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(appointment.stripeSessionId);
        if (existingSession && existingSession.status === "open" && existingSession.url) {
          return res.status(200).json({
            success: true,
            message: "Active checkout session retrieved",
            data: {
              sessionId: existingSession.id,
              url: existingSession.url,
            },
          });
        }
      } catch (retrieveErr) {
        // Session expired or invalid, proceed to create a new session
      }
    }

    const frontendUrl = getFrontendUrl();
    const idempotencyTimestamp = appointment.updatedAt instanceof Date ? appointment.updatedAt.getTime() : Date.now();

    const session = await stripe.checkout.sessions.create(
      {
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: req.user.email,
        client_reference_id: req.user.id.toString(),
        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: service ? `${service.name} Booking` : "Salon Appointment Booking",
                description: `Appointment on ${appointment.appointmentDate} at ${appointment.timeSlot}`,
                images: service?.image ? [service.image] : [],
              },
              unit_amount: unitAmount,
            },
            quantity: 1,
          },
        ],
        metadata: {
          appointmentId: appointment._id.toString(),
          customerId: req.user.id.toString(),
          serviceId: appointment.serviceId.toString(),
          servicePrice: appointment.servicePrice.toString(),
          currency,
        },
        success_url: `${frontendUrl}/appointments/${appointment._id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/appointments/${appointment._id}?payment=cancelled`,
      },
      {
        idempotencyKey: `cs_${appointment._id}_${idempotencyTimestamp}`,
      }
    );

    // Save Stripe session ID to appointment record (without marking paymentStatus as paid)
    await appointmentsCollection.updateOne(
      { _id: appointment._id },
      { $set: { stripeSessionId: session.id } }
    );

    return res.status(200).json({
      success: true,
      message: "Checkout session created successfully",
      data: {
        sessionId: session.id,
        url: session.url,
      },
    });
  } catch (error) {
    console.error("[Stripe Controller] Create checkout session error:", error.message);
    next(error);
  }
};

/**
 * POST /api/payments/webhook
 * Receives Stripe webhook events with raw body signature verification and atomic state updates.
 */
export const handleStripeWebhook = async (req, res, next) => {
  try {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = getStripeWebhookSecret();

    if (!webhookSecret || webhookSecret === "whsec_your_stripe_webhook_secret") {
      console.error("[Stripe Webhook] Webhook secret is not configured on the server");
      return res.status(500).json({
        success: false,
        message: "Stripe webhook secret is not configured on the server",
      });
    }

    if (!sig) {
      return res.status(400).json({
        success: false,
        message: "Stripe signature header is missing",
      });
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(500).json({
        success: false,
        message: "Stripe client is not configured on the server",
      });
    }

    // Verify raw body is available
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body));

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error("[Stripe Webhook] Signature verification failed:", err.message);
      return res.status(400).json({
        success: false,
        message: `Webhook signature verification failed: ${err.message}`,
      });
    }

    const transactionsCollection = await getTransactionsCollection();

    // Event-level idempotency: check if event was already processed
    if (event.id) {
      const existingTx = await transactionsCollection.findOne({ stripeEventId: event.id });
      if (existingTx) {
        return res.status(200).json({
          received: true,
          message: "Event already processed",
        });
      }
    }

    // Handle payment completion events
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object;

      // Confirm Stripe reports payment as paid
      if (session.payment_status !== "paid") {
        return res.status(200).json({
          received: true,
          message: "Payment status is not paid yet",
        });
      }

      // Check session metadata
      const appointmentId = session.metadata?.appointmentId;
      const customerId = session.metadata?.customerId;

      if (!appointmentId || !ObjectId.isValid(appointmentId)) {
        console.error("[Stripe Webhook] Missing or invalid appointmentId in metadata");
        return res.status(400).json({
          success: false,
          message: "Missing or invalid appointment metadata",
        });
      }

      const appointmentsCollection = db.collection("appointments");
      const appointment = await appointmentsCollection.findOne({ _id: new ObjectId(appointmentId) });

      if (!appointment) {
        console.error(`[Stripe Webhook] Appointment not found: ${appointmentId}`);
        return res.status(404).json({
          success: false,
          message: "Appointment not found",
        });
      }

      // Verify customer reference
      if (customerId && appointment.customerId.toString() !== customerId) {
        console.error("[Stripe Webhook] Customer reference mismatch between session metadata and appointment");
        return res.status(400).json({
          success: false,
          message: "Customer reference mismatch",
        });
      }

      // Verify amount
      const currency = session.currency || "usd";
      const expectedAmount = formatStripeAmount(appointment.servicePrice, currency);
      if (session.amount_total !== expectedAmount) {
        console.error(
          `[Stripe Webhook] Amount mismatch: expected ${expectedAmount}, received ${session.amount_total}`
        );
        // Record reconciliation transaction without marking appointment paid
        await transactionsCollection.insertOne({
          appointmentId: appointment._id,
          customerId: appointment.customerId,
          stripeSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
          stripeEventId: event.id,
          amount: session.amount_total ? session.amount_total / 100 : appointment.servicePrice,
          currency,
          status: "reconciliation_required",
          paymentMethod: session.payment_method_types?.[0] || "card",
          notes: "Amount mismatch detected during webhook verification.",
          createdAt: new Date(),
          updatedAt: new Date(),
        }).catch(() => {});

        return res.status(400).json({
          success: false,
          message: "Amount mismatch detected",
        });
      }

      // Check if already paid (idempotency check on appointment document)
      if (appointment.paymentStatus === "paid") {
        return res.status(200).json({
          received: true,
          message: "Appointment is already marked as paid",
        });
      }

      // Edge case: Appointment was cancelled while Checkout Session was open
      if (appointment.status === "cancelled") {
        console.warn(
          `[Stripe Webhook] Payment received for cancelled appointment ${appointment._id}. Recording reconciliation transaction.`
        );
        await transactionsCollection.insertOne({
          appointmentId: appointment._id,
          customerId: appointment.customerId,
          stripeSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
          stripeEventId: event.id,
          amount: appointment.servicePrice,
          currency,
          status: "reconciliation_required",
          paymentMethod: session.payment_method_types?.[0] || "card",
          notes: "Payment received after appointment was cancelled. Requires refund or manual rescheduling.",
          createdAt: new Date(),
          updatedAt: new Date(),
        }).catch(() => {});

        return res.status(200).json({
          received: true,
          reconciliation: true,
          message: "Payment recorded for cancelled appointment; requires manual reconciliation",
        });
      }

      // Standard path: Execute atomic MongoDB transaction for appointment status update + transaction record
      const mongoSession = client.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          // Atomically update appointment paymentStatus from 'unpaid' to 'paid'
          const updateResult = await appointmentsCollection.updateOne(
            { _id: appointment._id, paymentStatus: "unpaid" },
            {
              $set: {
                paymentStatus: "paid",
                updatedAt: new Date(),
              },
            },
            { session: mongoSession }
          );

          if (updateResult.modifiedCount === 0) {
            throw new Error("Appointment was concurrently marked as paid");
          }

          // Insert immutable transaction record
          await transactionsCollection.insertOne(
            {
              appointmentId: appointment._id,
              customerId: appointment.customerId,
              stripeSessionId: session.id,
              stripePaymentIntentId:
                typeof session.payment_intent === "string" ? session.payment_intent : null,
              stripeEventId: event.id,
              amount: appointment.servicePrice,
              currency,
              status: "paid",
              paymentMethod: session.payment_method_types?.[0] || "card",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { session: mongoSession }
          );
        });
      } catch (txError) {
        // If unique index collision occurred on stripeSessionId, the payment was already recorded
        if (txError.code === 11000) {
          return res.status(200).json({
            received: true,
            message: "Transaction already exists",
          });
        }
        throw txError;
      } finally {
        await mongoSession.endSession();
      }

      return res.status(200).json({
        received: true,
        success: true,
      });
    }

    // Handle asynchronous payment failure
    if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object;
      const appointmentId = session.metadata?.appointmentId;
      const customerId = session.metadata?.customerId;

      if (appointmentId && ObjectId.isValid(appointmentId)) {
        await transactionsCollection.insertOne({
          appointmentId: new ObjectId(appointmentId),
          customerId: customerId && ObjectId.isValid(customerId) ? new ObjectId(customerId) : null,
          stripeSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
          stripeEventId: event.id,
          amount: Number(session.metadata?.servicePrice) || 0,
          currency: session.currency || "usd",
          status: "failed",
          paymentMethod: session.payment_method_types?.[0] || "card",
          notes: "Asynchronous payment failed at checkout.",
          createdAt: new Date(),
          updatedAt: new Date(),
        }).catch(() => {});
      }

      return res.status(200).json({
        received: true,
        status: "failed",
      });
    }

    // Acknowledge receipt for unhandled events
    return res.status(200).json({
      received: true,
    });
  } catch (error) {
    console.error("[Stripe Webhook] Error processing event:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error processing webhook",
    });
  }
};

/**
 * GET /api/payments/my (Customer Only)
 * Retrieves paginated payment history for the authenticated customer.
 */
export const getMyPayments = async (req, res, next) => {
  try {
    const transactionsCollection = await getTransactionsCollection();
    const { page, limit } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      customerId: new ObjectId(req.user.id),
    };

    const total = await transactionsCollection.countDocuments(filter);

    const pipeline = [
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
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
                paymentStatus: 1,
                serviceId: 1,
              },
            },
          ],
        },
      },
      {
        $lookup: {
          from: "services",
          localField: "appointment.serviceId",
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
          appointment: { $ifNull: [{ $arrayElemAt: ["$appointment", 0] }, null] },
          service: { $ifNull: [{ $arrayElemAt: ["$service", 0] }, null] },
        },
      },
      {
        // Never expose sensitive Stripe internal event data in customer responses
        $project: {
          stripeEventId: 0,
        },
      },
    ];

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
 * GET /api/payments/my/:id (Customer Only)
 * Retrieves a single payment record belonging to the authenticated customer.
 */
export const getMyPaymentById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment record ID format",
      });
    }

    const transactionsCollection = await getTransactionsCollection();
    const transaction = await transactionsCollection.findOne(
      { _id: new ObjectId(id) },
      { projection: { stripeEventId: 0 } }
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // IDOR protection: confirm ownership
    if (transaction.customerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view this payment record",
      });
    }

    const appointment = await db.collection("appointments").findOne(
      { _id: transaction.appointmentId },
      {
        projection: {
          _id: 1,
          appointmentDate: 1,
          timeSlot: 1,
          status: 1,
          paymentStatus: 1,
          serviceId: 1,
        },
      }
    );

    const service = appointment
      ? await db.collection("services").findOne(
          { _id: appointment.serviceId },
          {
            projection: {
              _id: 1,
              name: 1,
              slug: 1,
              category: 1,
              duration: 1,
              image: 1,
            },
          }
        )
      : null;

    return res.status(200).json({
      success: true,
      data: {
        ...transaction,
        appointment: appointment || null,
        service: service || null,
      },
    });
  } catch (error) {
    next(error);
  }
};
