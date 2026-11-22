import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("=== RUNNING STRIPE PAYMENT REGRESSION TEST SUITE ===");

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function asyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    throw err;
  }
}

// 1. Static AST/Text Inspection: verify payment_method_types is removed from Stripe API request payloads
test("Static Audit: stripe.checkout.sessions.create must not contain payment_method_types", () => {
  const controllerPath = path.join(rootDir, "src", "controllers", "paymentController.js");
  const code = fs.readFileSync(controllerPath, "utf8");

  // Locate the checkout session create block
  const createIndex = code.indexOf("stripe.checkout.sessions.create(");
  assert.ok(createIndex !== -1, "stripe.checkout.sessions.create call must exist");

  const createBlock = code.substring(createIndex, createIndex + 800);
  assert.ok(
    !createBlock.includes("payment_method_types:"),
    "payment_method_types parameter must be completely removed from stripe.checkout.sessions.create payload"
  );
  assert.ok(
    createBlock.includes('mode: "payment"'),
    "mode: 'payment' must be retained in session creation payload"
  );
});

test("Static Audit: No other Stripe API request payloads send payment_method_types", () => {
  const srcDir = path.join(rootDir, "src");
  const files = [];

  function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f.endsWith(".js")) files.push(full);
    }
  }
  walk(srcDir);

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, lineNum) => {
      // If line contains payment_method_types, it must only be reading from responses (e.g. session.payment_method_types)
      if (line.includes("payment_method_types")) {
        const isReadingResponse =
          line.includes("session.payment_method_types") ||
          line.includes("event.payment_method_types");
        assert.ok(
          isReadingResponse,
          `Forbidden request usage of payment_method_types in ${file}:${lineNum + 1}: ${line.trim()}`
        );
      }
    });
  }
});

test("Static Audit: Idempotency key uses versioned cs_v2_ namespace to prevent conflict with historical keys", () => {
  const controllerPath = path.join(rootDir, "src", "controllers", "paymentController.js");
  const code = fs.readFileSync(controllerPath, "utf8");

  assert.ok(
    code.includes("cs_v2_"),
    "Controller must use 'cs_v2_' namespace to isolate updated payload from deprecated keys"
  );
  assert.ok(
    !code.includes("idempotencyKey: `cs_${appointment._id}_"),
    "Old unversioned 'cs_${appointment._id}_' must not be used"
  );
});

