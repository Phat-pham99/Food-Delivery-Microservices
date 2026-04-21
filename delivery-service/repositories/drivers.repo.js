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
