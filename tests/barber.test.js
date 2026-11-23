import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ObjectId } from "mongodb";
import { db } from "../src/config/db.js";
import {
  parseSpecialization,
  parseAndValidateServiceIds,
  formatBarber,
  createBarber,
  getBarbers,
  getBarberById,
  updateBarber,
  updateBarberStatus,
  deleteBarber,
} from "../src/controllers/barberController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("=== RUNNING BARBER MANAGEMENT API TEST SUITE ===");

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

// ----------------------------------------------------------------------------
// 1. Static Architecture and Dependency Verification
// ----------------------------------------------------------------------------

test("Static Audit: No Mongoose or Prisma ORM imports in barber codebase", () => {
  const barberFiles = [
    path.join(rootDir, "src", "controllers", "barberController.js"),
    path.join(rootDir, "src", "routes", "barbers.js"),
  ];

  for (const file of barberFiles) {
    const content = fs.readFileSync(file, "utf8");
    assert.ok(
      !content.toLowerCase().includes("mongoose"),
      `Mongoose must not be imported in ${file}`
    );
    assert.ok(
      !content.toLowerCase().includes("@prisma/client"),
      `Prisma must not be imported in ${file}`
    );
  }
});

test("Static Audit: Barber controller uses MongoDB Native Driver exclusively", () => {
  const controllerPath = path.join(rootDir, "src", "controllers", "barberController.js");
  const code = fs.readFileSync(controllerPath, "utf8");

  assert.ok(
    code.includes('import { ObjectId } from "mongodb"'),
    "Must import ObjectId from mongodb native driver"
  );
  assert.ok(
    code.includes('db.collection("barbers")'),
    "Must query native barbers collection directly"
  );
  assert.ok(
    code.includes('db.collection("services")'),
    "Must query native services collection for service verification"
  );
});

test("Static Audit: Barber routes mounted in src/app.js", () => {
  const appPath = path.join(rootDir, "src", "app.js");
  const code = fs.readFileSync(appPath, "utf8");

  assert.ok(
    code.includes('import barbersRouter from "./routes/barbers.js"'),
    "app.js must import barbersRouter"
  );
  assert.ok(
    code.includes('app.use("/api/barbers", barbersRouter)'),
    "app.js must mount barbersRouter at /api/barbers"
  );
});

test("Static Audit: Barber routes security and middleware enforcement", () => {
  const routesPath = path.join(rootDir, "src", "routes", "barbers.js");
  const code = fs.readFileSync(routesPath, "utf8");

  assert.ok(
    code.includes('router.post("/", requireAdmin'),
    "POST /api/barbers must require admin role"
  );
  assert.ok(
    code.includes('router.patch("/:id", requireAdmin'),
    "PATCH /api/barbers/:id must require admin role"
  );
  assert.ok(
    code.includes('router.patch("/:id/status", requireAdmin'),
    "PATCH /api/barbers/:id/status must require admin role"
  );
  assert.ok(
    code.includes('router.delete("/:id", requireAdmin'),
    "DELETE /api/barbers/:id must require admin role"
  );
  assert.ok(
    code.includes('router.get("/", authenticateUser'),
    "GET /api/barbers must use authenticateUser"
  );
  assert.ok(
    code.includes('router.get("/:id", authenticateUser'),
    "GET /api/barbers/:id must use authenticateUser"
  );
});

test("Static Audit: Barber image upload route registered in src/routes/uploads.js", () => {
  const uploadsPath = path.join(rootDir, "src", "routes", "uploads.js");
  const code = fs.readFileSync(uploadsPath, "utf8");

  assert.ok(
    code.includes('uploadBarberImage'),
    "uploads.js must import and use uploadBarberImage"
  );
  assert.ok(
    code.includes('"/barber-image"'),
    "uploads.js must expose /barber-image endpoint"
  );
});

// ----------------------------------------------------------------------------
// 2. Unit Testing: Helper Functions
// ----------------------------------------------------------------------------

test("Helper Unit: parseSpecialization handles array of strings", () => {
  const input = ["Fade", "Beard Trim", "Hot Towel Shave"];
  const result = parseSpecialization(input);
  assert.deepEqual(result, ["Fade", "Beard Trim", "Hot Towel Shave"]);
});