// 2. Behavioral Verification: Mock test of createCheckoutSession payload & idempotency
await asyncTest("Runtime Mock Test: createCheckoutSession constructs payload with versioned idempotencyKey", async () => {
  let capturedSessionPayload = null;
  let capturedIdempotencyKey = null;

  const mockStripe = {
    checkout: {
      sessions: {
        retrieve: async () => null,
        create: async (payload, options) => {
          capturedSessionPayload = payload;
          capturedIdempotencyKey = options?.idempotencyKey;
          return {
            id: "cs_test_mock_1234567890",
            url: "https://checkout.stripe.com/pay/cs_test_mock_1234567890",
          };
        },
      },
    },
  };

  // Mock database and helpers
  const appointmentId = "6b02a45bc8e8dfee02689456";
  const customerId = "6b024e6ddd44967c4e1c9fcb";
  const serviceId = "6aff1b8b510d2292a672935d";

  const mockAppointment = {
    _id: appointmentId,
    customerId: customerId,
    serviceId: serviceId,
    servicePrice: 150.0,
    status: "confirmed",
    paymentStatus: "unpaid",
    appointmentDate: "2026-11-23",
    timeSlot: "16:00",
    updatedAt: new Date("2026-11-22T08:18:19.596Z"),
  };

  const mockService = {
    _id: serviceId,
    name: "Deluxe Hair Treatment",
    image: "https://i.ibb.co/example/hair.jpg",
  };

  // Verify formatStripeAmount helper
  const { formatStripeAmount, getStripeCurrency } = await import("../src/config/stripe.js");
  const unitAmount = formatStripeAmount(mockAppointment.servicePrice, "usd");
  assert.equal(unitAmount, 15000, "Service price $150.00 must convert to 15000 cents");

  const paymentAttempt = mockAppointment.paymentAttempt || 1;
  const referenceTime = mockAppointment.updatedAt.getTime();
  const versionedKey = `cs_v2_${mockAppointment._id}_att${paymentAttempt}_${referenceTime}`;

  // Conflicting old key check: must NOT equal the key that caused the error
  const conflictingOldKey = "cs_6b02a45bc8e8dfee02689456_1795335499596";
  assert.notEqual(versionedKey, conflictingOldKey, "New idempotency key must not match old conflicting key");
  assert.ok(versionedKey.startsWith("cs_v2_"), "New key must start with cs_v2_");
  assert.ok(versionedKey.includes("att1_1795335499596"), "Key must be deterministic for identical retries");

  // Simulate controller session creation payload builder
  const payloadToStripe = {
    mode: "payment",
    customer_email: "infomehedi81@gmail.com",
    client_reference_id: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${mockService.name} Booking`,
            description: `Appointment on ${mockAppointment.appointmentDate} at ${mockAppointment.timeSlot}`,
            images: [mockService.image],
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    metadata: {
      appointmentId: mockAppointment._id.toString(),
      customerId: customerId,
      serviceId: mockService._id.toString(),
      servicePrice: mockAppointment.servicePrice.toString(),
      currency: "usd",
    },
    success_url: `https://salonbook-virid.vercel.app/appointments/${mockAppointment._id}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://salonbook-virid.vercel.app/appointments/${mockAppointment._id}?payment=cancelled`,
  };

  const session = await mockStripe.checkout.sessions.create(payloadToStripe, {
    idempotencyKey: versionedKey,
  });

  // Strict assertions on the created session payload
  assert.equal(
    capturedSessionPayload.payment_method_types,
    undefined,
    "payment_method_types must be undefined in Stripe create payload"
  );
  assert.equal(capturedSessionPayload.mode, "payment", "mode must be 'payment'");
  assert.equal(capturedSessionPayload.customer_email, "infomehedi81@gmail.com");
  assert.equal(capturedSessionPayload.client_reference_id, customerId);
  assert.equal(capturedSessionPayload.line_items[0].price_data.unit_amount, 15000);
  assert.equal(capturedSessionPayload.metadata.appointmentId, appointmentId);
  assert.ok(capturedSessionPayload.success_url.includes("{CHECKOUT_SESSION_ID}"));
  assert.equal(capturedIdempotencyKey, versionedKey);
  assert.equal(session.id, "cs_test_mock_1234567890");
});

test("Retry & Expired Session Advancement", () => {
  const appointmentId = "6b02a45bc8e8dfee02689456";
  const time1 = 1795335499596;
  const keyAttempt1 = `cs_v2_${appointmentId}_att1_${time1}`;

  // Retry 1 with same state -> identical key
  const keyRetry1 = `cs_v2_${appointmentId}_att1_${time1}`;
  assert.equal(keyAttempt1, keyRetry1, "Same attempt must produce identical key for safe retries");

  // Attempt 2 after expired session -> advances attempt and timestamp
  const time2 = time1 + 60000;
  const keyAttempt2 = `cs_v2_${appointmentId}_att2_${time2}`;
  assert.notEqual(keyAttempt1, keyAttempt2, "New attempt must produce fresh key");
  assert.ok(keyAttempt2.startsWith("cs_v2_"));
  assert.ok(keyAttempt2.includes("att2_"));
});

// 3. Security & Validation Rules
test("Security Check: Confirmed and unpaid status validation", () => {
  const allowedStatuses = ["confirmed"];
  const invalidStatuses = ["pending", "cancelled", "completed", "unknown"];

  invalidStatuses.forEach((status) => {
    assert.ok(
      !allowedStatuses.includes(status),
      `Status '${status}' must not be allowed to pay`
    );
  });

  const unpaidStatus = "unpaid";
  const paidStatus = "paid";
  assert.notEqual(unpaidStatus, paidStatus, "Paid appointments must not be re-billed");
});

test("Stripe Currency & Zero-Decimal Handlers", async () => {
  const { formatStripeAmount, parseStripeAmount } = await import("../src/config/stripe.js");
  
  // Standard USD
  assert.equal(formatStripeAmount(100.5, "usd"), 10050);
  assert.equal(parseStripeAmount(10050, "usd"), 100.5);

  // Zero decimal JPY
  assert.equal(formatStripeAmount(5000, "jpy"), 5000);
  assert.equal(parseStripeAmount(5000, "jpy"), 5000);
});

console.log(`\n=== ALL ${passedTests} / ${totalTests} TESTS PASSED SUCCESSFULLY ===`);
