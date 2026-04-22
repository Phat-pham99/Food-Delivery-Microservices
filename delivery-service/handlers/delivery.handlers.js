// Removed uuid import - using database-generated IDs now
import {
  upsertDriver,
  getDriver,
  getDriverByUserId,
  updateDriverAvailability,
  getAvailableDriversNear,
} from "../repositories/drivers.repo.js";
import {
  upsertDelivery,
  updateDeliveryFields,
  getDelivery,
  createDelivery,
  declineDelivery,
  findAvailableDriverForReassignment,
} from "../repositories/deliveries.repo.js";
import { publishMessage, TOPICS } from "../config/kafka.js";
import {
  getTravelTimeMatrix,
  haversineDistance,
  estimateTravelTime,
} from "../utils/osrm.js";
import { logger } from "../utils/logger.js";

/**
 * Assign delivery to a specific driver
 * @param {string} orderId - Order ID
 * @param {string} driverId - Driver ID
 */
export async function assignDelivery(
  orderId,
  driverId,
  deliveryAddress,
  producer,
  serviceName
) {
  try {
    console.log(
      `🚗 [${serviceName}] Assigning delivery for order ${orderId} to driver ${driverId}`
    );

    // Get driver information
    const driver = await getDriver(driverId);
    if (!driver) {
      throw new Error(`Driver ${driverId} not found`);
    }
    const assignedAt = new Date().toISOString();

    // Fixed estimated delivery time (10 seconds from now for simulation)
    const estimatedDeliveryTime = new Date(
      Date.now() + 10 * 1000
    ).toISOString();

    // Create delivery record (let database generate deliveryId)
    const delivery = {
      // Don't provide deliveryId - let database generate it
      orderId,
      driverId,
      deliveryAddress, // Include delivery address
      status: "assigned",
      assignedAt,
      estimatedDeliveryTime,
      actualDeliveryTime: null,
      createdAt: assignedAt,
    };

    // Save delivery to database and get the created delivery with generated ID
    const createdDelivery = await upsertDelivery({
      ...delivery,
      driverName: driver.name,
      driverPhone: driver.phone,
      vehicle: driver.vehicle,
      licensePlate: driver.licensePlate,
    });

    // Mark driver as unavailable
    await upsertDriver({
      driverId: driver.id, // driver.id now equals user.id
      name: driver.name,
      phone: driver.phone,
      vehicle: driver.vehicle,
      licensePlate: driver.licensePlate,
      isAvailable: false,
      currentLocation: driver.currentLocation,
      rating: driver.rating,
      totalDeliveries: driver.totalDeliveries,
      updatedAt: assignedAt,
    });

    // Publish delivery assigned event AFTER database insert
    await publishMessage(
      producer,
      TOPICS.DELIVERY_ASSIGNED,
      {
        deliveryId: createdDelivery.deliveryId,
        orderId,
        driverId,
        assignedAt,
        estimatedDeliveryTime,
      },
      orderId
    );

    console.log(
      `✅ [${serviceName}] Delivery ${createdDelivery.deliveryId} assigned to driver ${driverId} for order ${orderId}`
    );

    return createdDelivery.deliveryId; // Return the deliveryId for use in pickup
  } catch (error) {
    console.error(
      `❌ [${serviceName}] Error assigning delivery:`,
      error.message
    );
    throw error;
  } finally {
  }
}

/**
 * Pick up delivery (driver picks up food from restaurant)
 * @param {string} deliveryId - Delivery ID
 * @param {string} orderId - Order ID
 * @param {string} driverId - Driver ID
 */
