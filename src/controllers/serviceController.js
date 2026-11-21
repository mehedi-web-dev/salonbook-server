import { ObjectId } from "mongodb";
import { db, connectDB } from "../config/db.js";
import { slugify } from "../utils/slugify.js";

let indexInitialized = false;

/**
 * Accesses the services collection and ensures the unique slug index exists.
 */
export const getServicesCollection = async () => {
  await connectDB();
  const collection = db.collection("services");

  if (!indexInitialized) {
    try {
      await collection.createIndex({ slug: 1 }, { unique: true });
      indexInitialized = true;
    } catch (err) {
      if (err.code !== 85) {
        console.warn("[Services Collection] Index notice:", err.message);
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
 * Formats a service document for API responses, ensuring backward-compatible
 * exposure of both assignment field names (serviceName, status) and
 * original field names (name, isActive).
 */
export const formatService = (service) => {
  if (!service || typeof service !== "object") return service;
  const name = service.name || service.serviceName || "";
  const isActive = typeof service.isActive === "boolean"
    ? service.isActive
    : service.status === "active";
  const status = isActive ? "active" : "inactive";

  return {
    ...service,
    name,
    serviceName: name,
    isActive,
    status,
  };
};

/**
 * GET /api/services (Public with optional Admin filtering)
 * Supports search, category filter, price sorting, and pagination.
 */
export const getAllServices = async (req, res, next) => {
  try {
    const collection = await getServicesCollection();
    const {
      search,
      category,
      sort,
      sortBy,
      sortOrder,
      minPrice,
      maxPrice,
      status,
      all,
    } = req.query;

    const filter = {};

    // Inactive services are hidden from public users.
    // Only authenticated admins passing status="all" or all="true" can see inactive services.
    const isAdmin = req.user?.role === "admin";
    const statusQuery = (status || "").toLowerCase().trim();
    if (isAdmin && (statusQuery === "all" || all === "true")) {
      // No isActive filter: show all
    } else if (isAdmin && (statusQuery === "inactive" || req.query.isActive === "false")) {
      filter.$or = [{ isActive: false }, { status: "inactive" }];
    } else {
      filter.$or = [
        { isActive: true },
        { isActive: { $exists: false }, status: "active" },
        { isActive: { $exists: false }, status: { $exists: false } },
      ];
    }

    // Search by name / serviceName (case-insensitive, multi-keyword search supporting space or +)
    if (search && typeof search === "string" && search.trim()) {
      const normalizedSearch = search.replace(/\+/g, " ").trim();
      const words = normalizedSearch.split(/\s+/).filter(Boolean);
      const makeWordCondition = (w) => ({
        $or: [
          { name: { $regex: escapeRegex(w), $options: "i" } },
          { serviceName: { $regex: escapeRegex(w), $options: "i" } },
        ],
      });
      if (words.length === 1) {
        filter.$and = filter.$and || [];
        filter.$and.push(makeWordCondition(words[0]));
      } else if (words.length > 1) {
        filter.$and = filter.$and || [];
        for (const w of words) {
          filter.$and.push(makeWordCondition(w));
        }
      }
    }

    // Filter by category (case-insensitive exact match)
    if (category && typeof category === "string" && category.trim()) {
      filter.category = {
        $regex: `^${escapeRegex(category.trim())}$`,
        $options: "i",
      };
    }

    // Filter by price range
    const parsedMinPrice = minPrice !== undefined ? Number(minPrice) : null;
    const parsedMaxPrice = maxPrice !== undefined ? Number(maxPrice) : null;

    if (
      (parsedMinPrice !== null && !isNaN(parsedMinPrice)) ||
      (parsedMaxPrice !== null && !isNaN(parsedMaxPrice))
    ) {
      filter.price = {};
      if (parsedMinPrice !== null && !isNaN(parsedMinPrice)) {
        filter.price.$gte = Math.max(0, parsedMinPrice);
      }
      if (parsedMaxPrice !== null && !isNaN(parsedMaxPrice)) {
        filter.price.$lte = Math.max(0, parsedMaxPrice);
      }
    }

    // Sorting options
    let sortOptions = { createdAt: -1 }; // default: newest first

    const effectiveSort = (sort || "").toLowerCase();
    const effectiveSortBy = (sortBy || "").toLowerCase();
    const effectiveOrder = (sortOrder || "").toLowerCase();

    if (
      effectiveSort === "price_asc" ||
      effectiveSort === "asc" ||
      (effectiveSortBy === "price" && effectiveOrder === "asc")
    ) {
      sortOptions = { price: 1 };
    } else if (
      effectiveSort === "price_desc" ||
      effectiveSort === "desc" ||
      (effectiveSortBy === "price" && effectiveOrder === "desc")
    ) {
      sortOptions = { price: -1 };
    } else if (
      effectiveSort === "name_asc" ||
      (effectiveSortBy === "name" && effectiveOrder === "asc")
    ) {
      sortOptions = { name: 1 };
    } else if (
      effectiveSort === "name_desc" ||
      (effectiveSortBy === "name" && effectiveOrder === "desc")
    ) {
      sortOptions = { name: -1 };
    } else if (effectiveSort === "oldest") {
      sortOptions = { createdAt: 1 };
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const total = await collection.countDocuments(filter);
    const services = await collection
      .find(filter)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.status(200).json({
      success: true,
      count: services.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: services.map(formatService),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/services/:id (Public)
 * Returns a single active service by its MongoDB ObjectId.
 */
export const getServiceById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
      });
    }

    const collection = await getServicesCollection();
    const service = await collection.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    // Inactive services are hidden from public users unless requester is an admin
    const isAdmin = req.user?.role === "admin";
    const isServiceActive = service.isActive !== false && service.status !== "inactive";
    if (!isServiceActive && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: "Service not found or is currently unavailable",
      });
    }

    res.status(200).json({
      success: true,
      data: formatService(service),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/services (Admin Only)
 * Creates a new salon service with validation and unique slug.
 */
export const createService = async (req, res, next) => {
  try {
    const {
      name,
      serviceName,
      slug: customSlug,
      description,
      shortDescription,
      category,
      price,
      duration,
      image,
      isActive,
      status,
    } = req.body;

    // Validate required fields (supports name or serviceName)
    const effectiveName = (typeof serviceName === "string" && serviceName.trim())
      ? serviceName.trim()
      : (typeof name === "string" ? name.trim() : "");

    if (!effectiveName || effectiveName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Service name is required (minimum 2 characters)",
      });
    }

    const effectiveDescription =
      typeof description === "string" && description.trim().length >= 5
        ? description.trim()
        : typeof shortDescription === "string" && shortDescription.trim().length >= 5
        ? shortDescription.trim()
        : `${effectiveName} treatment and salon care service`;

    const effectiveCategory =
      typeof category === "string" && category.trim().length >= 2
        ? category.trim()
        : "General";

    const numPrice = Number(price);
    if (price === undefined || isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid non-negative number",
      });
    }

    const numDuration = Number(duration);
    if (duration === undefined || isNaN(numDuration) || numDuration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Duration must be a positive number of minutes (greater than 0)",
      });
    }

    // Determine slug
    const generatedSlug = customSlug && typeof customSlug === "string"
      ? slugify(customSlug)
      : slugify(effectiveName);

    if (!generatedSlug) {
      return res.status(400).json({
        success: false,
        message: "Could not generate a valid URL slug from the provided name",
      });
    }

    const collection = await getServicesCollection();

    // Check for duplicate slug
    const existingSlug = await collection.findOne({ slug: generatedSlug });
    if (existingSlug) {
      return res.status(409).json({
        success: false,
        message: `A service with the slug '${generatedSlug}' already exists. Please choose a different name or slug.`,
      });
    }

    // Determine active state (supports isActive boolean or status "active"|"inactive")
    let activeFlag = true;
    if (typeof isActive === "boolean") {
      activeFlag = isActive;
    } else if (typeof status === "string") {
      activeFlag = status.toLowerCase().trim() === "active";
    }

    const now = new Date();
    const newService = {
      name: effectiveName,
      serviceName: effectiveName,
      slug: generatedSlug,
      description: effectiveDescription,
      shortDescription: shortDescription && typeof shortDescription === "string"
        ? shortDescription.trim()
        : "",
      category: effectiveCategory,
      price: numPrice,
      duration: numDuration,
      image: image && typeof image === "string" ? image.trim() : "",
      isActive: activeFlag,
      status: activeFlag ? "active" : "inactive",
      createdAt: now,
      updatedAt: now,
    };

    const result = await collection.insertOne(newService);

    res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: formatService({
        _id: result.insertedId,
        ...newService,
      }),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate key conflict: A service with this slug already exists",
      });
    }
    next(error);
  }
};

