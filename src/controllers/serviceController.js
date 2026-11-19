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
    if (isAdmin && (status === "all" || all === "true")) {
      // No isActive filter: show all
    } else if (isAdmin && status === "inactive") {
      filter.isActive = false;
    } else {
      filter.isActive = true;
    }

    // Search by name (case-insensitive, multi-keyword search supporting space or +)
    if (search && typeof search === "string" && search.trim()) {
      const normalizedSearch = search.replace(/\+/g, " ").trim();
      const words = normalizedSearch.split(/\s+/).filter(Boolean);
      if (words.length === 1) {
        filter.name = { $regex: escapeRegex(words[0]), $options: "i" };
      } else if (words.length > 1) {
        filter.$and = words.map((w) => ({
          name: { $regex: escapeRegex(w), $options: "i" },
        }));
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
      data: services,
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
    if (!service.isActive && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: "Service not found or is currently unavailable",
      });
    }

    res.status(200).json({
      success: true,
      data: service,
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
      slug: customSlug,
      description,
      shortDescription,
      category,
      price,
      duration,
      image,
      isActive,
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Service name is required (minimum 2 characters)",
      });
    }

    if (!description || typeof description !== "string" || description.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: "Service description is required (minimum 5 characters)",
      });
    }

    if (!category || typeof category !== "string" || category.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Service category is required",
      });
    }

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
      : slugify(name);

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

    const now = new Date();
    const newService = {
      name: name.trim(),
      slug: generatedSlug,
      description: description.trim(),
      shortDescription: shortDescription && typeof shortDescription === "string"
        ? shortDescription.trim()
        : "",
      category: category.trim(),
      price: numPrice,
      duration: numDuration,
      image: image && typeof image === "string" ? image.trim() : "",
      isActive: typeof isActive === "boolean" ? isActive : true,
      createdAt: now,
      updatedAt: now,
    };

    const result = await collection.insertOne(newService);

    res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: {
        _id: result.insertedId,
        ...newService,
      },
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
      slug: customSlug,
      description,
      shortDescription,
      category,
      price,
      duration,
      image,
      isActive,
    } = req.body;

    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Service name must be at least 2 characters",
        });
      }
      updates.name = name.trim();
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

    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "isActive must be a boolean",
        });
      }
      updates.isActive = isActive;
    }

    // Slug management: if customSlug is provided or name changed, check uniqueness
    if (customSlug !== undefined || (name !== undefined && name.trim() !== existing.name)) {
      const targetSlug = customSlug ? slugify(customSlug) : slugify(name);

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
      data: updatedService,
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
 */
export const updateServiceStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean value (true or false)",
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
          isActive,
          updatedAt: new Date(),
        },
      }
    );

    const updatedService = await collection.findOne({ _id: new ObjectId(id) });

    res.status(200).json({
      success: true,
      message: `Service ${isActive ? "activated" : "deactivated"} successfully`,
      data: updatedService,
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