test("Helper Unit: parseSpecialization parses JSON string array", () => {
  const input = '["Skin Fade", "Scissor Cut"]';
  const result = parseSpecialization(input);
  assert.deepEqual(result, ["Skin Fade", "Scissor Cut"]);
});

test("Helper Unit: parseSpecialization parses comma-separated string", () => {
  const input = "Skin Fade,  Beard Sculpting , Mustache Grooming  ";
  const result = parseSpecialization(input);
  assert.deepEqual(result, ["Skin Fade", "Beard Sculpting", "Mustache Grooming"]);
});

test("Helper Unit: parseSpecialization filters out empty values safely", () => {
  assert.deepEqual(parseSpecialization(null), []);
  assert.deepEqual(parseSpecialization(undefined), []);
  assert.deepEqual(parseSpecialization(""), []);
  assert.deepEqual(parseSpecialization(" ,  ,"), []);
  assert.deepEqual(parseSpecialization(["", "  ", "Valid Cut"]), ["Valid Cut"]);
});

test("Helper Unit: formatBarber formats document to specification", () => {
  const rawBarber = {
    _id: new ObjectId("65a000000000000000000001"),
    name: "Marcus Vance",
    image: "https://i.ibb.co/example/marcus.jpg",
    designation: "Master Stylist",
    specialization: ["Fade", "Beard Sculpting"],
    experience: 8,
    bio: "Over 8 years crafting precision styles.",
    serviceIds: [
      new ObjectId("65a000000000000000000010"),
      new ObjectId("65a000000000000000000020"),
    ],
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const formatted = formatBarber(rawBarber);

  assert.equal(formatted._id, "65a000000000000000000001");
  assert.equal(formatted.name, "Marcus Vance");
  assert.equal(formatted.image, "https://i.ibb.co/example/marcus.jpg");
  assert.equal(formatted.designation, "Master Stylist");
  assert.deepEqual(formatted.specialization, ["Fade", "Beard Sculpting"]);
  assert.equal(formatted.experience, 8);
  assert.equal(formatted.bio, "Over 8 years crafting precision styles.");
  assert.deepEqual(formatted.serviceIds, [
    "65a000000000000000000010",
    "65a000000000000000000020",
  ]);
  assert.equal(formatted.isActive, true);
  assert.ok(formatted.createdAt instanceof Date);
  assert.ok(formatted.updatedAt instanceof Date);
});

// Setup In-Memory Mock Store for Behavioral Tests
const inMemoryBarbers = new Map();
const inMemoryServices = new Map();

// Insert a known service for testing serviceIds relations
const validServiceId1 = new ObjectId("65a000000000000000000010");
const validServiceId2 = new ObjectId("65a000000000000000000020");

inMemoryServices.set(validServiceId1.toString(), {
  _id: validServiceId1,
  name: "Classic Precision Cut",
  price: 45,
  duration: 35,
});

inMemoryServices.set(validServiceId2.toString(), {
  _id: validServiceId2,
  name: "Royal Beard Grooming",
  price: 30,
  duration: 25,
});

// Mock MongoDB Native Driver Collections
const mockBarbersCollection = {
  createIndex: async () => true,
  insertOne: async (doc) => {
    const id = doc._id || new ObjectId();
    const stored = { _id: id, ...doc };
    inMemoryBarbers.set(id.toString(), stored);
    return { insertedId: id, acknowledged: true };
  },
  findOne: async (query) => {
    if (query._id) {
      return inMemoryBarbers.get(query._id.toString()) || null;
    }
    return null;
  },
  find: (query = {}) => {
    let results = Array.from(inMemoryBarbers.values());

    if (query.isActive !== undefined) {
      results = results.filter((b) => b.isActive === query.isActive);
    }

    if (query.serviceIds) {
      const targetIdStr = query.serviceIds.toString();
      results = results.filter((b) =>
        (b.serviceIds || []).some((sid) => sid.toString() === targetIdStr)
      );
    }

    if (query.$or) {
      // Basic simulation of text search
      results = results.filter((b) =>
        query.$or.some((clause) => {
          if (clause.name?.$regex) {
            const re = new RegExp(clause.name.$regex, "i");
            return re.test(b.name);
          }
          return false;
        })
      );
    }

    return {
      sort: () => ({
        toArray: async () => results,
      }),
      toArray: async () => results,
    };
  },
  updateOne: async (query, update) => {
    const id = query._id.toString();
    const existing = inMemoryBarbers.get(id);
    if (!existing) return { modifiedCount: 0 };
    if (update.$set) {
      Object.assign(existing, update.$set);
    }
    return { modifiedCount: 1 };
  },
  deleteOne: async (query) => {
    const id = query._id.toString();
    const existed = inMemoryBarbers.has(id);
    inMemoryBarbers.delete(id);
    return { deletedCount: existed ? 1 : 0 };
  },
};

const mockServicesCollection = {
  find: (query = {}) => {
    let results = Array.from(inMemoryServices.values());

    if (query._id?.$in) {
      const allowed = new Set(query._id.$in.map((id) => id.toString()));
      results = results.filter((s) => allowed.has(s._id.toString()));
    }

    return {
      project: () => ({
        toArray: async () => results,
      }),
      toArray: async () => results,
    };
  },
};

// Hook into MongoDB Db instance
global._mongoClientPromise = Promise.resolve();
db.collection = (name) => {
  if (name === "barbers") return mockBarbersCollection;
  if (name === "services") return mockServicesCollection;
  throw new Error(`Unexpected collection in test: ${name}`);
};

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

// ----------------------------------------------------------------------------
// 3. Behavioral and Controller Tests
// ----------------------------------------------------------------------------

await asyncTest("Helper Unit: parseAndValidateServiceIds catches malformed and missing IDs", async () => {
  const resultMalformed = await parseAndValidateServiceIds(["not-a-valid-id", "12345"]);
  assert.equal(resultMalformed.valid, false);
  assert.ok(resultMalformed.message.includes("Invalid service ID format"));

  const nonExistentId = new ObjectId("65a000000000000000000099");
  const resultNonExistent = await parseAndValidateServiceIds([nonExistentId.toString()]);
  assert.equal(resultNonExistent.valid, false);
  assert.ok(resultNonExistent.message.includes("do not exist"));

  const resultValid = await parseAndValidateServiceIds([
    validServiceId1.toString(),
    validServiceId2.toString(),
  ]);
  assert.equal(resultValid.valid, true);
  assert.equal(resultValid.objectIds.length, 2);
});

await asyncTest("Controller Validation: createBarber rejects missing or invalid fields", async () => {
  // Test 1: missing name
  const req1 = { body: { designation: "Master Stylist", specialization: ["Fade"], experience: 5 } };
  const res1 = createMockResponse();
  await createBarber(req1, res1, () => {});
  assert.equal(res1.statusCode, 400);
  assert.ok(res1.body.message.includes("Barber name is required"));

  // Test 2: missing designation
  const req2 = { body: { name: "John Doe", designation: "", specialization: ["Fade"], experience: 5 } };
  const res2 = createMockResponse();
  await createBarber(req2, res2, () => {});
  assert.equal(res2.statusCode, 400);
  assert.ok(res2.body.message.includes("Designation is required"));

  // Test 3: empty specialization
  const req3 = { body: { name: "John Doe", designation: "Barber", specialization: [], experience: 5 } };
  const res3 = createMockResponse();
  await createBarber(req3, res3, () => {});
  assert.equal(res3.statusCode, 400);
  assert.ok(res3.body.message.includes("specialization is required"));

  // Test 4: invalid experience
  const req4 = { body: { name: "John Doe", designation: "Barber", specialization: ["Fade"], experience: -3 } };
  const res4 = createMockResponse();
  await createBarber(req4, res4, () => {});
  assert.equal(res4.statusCode, 400);
  assert.ok(res4.body.message.includes("Experience must be a valid non-negative number"));

  // Test 5: malformed serviceIds
  const req5 = {
    body: {
      name: "John Doe",
      designation: "Barber",
      specialization: ["Fade"],
      experience: 4,
      serviceIds: ["invalid-id"],
    },
  };
  const res5 = createMockResponse();
  await createBarber(req5, res5, () => {});
  assert.equal(res5.statusCode, 400);
  assert.ok(res5.body.message.includes("Invalid service ID format"));

  // Test 6: non-existent serviceId
  const req6 = {
    body: {
      name: "John Doe",
      designation: "Barber",
      specialization: ["Fade"],
      experience: 4,
      serviceIds: ["65a000000000000000000099"],
    },
  };
  const res6 = createMockResponse();
  await createBarber(req6, res6, () => {});
  assert.equal(res6.statusCode, 400);
  assert.ok(res6.body.message.includes("do not exist"));
});

let createdBarberId = null;

await asyncTest("Controller CRUD: createBarber inserts a new barber document", async () => {
  const req = {
    body: {
      name: "Alexander Hayes",
      image: "https://i.ibb.co/example/alex.jpg",
      designation: "Master Barber & Stylist",
      specialization: ["Skin Fade", "Beard Sculpting", "Hot Towel Shave"],
      experience: 10,
      bio: "Over a decade of master grooming expertise in luxury salons.",
      serviceIds: [validServiceId1.toString(), validServiceId2.toString()],
      isActive: true,
    },
  };
  const res = createMockResponse();
  await createBarber(req, res, () => {});

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Barber created successfully");

  const barber = res.body.data;
  assert.ok(barber._id);
  createdBarberId = barber._id;

  assert.equal(barber.name, "Alexander Hayes");
  assert.equal(barber.image, "https://i.ibb.co/example/alex.jpg");
  assert.equal(barber.designation, "Master Barber & Stylist");
  assert.deepEqual(barber.specialization, ["Skin Fade", "Beard Sculpting", "Hot Towel Shave"]);
  assert.equal(barber.experience, 10);
  assert.equal(barber.bio, "Over a decade of master grooming expertise in luxury salons.");
  assert.deepEqual(barber.serviceIds, [validServiceId1.toString(), validServiceId2.toString()]);
  assert.equal(barber.isActive, true);
  assert.ok(barber.createdAt);
  assert.ok(barber.updatedAt);
});

await asyncTest("Controller CRUD: getBarbers returns active barbers and supports filtering", async () => {
  // Public request -> should return active barbers
  const req1 = { query: {} };
  const res1 = createMockResponse();
  await getBarbers(req1, res1, () => {});

  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.success, true);
  assert.equal(res1.body.count, 1);
  assert.equal(res1.body.data[0]._id, createdBarberId);

  // Filter by matching serviceId
  const req2 = { query: { serviceId: validServiceId1.toString() } };
  const res2 = createMockResponse();
  await getBarbers(req2, res2, () => {});
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.count, 1);

  // Filter by non-matching serviceId
  const otherServiceId = new ObjectId("65a000000000000000000030");
  const req3 = { query: { serviceId: otherServiceId.toString() } };
  const res3 = createMockResponse();
  await getBarbers(req3, res3, () => {});
  assert.equal(res3.statusCode, 200);
  assert.equal(res3.body.count, 0);

  // Filter with invalid format
  const req4 = { query: { serviceId: "not-a-valid-id" } };
  const res4 = createMockResponse();
  await getBarbers(req4, res4, () => {});
  assert.equal(res4.statusCode, 400);
  assert.ok(res4.body.message.includes("Invalid service ID filter format"));
});