/**
 * PATCH /api/services/:id (Admin Only)
 * Updates an existing service with validation and slug conflict protection.
 */
export const updateService = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
      });
    }

    const collection = await getServicesCollection();
    const existing = await collection.findOne({ _id: new ObjectId(id) });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    const {
      name,
      serviceName,
      slug: customSlug,
      description,
      shortDescription,
      category,
      price,
      duration,
      image,
      isActive,
      status,
    } = req.body;

    const updates = {};

    const inputName = serviceName !== undefined ? serviceName : name;
    if (inputName !== undefined) {
      if (typeof inputName !== "string" || inputName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Service name must be at least 2 characters",
        });
      }
      updates.name = inputName.trim();
      updates.serviceName = inputName.trim();
    }

    if (description !== undefined) {
      if (typeof description !== "string" || description.trim().length < 5) {
        return res.status(400).json({
          success: false,
          message: "Service description must be at least 5 characters",
        });
      }
      updates.description = description.trim();
    }

    if (shortDescription !== undefined) {
      updates.shortDescription = typeof shortDescription === "string" ? shortDescription.trim() : "";
    }

    if (category !== undefined) {
      if (typeof category !== "string" || category.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Category must be at least 2 characters",
        });
      }
      updates.category = category.trim();
    }

    if (price !== undefined) {
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Price must be a valid non-negative number",
        });
      }
      updates.price = numPrice;
    }

    if (duration !== undefined) {
      const numDuration = Number(duration);
      if (isNaN(numDuration) || numDuration <= 0) {
        return res.status(400).json({
          success: false,
          message: "Duration must be a positive number of minutes (greater than 0)",
        });
      }
      updates.duration = numDuration;
    }

    if (image !== undefined) {
      updates.image = typeof image === "string" ? image.trim() : "";
    }

    if (status !== undefined) {
      if (typeof status === "string") {
        const s = status.toLowerCase().trim();
        if (s === "active" || s === "inactive") {
          updates.status = s;
          updates.isActive = s === "active";
        } else {
          return res.status(400).json({
            success: false,
            message: "Status must be either 'active' or 'inactive'",
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: "Status must be a string ('active' or 'inactive')",
        });
      }
    } else if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "isActive must be a boolean",
        });
      }
      updates.isActive = isActive;
      updates.status = isActive ? "active" : "inactive";
    }

    // Slug management: if customSlug is provided or name changed, check uniqueness
    const currentName = existing.name || existing.serviceName;
    if (customSlug !== undefined || (inputName !== undefined && inputName.trim() !== currentName)) {
      const targetSlug = customSlug ? slugify(customSlug) : slugify(inputName);

      if (!targetSlug) {
        return res.status(400).json({
          success: false,
          message: "Invalid slug value",
        });
      }

      if (targetSlug !== existing.slug) {
        const slugConflict = await collection.findOne({
          slug: targetSlug,
          _id: { $ne: new ObjectId(id) },
        });

        if (slugConflict) {
          return res.status(409).json({
            success: false,
            message: `A service with the slug '${targetSlug}' already exists`,
          });
        }

        updates.slug = targetSlug;
      }
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

    const updatedService = await collection.findOne({ _id: new ObjectId(id) });

    res.status(200).json({
      success: true,
      message: "Service updated successfully",
      data: formatService(updatedService),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate key conflict: A service with this slug already exists",
      });
    }
    next(error);
  }
};

/**
 * PATCH /api/services/:id/status (Admin Only)
 * Toggles or updates the active status of a service.
 * Supports status ("active" | "inactive") or isActive (boolean).
 */
export const updateServiceStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
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
    } else {
      return res.status(400).json({
        success: false,
        message: "Please provide either status ('active' | 'inactive') or isActive (boolean)",
      });
    }

    const collection = await getServicesCollection();
    const existing = await collection.findOne({ _id: new ObjectId(id) });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          isActive: newActiveState,
          status: newActiveState ? "active" : "inactive",
          updatedAt: new Date(),
        },
      }
    );

    const updatedService = await collection.findOne({ _id: new ObjectId(id) });

    res.status(200).json({
      success: true,
      message: `Service ${newActiveState ? "activated" : "deactivated"} successfully`,
      data: formatService(updatedService),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/services/:id (Admin Only)
 * Removes a service from the database.
 */
export const deleteService = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
      });
    }

    const collection = await getServicesCollection();
    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Service deleted successfully",
      data: { id },
    });
  } catch (error) {
    next(error);
  }
};