export async function pickupDelivery(
  deliveryId,
  orderId,
  driverId,
  producer,
  serviceName
) {
  try {
    console.log(
      `📦 [${serviceName}] Driver ${driverId} picking up order ${orderId}`
    );

    const pickedUpAt = new Date().toISOString();

    // Update delivery status to picked_up
    await updateDeliveryFields(deliveryId, {
      status: "picked_up",
      pickedUpAt: pickedUpAt,
    });

    // Publish delivery picked up event
    await publishMessage(
      producer,
      TOPICS.DELIVERY_PICKED_UP,
      {
        deliveryId,
        orderId,
        driverId,
        pickedUpAt,
      },
      orderId
    );

    console.log(
      `✅ [${serviceName}] Delivery ${deliveryId} picked up by driver ${driverId} for order ${orderId}`
    );
  } catch (error) {
    console.error(
      `❌ [${serviceName}] Error picking up delivery ${deliveryId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Complete a delivery
 * @param {string} deliveryId - Delivery ID
 * @param {string} orderId - Order ID
 * @param {string} driverId - Driver ID
 */
export async function completeDelivery(
  deliveryId,
  orderId,
  driverId,
  producer,
  serviceName
) {
  try {
    console.log(
      `⏳ [${serviceName}] Completing delivery ${deliveryId} for order ${orderId}`
    );

    const completedAt = new Date().toISOString();

    // Update delivery status to completed (avoid insert with null NOT NULL columns)
    await updateDeliveryFields(deliveryId, {
      status: "completed",
      actualDeliveryTime: completedAt,
    });

    // Mark driver as available and increment delivery count
    // driverId here is the user ID from JWT token
    const existingDriver = await getDriverByUserId(driverId);
    if (!existingDriver) {
      console.log(
        `⚠️ [${serviceName}] Driver with user ID ${driverId} not found for completion update`
      );
      return;
    }

    const incrementedTotal = (existingDriver?.totalDeliveries || 0) + 1;
    await upsertDriver({
      driverId: existingDriver.id, // driver.id now equals user.id
      name: existingDriver?.name,
      phone: existingDriver?.phone,
      vehicle: existingDriver?.vehicle,
      licensePlate: existingDriver?.licensePlate,
      isAvailable: true,
      currentLocation: existingDriver?.currentLocation, // Preserve existing location
      rating: existingDriver?.rating || 0.0,
      totalDeliveries: incrementedTotal,
      updatedAt: new Date().toISOString(),
    });

    // Get delivery details for event
    const delivery = await getDelivery(deliveryId);

    // logical transaction ended

    // Publish delivery completed event
    await publishMessage(
      producer,
      TOPICS.DELIVERY_COMPLETED,
      {
        deliveryId,
        orderId,
        driverId,
        completedAt,
        estimatedTime: delivery?.estimatedDeliveryTime ?? null,
        actualTime: completedAt,
      },
      orderId
    );

    console.log(
      `✅ [${serviceName}] Delivery ${deliveryId} for order ${orderId} completed`
    );
  } catch (error) {
    console.error(
      `❌ [${serviceName}] Error completing delivery ${deliveryId}:`,
      error.message
    );
    throw error;
  } finally {
  }
}

/**
 * Auto-assigns a driver to an order based on proximity and rating.
 * Uses OSRM for road-network travel times with Haversine/rating fallbacks.
 *
 * @param {Object} orderData - Order information from Kafka (includes restaurant.location)
 * @param {Object} producer - Kafka producer
 * @param {string} serviceName - Service name for logging
 * @returns {Object|null} - Assigned driver info or null if no driver available
 */
export async function autoAssignDriver(orderData, producer, serviceName) {
  const { orderId, restaurantId, deliveryAddress, restaurantLocation } = orderData;

  console.log(
    `🚗 [${serviceName}] Starting auto-assignment for order ${orderId}`
  );

  try {
    // Validate input data
    if (!orderData || !orderId || !restaurantId || !deliveryAddress) {
      console.error(
        `❌ [${serviceName}] Invalid order data for auto-assignment:`,
        orderData
      );
      return null;
    }

    let selectedDriver;

    if (restaurantLocation?.coordinates?.length === 2) {
      // Use proximity-based selection (OSRM + rating scoring)
      const [lng, lat] = restaurantLocation.coordinates;
      console.log(
        `📍 [${serviceName}] Using proximity-based selection from restaurant [${lng}, ${lat}]`
      );
      selectedDriver = await selectNearestBestDriver({ lng, lat });
    } else {
      // No restaurant location available — fall back to rating-only
      console.log(
        `⚠️ [${serviceName}] No restaurant location available, falling back to rating-based selection`
      );
      const { getDrivers } = await import("../repositories/drivers.repo.js");
      const availableDrivers = await getDrivers({ isAvailable: true });
      selectedDriver = selectBestDriverByRating(availableDrivers);
    }

    if (!selectedDriver) {
      console.log(
        `⚠️ [${serviceName}] No suitable driver found for order ${orderId}`
      );
      return null;
    }

    console.log(`🚗 [${serviceName}] Driver selected for auto-assignment`, {
      orderId,
      driverId: selectedDriver.id,
      driverName: selectedDriver.name,
      rating: selectedDriver.rating,
      estimatedTravelTimeSec: selectedDriver.estimatedTravelTimeSeconds
        ? Math.round(selectedDriver.estimatedTravelTimeSeconds)
        : "N/A",
    });

    // Use OSRM travel time for ETA, or default to 20 min
    const travelTimeSec = selectedDriver.estimatedTravelTimeSeconds || 20 * 60;
    const estimatedDeliveryTime = new Date(
      Date.now() + travelTimeSec * 1000
    ).toISOString();

    // Create delivery record
    const delivery = await createDelivery({
      orderId,
      driverId: selectedDriver.id,
      restaurantId,
      userId: orderData.userId,
      deliveryAddress,
      status: "assigned",
      assignedAt: new Date().toISOString(),
      estimatedDeliveryTime,
      driverName: selectedDriver.name,
      driverPhone: selectedDriver.phone,
      vehicle: selectedDriver.vehicle,
      licensePlate: selectedDriver.licensePlate,
    });

    // Update driver availability to false
    await updateDriverAvailability(selectedDriver.id, false);

    // Increment driver's delivery count
    await incrementDriverDeliveries(selectedDriver.id);

    // Publish delivery assigned event
    await publishMessage(
      producer,
      TOPICS.DELIVERY_ASSIGNED,
      {
        deliveryId: delivery.id,
        orderId,
        driverId: selectedDriver.id,
        assignedAt: delivery.assignedAt,
        estimatedDeliveryTime,
      },
      orderId
    );

    console.log(`✅ [${serviceName}] Driver auto-assigned successfully`, {
      orderId,
      deliveryId: delivery.id,
      driverId: selectedDriver.id,
      driverName: selectedDriver.name,
    });

    return {
      deliveryId: delivery.id,
      driverId: selectedDriver.id,
      driverName: selectedDriver.name,
      driverPhone: selectedDriver.phone,
      vehicle: selectedDriver.vehicle,
      licensePlate: selectedDriver.licensePlate,
      rating: selectedDriver.rating,
      totalDeliveries: selectedDriver.totalDeliveries,
    };
  } catch (error) {
    console.error(
      `❌ [${serviceName}] Error in auto-assignment:`,
      error.message
    );
    throw error;
  }
}

/**
 * Legacy fallback: select driver by rating only (no location data available)
 * @param {Array} drivers - Array of available drivers
 * @returns {Object|null} - Selected driver or null
 */
function selectBestDriverByRating(drivers) {
  if (drivers.length === 0) return null;
  const sorted = [...drivers].sort((a, b) => {
    const ratingDiff = parseFloat(b.rating) - parseFloat(a.rating);
    if (ratingDiff !== 0) return ratingDiff;
    return a.totalDeliveries - b.totalDeliveries;
  });
  return sorted[0];
}

/**
 * Score and rank drivers using Haversine distance (OSRM fallback)
 * @param {Array} drivers - Drivers with currentLocation
 * @param {Object} restaurantLocation - { lng, lat }
 * @returns {Object|null} - Best driver with estimatedTravelTimeSeconds
 */
function selectByHaversine(drivers, restaurantLocation) {
  const scored = drivers.map((driver) => {
    const [dLng, dLat] = driver.currentLocation.coordinates;
    const dist = haversineDistance(
      restaurantLocation.lat, restaurantLocation.lng,
      dLat, dLng
    );
    return { driver, travelTimeSeconds: estimateTravelTime(dist), rating: parseFloat(driver.rating) || 0 };
  });
  return rankAndPickBest(scored);
}

/**
 * Normalize scores and pick the best driver.
 * Lower score = better (proximity is cost, rating is benefit).
 *
 * @param {Array} scored - [{ driver, travelTimeSeconds, rating }]
 * @returns {Object|null} - Best driver with estimatedTravelTimeSeconds attached
 */
function rankAndPickBest(scored) {
  if (scored.length === 0) return null;
  if (scored.length === 1) {
    return { ...scored[0].driver, estimatedTravelTimeSeconds: scored[0].travelTimeSeconds };
  }

  const W_TIME = parseFloat(process.env.DRIVER_WEIGHT_TIME || "0.7");
  const W_RATING = parseFloat(process.env.DRIVER_WEIGHT_RATING || "0.3");

  const maxTime = Math.max(...scored.map((s) => s.travelTimeSeconds));
  const minTime = Math.min(...scored.map((s) => s.travelTimeSeconds));
  const maxRating = Math.max(...scored.map((s) => s.rating));
  const minRating = Math.min(...scored.map((s) => s.rating));

  const ranked = scored.map((s) => {
    const normTime = maxTime === minTime ? 0 : (s.travelTimeSeconds - minTime) / (maxTime - minTime);
    const normRating = maxRating === minRating ? 1 : (s.rating - minRating) / (maxRating - minRating);
    // Lower score = better: penalize distance, reward rating
    const score = W_TIME * normTime - W_RATING * normRating;
    return { ...s, score };
  });

  ranked.sort((a, b) => a.score - b.score);
  const best = ranked[0];

  logger.info("Driver ranked and selected", {
    driverId: best.driver.id,
    name: best.driver.name,
    travelTimeSec: Math.round(best.travelTimeSeconds),
    rating: best.rating,
    score: best.score.toFixed(4),
    totalCandidates: ranked.length,
  });

  return { ...best.driver, estimatedTravelTimeSeconds: best.travelTimeSeconds };
}

/**
 * Select the best driver using proximity (OSRM) + rating scoring.
 * Pipeline: MongoDB $near pre-filter → OSRM Table API → score → pick best.
 * Falls back to Haversine if OSRM is down, then to rating-only if no locations.
 *
 * @param {Object} restaurantLocation - { lng, lat }
 * @param {Array} excludeDriverIds - Driver IDs to skip
 * @returns {Object|null} - Best driver with estimatedTravelTimeSeconds
 */
async function selectNearestBestDriver(restaurantLocation, excludeDriverIds = []) {
  const initialRadius = parseFloat(process.env.DRIVER_SEARCH_RADIUS_KM || "5");
  const maxRadius = parseFloat(process.env.DRIVER_MAX_SEARCH_RADIUS_KM || "25");
  const radii = [initialRadius, 10, 15, maxRadius];

  let nearbyDrivers = [];

  // Expanding radius search
  for (const radius of radii) {
    nearbyDrivers = await getAvailableDriversNear(
      restaurantLocation.lng,
      restaurantLocation.lat,
      radius,
      excludeDriverIds
    );
    if (nearbyDrivers.length > 0) {
      logger.info(`Found ${nearbyDrivers.length} drivers within ${radius}km`);
      break;
    }
    logger.info(`No drivers within ${radius}km, expanding radius...`);
  }

  // If no drivers with fresh locations found, fall back to rating-only
  if (nearbyDrivers.length === 0) {
    logger.warn("No drivers with fresh locations found in any radius, falling back to rating-based selection");
    const { getDrivers } = await import("../repositories/drivers.repo.js");
    const allAvailable = await getDrivers({ isAvailable: true });
    const filtered = allAvailable.filter(
      (d) => !excludeDriverIds.includes(d.id?.toString())
    );
    return selectBestDriverByRating(filtered);
  }

  // Prepare destinations for OSRM
  const destinations = nearbyDrivers.map((d) => ({
    id: d.id,
    lng: d.currentLocation.coordinates[0],
    lat: d.currentLocation.coordinates[1],
  }));

  // Call OSRM Table API
  const travelTimes = await getTravelTimeMatrix(restaurantLocation, destinations);

  if (!travelTimes) {
    // OSRM failed — fallback to Haversine
    logger.warn("OSRM unavailable, falling back to Haversine distance");
    return selectByHaversine(nearbyDrivers, restaurantLocation);
  }

  // Merge travel times with driver data
  const scored = nearbyDrivers
    .map((driver) => {
      const tt = travelTimes.find(
        (t) => t.driverId.toString() === driver.id.toString()
      );
      if (!tt) return null; // Driver was unreachable via OSRM
      return {
        driver,
        travelTimeSeconds: tt.travelTimeSeconds,
        rating: parseFloat(driver.rating) || 0,
      };
    })
    .filter(Boolean);

  if (scored.length === 0) {
    logger.warn("All drivers unreachable via OSRM, falling back to Haversine");
    return selectByHaversine(nearbyDrivers, restaurantLocation);
  }

  return rankAndPickBest(scored);
}

// updateDriverAvailability is now imported from repositories/drivers.repo.js

/**
 * Increments driver's total deliveries count
 * @param {string} driverId - Driver ID
 */
async function incrementDriverDeliveries(driverId) {
  try {
    const driver = await getDriver(driverId);
    if (driver) {
      await upsertDriver({
        driverId: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicle: driver.vehicle,
        licensePlate: driver.licensePlate,
        isAvailable: driver.isAvailable,
        currentLocation: driver.currentLocation,
        rating: driver.rating,
        totalDeliveries: (driver.totalDeliveries || 0) + 1,
        updatedAt: new Date(),
      });
    }

    console.log(`🚗 [delivery-service] Driver deliveries count incremented`, {
      driverId,
    });
  } catch (error) {
    console.error(
      `❌ [delivery-service] Error incrementing driver deliveries:`,
      error.message
    );
    throw error;
  }
}

/**
 * Handle food-ready events by auto-assigning a driver
 * @param {Object} orderData - Order data from Kafka
 * @param {Object} producer - Kafka producer
 * @param {string} serviceName - Service name for logging
 */
export async function handleFoodReady(orderData, producer, serviceName) {
  console.log(
    `📥 [${serviceName}] Processing food-ready event:`,
    orderData ? `order ${orderData.orderId}` : "no order data"
  );

  try {
    // Validate input data
    if (!orderData || typeof orderData !== "object") {
      console.error(
        `❌ [${serviceName}] Invalid order data received:`,
        orderData
      );
      return;
    }

    const {
      orderId,
      restaurantId,
      userId,
      items,
      total,
      deliveryAddress,
      restaurant, // Destructure restaurant from orderData
      customer,
    } = orderData;

    if (!orderId || !restaurantId || !deliveryAddress) {
      console.error(
        `❌ [${serviceName}] Missing required fields in order data:`,
        {
          orderId: !!orderId,
          restaurantId: !!restaurantId,
          deliveryAddress: !!deliveryAddress,
        }
      );
      return;
    }

    // Auto-assign a driver (pass restaurant location for proximity-based selection)
    const assignedDriver = await autoAssignDriver(
      {
        orderId,
        restaurantId,
        userId,
        deliveryAddress,
        restaurantLocation: restaurant?.location || null,
      },
      producer,
      serviceName
    );

    if (!assignedDriver) {
      console.log(
        `⚠️ [${serviceName}] No driver available for auto-assignment for order ${orderId}`
      );
      // TODO: Implement fallback mechanism (notify restaurant, queue for later, etc.)
      return;
    }

    // Enrich delivery with order details
    const { enrichDeliveryWithOrderDetails } = await import(
      "../repositories/deliveries.repo.js"
    );
    await enrichDeliveryWithOrderDetails(assignedDriver.deliveryId, {
      restaurantId,
      restaurantName: restaurant?.name || null,
      restaurantAddress: restaurant?.address || null, // Pass restaurant.address
      restaurantPhone: restaurant?.phone || null,
      customerName: customer?.name || null,
      customerPhone: customer?.phone || null,
      orderItems: items || [],
      orderTotal: total || null,
    });

    console.log(`✅ [${serviceName}] Food-ready event processed successfully`, {
      orderId,
      deliveryId: assignedDriver.deliveryId,
      driverId: assignedDriver.driverId,
      driverName: assignedDriver.driverName,
    });
  } catch (error) {
    console.error(
      `❌ [${serviceName}] Error handling food-ready event:`,
      error.message
    );
  }
}

/**
 * Reassign delivery when declined by driver.
 * Uses proximity-based selection if restaurant location is available.
 *
 * @param {string} orderId - Order ID
 * @param {string} deliveryId - Delivery ID
 * @param {Array} excludeDriverIds - Driver IDs who have declined
 * @param {Object} producer - Kafka producer
 * @param {string} serviceName - Service name
 * @param {Object} restaurantLocation - Optional { type: "Point", coordinates: [lng, lat] }
 */
export async function reassignDelivery(
  orderId,
  deliveryId,
  excludeDriverIds,
  producer,
  serviceName,
  restaurantLocation = null
) {
  try {
    console.log(
      `🔄 [${serviceName}] Reassigning delivery ${deliveryId} for order ${orderId}`
    );
    console.log(`   Excluding drivers: ${excludeDriverIds.join(", ")}`);

    let availableDriver;

    if (restaurantLocation?.coordinates?.length === 2) {
      // Use proximity-based selection (excluding declined drivers)
      const [lng, lat] = restaurantLocation.coordinates;
      availableDriver = await selectNearestBestDriver({ lng, lat }, excludeDriverIds);
    } else {
      // Fallback: find any available driver excluding declined ones
      availableDriver = await findAvailableDriverForReassignment(excludeDriverIds);
    }

    if (!availableDriver) {
      console.warn(
        `⚠️ [${serviceName}] No available drivers found for reassignment of delivery ${deliveryId}`
      );

      // Mark delivery as unassigned
      await updateDeliveryFields(deliveryId, {
        status: "unassigned",
      });

      // Publish event for admin notification
      await publishMessage(
        producer,
        TOPICS.DELIVERY_UNASSIGNED,
        {
          deliveryId,
          orderId,
          reason: "No available drivers",
          declinedByDrivers: excludeDriverIds,
          timestamp: new Date().toISOString(),
        },
        orderId
      );

      return null;
    }

    // Assign to the new driver
    await updateDeliveryFields(deliveryId, {
      driverId: availableDriver.id,
      status: "assigned",
      assignedAt: new Date().toISOString(),
    });

    // Set new driver as unavailable
    await updateDriverAvailability(availableDriver.id, false);

    console.log(
      `✅ [${serviceName}] Delivery ${deliveryId} reassigned to driver ${availableDriver.name}`
    );

    // Publish reassignment event
    await publishMessage(
      producer,
      TOPICS.DELIVERY_REASSIGNED,
      {
        deliveryId,
        orderId,
        newDriverId: availableDriver.id,
        newDriverName: availableDriver.name,
        previousDeclines: excludeDriverIds.length,
        timestamp: new Date().toISOString(),
      },
      orderId
    );

    return availableDriver;
  } catch (error) {
    console.error(
      `❌ [${serviceName}] Error reassigning delivery ${deliveryId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Initialize sample driver data if needed
 */