await asyncTest("Controller CRUD: getBarberById retrieves active barber by ObjectId", async () => {
  const req = { params: { id: createdBarberId }, query: {} };
  const res = createMockResponse();
  await getBarberById(req, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data._id, createdBarberId);
  assert.equal(res.body.data.name, "Alexander Hayes");

  // Invalid ID format returns 400
  const reqInvalid = { params: { id: "invalid-id" }, query: {} };
  const resInvalid = createMockResponse();
  await getBarberById(reqInvalid, resInvalid, () => {});
  assert.equal(resInvalid.statusCode, 400);

  // Non-existent ID returns 404
  const reqNotFound = { params: { id: new ObjectId().toString() }, query: {} };
  const resNotFound = createMockResponse();
  await getBarberById(reqNotFound, resNotFound, () => {});
  assert.equal(resNotFound.statusCode, 404);
});

await asyncTest("Controller CRUD: updateBarber modifies existing barber", async () => {
  const req = {
    params: { id: createdBarberId },
    body: {
      designation: "Executive Master Barber",
      experience: 12,
      bio: "Over 12 years of executive styling.",
    },
  };
  const res = createMockResponse();
  await updateBarber(req, res, () => {});

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Barber updated successfully");
  assert.equal(res.body.data.designation, "Executive Master Barber");
  assert.equal(res.body.data.experience, 12);
  assert.equal(res.body.data.bio, "Over 12 years of executive styling.");
  // Preserved other fields
  assert.equal(res.body.data.name, "Alexander Hayes");
});

