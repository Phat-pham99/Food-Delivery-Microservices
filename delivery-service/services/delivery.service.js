import {
  getDeliveryByOrderId,
  getDeliveries,
  getDeliveryStats,
  getDriverStats,
  acceptDelivery as acceptDeliveryRepo,
  declineDelivery as declineDeliveryRepo,
  getDeliveryWithFullDetails,
  getDelivery,
} from "../repositories/deliveries.repo.js";
import {
  getDrivers,
  getDriverByUserId,
  updateDriverAvailability,
  updateDriverLocation,
} from "../repositories/drivers.repo.js";
import { transformDelivery, transformDriver } from "../utils/dataTransformation.js";
import {
  pickupDelivery,
  completeDelivery,
  reassignDelivery,
} from "../handlers/delivery.handlers.js";
import { logger } from "../utils/logger.js";
import { publishMessage, TOPICS } from "../config/kafka.js";

export const getDeliveryByOrderService = async (orderId) => {
  logger.info("Getting delivery by order ID", { orderId });

  if (!orderId || typeof orderId !== "string") {
    const error = new Error("Invalid orderId: must be a non-empty string");
    error.statusCode = 400;
    throw error;
  }

  const delivery = await getDeliveryByOrderId(orderId);
  if (!delivery) {
    const error = new Error("Delivery not found for this order");
    error.statusCode = 404;
    throw error;
  }

  return transformDelivery(delivery);
};

export const listDeliveriesService = async (filters, userId) => {
  const queryFilters = { ...filters };
  
  // If user is authenticated, get their driver record and filter by user ID
  if (userId) {
    const driver = await getDriverByUserId(userId);
    if (!driver) {
      const error = new Error("Driver profile not found for this user");
      error.details = "Please contact support to set up your driver account";
      error.statusCode = 404;
      throw error;
    }
    // driver.id equals user.id (shared primary key)
    queryFilters.driverId = driver.id;
  }

  return await getDeliveries(queryFilters);
};

export const listDriversService = async (isAvailable, limit) => {
  const filters = {};
  if (isAvailable !== undefined) filters.isAvailable = isAvailable === "true";
  if (limit) filters.limit = parseInt(limit);
  
  return await getDrivers(filters);
};

export const getStatsService = async (userId) => {
  // If user is authenticated, return driver-specific stats
  if (userId) {
    return await getDriverStats(userId);
  }
  
  // Return general delivery stats for unauthenticated requests
  return await getDeliveryStats();
};

export const pickupDeliveryService = async (deliveryId, orderId, driverId, producer) => {
  if (!deliveryId || !orderId || !driverId) {
    const error = new Error("Missing required fields: deliveryId, orderId, driverId");
    error.statusCode = 400;
    throw error;
  }

  if (
    typeof deliveryId !== "string" ||
    typeof orderId !== "string" ||
    typeof driverId !== "string"
  ) {
    const error = new Error("deliveryId, orderId, and driverId must be strings");
    error.statusCode = 400;
    throw error;
  }

  await pickupDelivery(
    deliveryId,
    orderId,
    driverId,
    producer,
    "delivery-service"
  );

  return {
    deliveryId,
    orderId,
    driverId,
    pickedUpAt: new Date().toISOString(),
  };
};

export const completeDeliveryService = async (deliveryId, orderId, driverId, producer) => {
  if (!deliveryId || !orderId || !driverId) {
    const error = new Error("Missing required fields: deliveryId, orderId, driverId");
    error.statusCode = 400;
    throw error;
  }

  if (
    typeof deliveryId !== "string" ||
    typeof orderId !== "string" ||
    typeof driverId !== "string"
  ) {
    const error = new Error("deliveryId, orderId, and driverId must be strings");
    error.statusCode = 400;
    throw error;
  }

  await completeDelivery(
    deliveryId,
    orderId,
    driverId,
    producer,
    "delivery-service"
  );

  return {
    deliveryId,
    orderId,
    driverId,
    completedAt: new Date().toISOString(),
  };
};

export const toggleAvailabilityService = async (userId, isAvailable) => {
  if (typeof isAvailable !== "boolean") {
    const error = new Error("isAvailable must be a boolean");
    error.statusCode = 400;
    throw error;
  }

  // Get driver record by userId
  const rawDriver = await getDriverByUserId(userId);
  if (!rawDriver) {
    const error = new Error("Driver not found");
    error.statusCode = 404;
    throw error;
  }
  const driver = transformDriver(rawDriver);

  // Check if driver has an active delivery
  if (!isAvailable) {
    const activeDeliveries = await getDeliveries({
      driverId: driver.id,
      status: "picked_up",
      limit: 1,
    });

    if (activeDeliveries.length > 0) {
      const error = new Error("Cannot go offline while on an active delivery");
      error.statusCode = 400;
      throw error;
    }
  }

  // Update availability
  await updateDriverAvailability(driver.id, isAvailable);

  logger.info("Driver availability updated", {
    driverId: driver.id,
    isAvailable,
  });

  return { isAvailable };
};

