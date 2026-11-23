import { ObjectId } from "mongodb";
import { db, connectDB } from "../config/db.js";
import { uploadFileToImgBB } from "./uploadController.js";

let indexesInitialized = false;

/**
 * Accesses the barbers collection and ensures essential indexes exist.
 */
export const getBarbersCollection = async () => {
  await connectDB();
  const collection = db.collection("barbers");

  if (!indexesInitialized) {
    try {
      await collection.createIndex({ isActive: 1 });
      await collection.createIndex({ serviceIds: 1 });
      indexesInitialized = true;
    } catch (err) {
      if (err.code !== 85) {
        console.warn("[Barbers Collection] Index notice:", err.message);
      }
    }
  }

  return collection;
};

/**
 * Escapes characters with special meaning in regular expressions to prevent ReDoS.
 */
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Helper to safely parse array of specialization strings from JSON, string, or Array.
 */
export const parseSpecialization = (input) => {
  if (!input) return [];

  let rawList = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) rawList = parsed;
      } catch {
        rawList = trimmed.split(",");
      }
    } else {
      rawList = trimmed.split(",");
    }
  }

  if (Array.isArray(rawList)) {
    return rawList
      .map((item) => (typeof item === "string" ? item.trim() : String(item).trim()))
      .filter((item) => item.length > 0);
  }

  return [];
};

/**
 * Helper to safely parse and validate serviceIds array.
 * Returns { valid: true, objectIds: ObjectId[] } or { valid: false, message: string }.
 */
export const parseAndValidateServiceIds = async (input) => {
  if (input === undefined || input === null) {
    return { valid: true, objectIds: [] };
  }

  let rawList = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed === "" || trimmed === "[]") {
      return { valid: true, objectIds: [] };
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) rawList = parsed;
      } catch {
        rawList = trimmed.split(",");
      }
    } else {
      rawList = trimmed.split(",");
    }
  }

  if (!Array.isArray(rawList)) {
    return {
      valid: false,
      message: "serviceIds must be an array of valid MongoDB service IDs",
    };
  }

  const cleanedIds = rawList
    .map((item) => (typeof item === "string" ? item.trim() : String(item).trim()))
    .filter((item) => item.length > 0);

  if (cleanedIds.length === 0) {
    return { valid: true, objectIds: [] };
  }

  const invalidFormats = [];
  const objectIds = [];

  for (const idStr of cleanedIds) {
    if (ObjectId.isValid(idStr) && new ObjectId(idStr).toString() === idStr) {
      objectIds.push(new ObjectId(idStr));
    } else {
      invalidFormats.push(idStr);
    }
  }

  if (invalidFormats.length > 0) {
    return {
      valid: false,
      message: `Invalid service ID format: ${invalidFormats.join(", ")}`,
    };
  }

  // Verify all provided serviceIds exist in the services collection
  await connectDB();
  const servicesCollection = db.collection("services");
  const existingServices = await servicesCollection
    .find({ _id: { $in: objectIds } })
    .project({ _id: 1 })
    .toArray();

  if (existingServices.length !== objectIds.length) {
    const foundIdStrings = new Set(existingServices.map((s) => s._id.toString()));
    const missingIds = objectIds
      .filter((oid) => !foundIdStrings.has(oid.toString()))
      .map((oid) => oid.toString());

    return {
      valid: false,
      message: `One or more referenced services do not exist: ${missingIds.join(", ")}`,
    };
  }

  return { valid: true, objectIds };
};

/**
 * Formats a barber document for clean and consistent API responses.
 */
