import { Driver } from "../db/schema.js";

export async function upsertDriver(driver) {
  const update = {
    name: driver.name,
    phone: driver.phone,
    vehicle: driver.vehicle,
    licensePlate: driver.licensePlate,
    isAvailable: driver.isAvailable,
    currentLocation: driver.currentLocation,
    locationUpdatedAt: driver.locationUpdatedAt,
    rating: driver.rating,
    totalDeliveries: driver.totalDeliveries,
    updatedAt: new Date(),
  };

  Object.keys(update).forEach(
    (key) => update[key] === undefined && delete update[key]
  );

  await Driver.findByIdAndUpdate(
    driver.driverId, // Use driverId as _id
    { $set: update, $setOnInsert: { createdAt: driver.createdAt || new Date() } },
    { upsert: true, new: true }
  );
}

export async function updateDriverAvailability(driverId, isAvailable) {
  await Driver.findByIdAndUpdate(driverId, {
    isAvailable,
    updatedAt: new Date(),
  });
}

export async function getDriverAvailability(driverId) {
  const driver = await Driver.findById(driverId).select("isAvailable");
  return driver ? driver.toObject() : null;
}

export async function getDriver(driverId) {
  const driver = await Driver.findById(driverId);
  if (!driver) return null;

  return driver.toObject();
}

export async function getDriverByUserId(userId) {
  return getDriver(userId);
}

export async function getDrivers(filters = {}) {
  const query = {};
  if (filters.isAvailable !== undefined) {
    query.isAvailable = filters.isAvailable;
  }

  let q = Driver.find(query).sort({ rating: -1, totalDeliveries: -1 });

  if (filters.limit) {
    q = q.limit(Number(filters.limit));
  }

  const drivers = await q;
  return drivers.map(driver => {
    const driverObject = driver.toObject();
    return driverObject;
  });
}

/**
 * Get available drivers near a location using MongoDB $near geospatial query.
 * Results are automatically sorted by distance (nearest first).
 * Only returns drivers with fresh location data (not stale).
 *
 * @param {number} longitude - Restaurant longitude
 * @param {number} latitude - Restaurant latitude
 * @param {number} radiusKm - Search radius in kilometers
 * @param {Array} excludeDriverIds - Driver IDs to exclude (e.g., declined drivers)
 * @returns {Array} - Drivers sorted by distance from the location
 */
export async function getAvailableDriversNear(
  longitude,
  latitude,
  radiusKm,
  excludeDriverIds = []
) {
  const staleMinutes = parseInt(process.env.DRIVER_LOCATION_STALE_MINUTES || "15", 10);
  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000);

  const query = {
    isAvailable: true,
    currentLocation: {
      $near: {
        $geometry: { type: "Point", coordinates: [longitude, latitude] },
        $maxDistance: radiusKm * 1000, // Convert km to meters
      },
    },
    locationUpdatedAt: { $gte: staleThreshold },
  };

  if (excludeDriverIds.length > 0) {
    query._id = { $nin: excludeDriverIds };
  }

  const drivers = await Driver.find(query);
  return drivers.map((driver) => driver.toObject());
}

/**
 * Update a driver's live GPS location.
 *
 * @param {string} driverId - Driver ID (same as user ID)
 * @param {number} longitude - New longitude
 * @param {number} latitude - New latitude
 * @returns {Object} - Updated driver document
 */
export async function updateDriverLocation(driverId, longitude, latitude) {
  const result = await Driver.findByIdAndUpdate(
    driverId,
    {
      currentLocation: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      locationUpdatedAt: new Date(),
    },
    { new: true }
  );
  return result ? result.toObject() : null;
}