export const acceptDeliveryService = async (deliveryId, userId, producer) => {
  // Get driver record
  const rawDriver = await getDriverByUserId(userId);
  if (!rawDriver) {
    const error = new Error("Driver not found");
    error.statusCode = 404;
    throw error;
  }
  const driver = transformDriver(rawDriver);

  // Get delivery
  const delivery = await getDelivery(deliveryId);
  if (!delivery) {
    const error = new Error("Delivery not found");
    error.statusCode = 404;
    throw error;
  }

  // Verify delivery is assigned to this driver
  const deliveryDriverId = delivery.driverId?.toString() || delivery.driverId;
  const currentDriverId = driver.id?.toString() || driver.id;

  if (deliveryDriverId !== currentDriverId) {
    logger.warn("Delivery not assigned to this driver", {
      deliveryDriverId,
      currentDriverId,
    });
    const error = new Error("This delivery is not assigned to you");
    error.statusCode = 403;
    throw error;
  }

  // Verify delivery is in pending status
  if (delivery.acceptanceStatus !== "pending") {
    const error = new Error(`Delivery is already ${delivery.acceptanceStatus}`);
    error.statusCode = 400;
    throw error;
  }

  // Accept the delivery
  await acceptDeliveryRepo(deliveryId, driver.id);

  // Set driver to unavailable
  await updateDriverAvailability(driver.id, false);

  logger.info("Delivery accepted", {
    deliveryId,
    driverId: driver.id,
  });

  // Publish event
  await publishMessage(
    producer,
    TOPICS.DELIVERY_ACCEPTED,
    {
      deliveryId: deliveryId.toString(),
      orderId: delivery.orderId?.toString() || delivery.orderId,
      driverId: driver.id?.toString() || driver.id,
      driverName: driver.name,
      timestamp: new Date().toISOString(),
    },
    delivery.orderId?.toString() || delivery.orderId
  );

  return { deliveryId };
};

export const declineDeliveryService = async (deliveryId, reason, userId, producer) => {
  // Get driver record
  const rawDriver = await getDriverByUserId(userId);
  if (!rawDriver) {
    const error = new Error("Driver not found");
    error.statusCode = 404;
    throw error;
  }
  const driver = transformDriver(rawDriver);

  // Get delivery
  const delivery = await getDelivery(deliveryId);
  if (!delivery) {
    const error = new Error("Delivery not found");
    error.statusCode = 404;
    throw error;
  }

  // Verify delivery is assigned to this driver
  const deliveryDriverId = delivery.driverId?.toString() || delivery.driverId;
  const currentDriverId = driver.id?.toString() || driver.id;
  
  if (deliveryDriverId !== currentDriverId) {
    const error = new Error("This delivery is not assigned to you");
    error.statusCode = 403;
    throw error;
  }

  // Verify delivery is in pending status
  if (delivery.acceptanceStatus !== "pending") {
    const error = new Error(`Cannot decline: delivery is already ${delivery.acceptanceStatus}`);
    error.statusCode = 400;
    throw error;
  }

  // Decline the delivery
  await declineDeliveryRepo(deliveryId, driver.id);

  // Set driver back to available
  await updateDriverAvailability(driver.id, true);

  logger.info("Delivery declined", {
    deliveryId,
    driverId: driver.id,
    reason,
  });

  // Publish event
  await publishMessage(
    producer,
    TOPICS.DELIVERY_DECLINED,
    {
      deliveryId: deliveryId.toString(),
      orderId: delivery.orderId?.toString() || delivery.orderId,
      driverId: driver.id?.toString() || driver.id,
      driverName: driver.name,
      reason,
      timestamp: new Date().toISOString(),
    },
    delivery.orderId?.toString() || delivery.orderId
  );

  // Trigger reassignment
  const declinedByDrivers = delivery.declinedByDrivers || [];
  declinedByDrivers.push(driver.id);

  await reassignDelivery(
    delivery.orderId,
    deliveryId,
    declinedByDrivers,
    producer,
    "delivery-service"
  );

  return { deliveryId };
};

export const getDeliveryDetailsService = async (deliveryId) => {
  const delivery = await getDeliveryWithFullDetails(deliveryId);
  
  if (!delivery) {
    const error = new Error("Delivery not found");
    error.statusCode = 404;
    throw error;
  }

  logger.info("Delivery details retrieved", { deliveryId });

  return transformDelivery(delivery);
};

/**
 * Update the authenticated driver's GPS location.
 * @param {string} userId - Driver's user ID (from JWT)
 * @param {number} longitude - GPS longitude
 * @param {number} latitude - GPS latitude
 * @returns {{ location: Object, locationUpdatedAt: Date }}
 */
export const updateLocationService = async (userId, longitude, latitude) => {
  const driver = await getDriverByUserId(userId);
  if (!driver) {
    const error = new Error("Driver profile not found");
    error.statusCode = 404;
    throw error;
  }

  const updated = await updateDriverLocation(userId, longitude, latitude);
  if (!updated) {
    const error = new Error("Failed to update location");
    error.statusCode = 500;
    throw error;
  }

  logger.info("Driver location updated", {
    driverId: userId,
    coordinates: [longitude, latitude],
  });

  return {
    location: updated.currentLocation,
    locationUpdatedAt: updated.locationUpdatedAt,
  };
};