export const formatBarber = (barber) => {
  if (!barber || typeof barber !== "object") return barber;

  const serviceIdStrings = Array.isArray(barber.serviceIds)
    ? barber.serviceIds.map((id) => (id instanceof ObjectId ? id.toString() : String(id)))
    : [];

  const formatted = {
    _id: barber._id ? barber._id.toString() : barber.id,
    name: barber.name || "",
    image: barber.image || "",
    designation: barber.designation || "",
    specialization: Array.isArray(barber.specialization) ? barber.specialization : [],
    experience: typeof barber.experience === "number" ? barber.experience : Number(barber.experience) || 0,
    bio: barber.bio || "",
    serviceIds: serviceIdStrings,
    isActive: typeof barber.isActive === "boolean" ? barber.isActive : true,
    createdAt: barber.createdAt,
    updatedAt: barber.updatedAt,
  };

  if (barber.services && Array.isArray(barber.services)) {
    formatted.services = barber.services;
  }

  return formatted;
};

/**
 * GET /api/barbers (Public)
 * Returns active barbers with optional service filtering, search, and service population.
 * Admin users can pass status=all or all=true to view inactive barbers as well.
 */
export const getBarbers = async (req, res, next) => {
  try {
    const { serviceId, search, status, all, populate, includeServices } = req.query;

    const filter = {};

    // Filter by serviceId
    if (serviceId && typeof serviceId === "string" && serviceId.trim()) {
      const cleanServiceId = serviceId.trim();
      if (!ObjectId.isValid(cleanServiceId) || new ObjectId(cleanServiceId).toString() !== cleanServiceId) {
        return res.status(400).json({
          success: false,
          message: "Invalid service ID filter format",
        });
      }
      filter.serviceIds = new ObjectId(cleanServiceId);
    }

    const collection = await getBarbersCollection();

    // Inactive barbers are hidden from public users.
    // Authenticated admins passing status="all" or all="true" can see all barbers.
    const isAdmin = req.user?.role === "admin";
    const statusQuery = (status || "").toLowerCase().trim();

    if (isAdmin && (statusQuery === "all" || all === "true")) {
      // No isActive filter: show all
    } else if (isAdmin && (statusQuery === "inactive" || req.query.isActive === "false")) {
      filter.isActive = false;
    } else {
      filter.isActive = true;
    }

    // Search by name, designation, or specialization keyword
    if (search && typeof search === "string" && search.trim()) {
      const normalizedSearch = search.replace(/\+/g, " ").trim();
      const escaped = escapeRegex(normalizedSearch);
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { designation: { $regex: escaped, $options: "i" } },
        { specialization: { $regex: escaped, $options: "i" } },
      ];
    }

    const barbers = await collection.find(filter).sort({ createdAt: -1 }).toArray();

    // Optionally populate referenced service documents
    const shouldPopulateServices =
      populate === "services" || populate === "true" || includeServices === "true";

    if (shouldPopulateServices && barbers.length > 0) {
      const allServiceIds = [
        ...new Set(
          barbers
            .flatMap((b) => b.serviceIds || [])
            .map((id) => (id instanceof ObjectId ? id.toString() : String(id)))
        ),
      ].filter((id) => ObjectId.isValid(id));

      if (allServiceIds.length > 0) {
        await connectDB();
        const services = await db
          .collection("services")
          .find({ _id: { $in: allServiceIds.map((id) => new ObjectId(id)) } })
          .toArray();

        const serviceMap = new Map(services.map((s) => [s._id.toString(), s]));

        for (const barber of barbers) {
          barber.services = (barber.serviceIds || [])
            .map((id) => serviceMap.get(id.toString()))
            .filter(Boolean);
        }
      }
    }

    res.status(200).json({
      success: true,
      count: barbers.length,
      data: barbers.map(formatBarber),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/barbers/:id (Public)
 * Returns an individual active barber by ObjectId.
 * Inactive barbers are returned only if requester is an authenticated admin.
 */
export const getBarberById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid barber ID format",
      });
    }

    const collection = await getBarbersCollection();
    const barber = await collection.findOne({ _id: new ObjectId(id) });

    if (!barber) {
      return res.status(404).json({
        success: false,
        message: "Barber not found",
      });
    }

    const isAdmin = req.user?.role === "admin";
    if (barber.isActive === false && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: "Barber not found or is currently inactive",
      });
    }

    const { populate, includeServices } = req.query;
    const shouldPopulateServices =
      populate === "services" || populate === "true" || includeServices === "true";

    if (shouldPopulateServices && Array.isArray(barber.serviceIds) && barber.serviceIds.length > 0) {
      await connectDB();
      const services = await db
        .collection("services")
        .find({ _id: { $in: barber.serviceIds } })
        .toArray();
      barber.services = services;
    }

    res.status(200).json({
      success: true,
      data: formatBarber(barber),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/barbers (Admin Only)
 * Creates a new barber document with validation, optional image upload/URL,
 * and serviceIds verification against the services collection.
 */
export const createBarber = async (req, res, next) => {
  try {
    const {
      name,
      designation,
      specialization,
      experience,
      bio,
      serviceIds,
      isActive,
      image,
    } = req.body;

    // Validate required barber name
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Barber name is required (minimum 2 characters)",
      });
    }

    // Validate required designation
    if (!designation || typeof designation !== "string" || designation.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Designation is required (minimum 2 characters, e.g. 'Master Stylist')",
      });
    }

    // Parse and validate specialization array
    const parsedSpecializations = parseSpecialization(specialization);
    if (parsedSpecializations.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one specialization is required (e.g. ['Haircut', 'Beard Trim'])",
      });
    }

    // Validate experience (must be non-negative number)
    const numExperience = Number(experience);
    if (experience === undefined || experience === null || isNaN(numExperience) || numExperience < 0) {
      return res.status(400).json({
        success: false,
        message: "Experience must be a valid non-negative number (in years)",
      });
    }

    // Validate serviceIds
    const serviceValidation = await parseAndValidateServiceIds(serviceIds);
    if (!serviceValidation.valid) {
      return res.status(400).json({
        success: false,
        message: serviceValidation.message,
      });
    }

    // Handle image: multipart file upload via ImgBB or direct image URL string
    let imageUrl = "";
    if (req.file) {
      try {
        const uploadResult = await uploadFileToImgBB(req.file);
        imageUrl = uploadResult.url || uploadResult.displayUrl || "";
      } catch (uploadErr) {
        return res.status(uploadErr.statusCode || 502).json({
          success: false,
          message: uploadErr.message || "Failed to upload barber image to ImgBB",
        });
      }
    } else if (image && typeof image === "string" && image.trim().length > 0) {
      imageUrl = image.trim();
    }

    // Active state defaults to true
    let activeFlag = true;
    if (typeof isActive === "boolean") {
      activeFlag = isActive;
    } else if (typeof isActive === "string") {
      const lower = isActive.trim().toLowerCase();
      if (lower === "false" || lower === "0" || lower === "inactive") {
        activeFlag = false;
      }
    }

    const now = new Date();
    const newBarber = {
      name: name.trim(),
      image: imageUrl,
      designation: designation.trim(),
      specialization: parsedSpecializations,
      experience: numExperience,
      bio: typeof bio === "string" ? bio.trim() : "",
      serviceIds: serviceValidation.objectIds,
      isActive: activeFlag,
      createdAt: now,
      updatedAt: now,
    };

    const collection = await getBarbersCollection();
    const result = await collection.insertOne(newBarber);

    res.status(201).json({
      success: true,
      message: "Barber created successfully",
      data: formatBarber({
        _id: result.insertedId,
        ...newBarber,
      }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/barbers/:id (Admin Only)
 * Updates an existing barber document with field validation and serviceIds check.
 */
export const updateBarber = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid barber ID format",
      });
    }

    const collection = await getBarbersCollection();
    const existing = await collection.findOne({ _id: new ObjectId(id) });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Barber not found",
      });
    }

    const {
      name,
      designation,
      specialization,
      experience,
      bio,
      serviceIds,
      isActive,
      image,
    } = req.body;

    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Barber name must be at least 2 characters",
        });
      }
      updates.name = name.trim();
    }

    if (designation !== undefined) {
      if (typeof designation !== "string" || designation.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Designation must be at least 2 characters",
        });
      }
      updates.designation = designation.trim();
    }

    if (specialization !== undefined) {
      const parsed = parseSpecialization(specialization);
      if (parsed.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one specialization is required",
        });
      }
      updates.specialization = parsed;
    }

    if (experience !== undefined) {
      const numExperience = Number(experience);
      if (isNaN(numExperience) || numExperience < 0) {
        return res.status(400).json({
          success: false,
          message: "Experience must be a valid non-negative number",
        });
      }
      updates.experience = numExperience;
    }

    if (bio !== undefined) {
      updates.bio = typeof bio === "string" ? bio.trim() : "";
    }

    if (serviceIds !== undefined) {
      const serviceValidation = await parseAndValidateServiceIds(serviceIds);
      if (!serviceValidation.valid) {
        return res.status(400).json({
          success: false,
          message: serviceValidation.message,
        });
      }
      updates.serviceIds = serviceValidation.objectIds;
    }

    if (isActive !== undefined) {
      if (typeof isActive === "boolean") {
        updates.isActive = isActive;
      } else if (typeof isActive === "string") {
        const lower = isActive.trim().toLowerCase();
        updates.isActive = lower === "true" || lower === "1" || lower === "active";
      } else {
        return res.status(400).json({
          success: false,
          message: "isActive must be a boolean",
        });
      }
    }

    // Handle image file or string URL
    if (req.file) {
      try {
        const uploadResult = await uploadFileToImgBB(req.file);
        updates.image = uploadResult.url || uploadResult.displayUrl || "";
      } catch (uploadErr) {
        return res.status(uploadErr.statusCode || 502).json({
          success: false,
          message: uploadErr.message || "Failed to upload barber image to ImgBB",
        });
      }
    } else if (image !== undefined) {
      updates.image = typeof image === "string" ? image.trim() : "";
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    updates.updatedAt = new Date();

    await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );

    const updatedBarber = await collection.findOne({ _id: new ObjectId(id) });

    res.status(200).json({
      success: true,
      message: "Barber updated successfully",
      data: formatBarber(updatedBarber),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/barbers/:id/status (Admin Only)
 * Toggles or updates the active status of a barber.
 * Accepts { isActive: boolean } or { status: "active" | "inactive" }.
 */
export const updateBarberStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid barber ID format",
      });
    }

    let newActiveState;
    if (typeof status === "string") {
      const s = status.toLowerCase().trim();
      if (s === "active") newActiveState = true;
      else if (s === "inactive") newActiveState = false;
      else {
        return res.status(400).json({
          success: false,
          message: "Status must be either 'active' or 'inactive'",
        });
      }
    } else if (typeof isActive === "boolean") {
      newActiveState = isActive;
    } else if (typeof isActive === "string") {
      const lower = isActive.trim().toLowerCase();
      if (lower === "true" || lower === "1") newActiveState = true;
      else if (lower === "false" || lower === "0") newActiveState = false;
      else {
        return res.status(400).json({
          success: false,
          message: "isActive must be a boolean",
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "Please provide either isActive (boolean) or status ('active' | 'inactive')",
      });
    }

    const collection = await getBarbersCollection();
    const existing = await collection.findOne({ _id: new ObjectId(id) });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Barber not found",
      });
    }

    await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          isActive: newActiveState,
          updatedAt: new Date(),
        },
      }
    );

    const updatedBarber = await collection.findOne({ _id: new ObjectId(id) });

    res.status(200).json({
      success: true,
      message: `Barber ${newActiveState ? "activated" : "deactivated"} successfully`,
      data: formatBarber(updatedBarber),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/barbers/:id (Admin Only)
 * Deletes a barber document from the database.
 */
export const deleteBarber = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid barber ID format",
      });
    }

    const collection = await getBarbersCollection();
    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Barber not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Barber deleted successfully",
      data: { id },
    });
  } catch (error) {
    next(error);
  }
};