await asyncTest("Controller CRUD: updateBarberStatus toggles active state and enforces visibility rules", async () => {
  // Deactivate barber
  const reqDeactivate = {
    params: { id: createdBarberId },
    body: { isActive: false },
  };
  const resDeactivate = createMockResponse();
  await updateBarberStatus(reqDeactivate, resDeactivate, () => {});

  assert.equal(resDeactivate.statusCode, 200);
  assert.equal(resDeactivate.body.data.isActive, false);

  // Public getBarbers should now return 0 active barbers
  const reqPublicList = { query: {} };
  const resPublicList = createMockResponse();
  await getBarbers(reqPublicList, resPublicList, () => {});
  assert.equal(resPublicList.body.count, 0);

  // Public getBarberById should return 404 for inactive barber
  const reqPublicGet = { params: { id: createdBarberId }, query: {} };
  const resPublicGet = createMockResponse();
  await getBarberById(reqPublicGet, resPublicGet, () => {});
  assert.equal(resPublicGet.statusCode, 404);

  // Admin getBarberById should return 200 for inactive barber
  const reqAdminGet = {
    params: { id: createdBarberId },
    query: {},
    user: { role: "admin" },
  };
  const resAdminGet = createMockResponse();
  await getBarberById(reqAdminGet, resAdminGet, () => {});
  assert.equal(resAdminGet.statusCode, 200);
  assert.equal(resAdminGet.body.data.isActive, false);

  // Admin getBarbers with status=all should return inactive barber
  const reqAdminList = {
    query: { status: "all" },
    user: { role: "admin" },
  };
  const resAdminList = createMockResponse();
  await getBarbers(reqAdminList, resAdminList, () => {});
  assert.equal(resAdminList.body.count, 1);

  // Reactivate barber using status="active"
  const reqReactivate = {
    params: { id: createdBarberId },
    body: { status: "active" },
  };
  const resReactivate = createMockResponse();
  await updateBarberStatus(reqReactivate, resReactivate, () => {});
  assert.equal(resReactivate.statusCode, 200);
  assert.equal(resReactivate.body.data.isActive, true);
});

await asyncTest("Controller CRUD: deleteBarber removes barber from database", async () => {
  const reqDelete = { params: { id: createdBarberId } };
  const resDelete = createMockResponse();
  await deleteBarber(reqDelete, resDelete, () => {});

  assert.equal(resDelete.statusCode, 200);
  assert.equal(resDelete.body.success, true);
  assert.equal(resDelete.body.message, "Barber deleted successfully");

  // Subsequent getBarberById should return 404
  const reqGet = { params: { id: createdBarberId }, query: {} };
  const resGet = createMockResponse();
  await getBarberById(reqGet, resGet, () => {});
  assert.equal(resGet.statusCode, 404);

  // Subsequent deleteBarber should return 404
  const resDelete2 = createMockResponse();
  await deleteBarber(reqDelete, resDelete2, () => {});
  assert.equal(resDelete2.statusCode, 404);
});

console.log(`\n=== ALL ${passedTests} / ${totalTests} BARBER TESTS PASSED SUCCESSFULLY ===`);
process.exit(0);
