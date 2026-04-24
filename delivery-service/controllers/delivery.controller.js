import {
  getDeliveryByOrderService,
  listDeliveriesService,
  listDriversService,
  getStatsService,
  pickupDeliveryService,
  completeDeliveryService,
  toggleAvailabilityService,
  acceptDeliveryService,
  declineDeliveryService,
  getDeliveryDetailsService,
  updateLocationService,
} from "../services/delivery.service.js";
import {logger} from "../utils/logger.js";

export const getDeliveryByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const delivery = await getDeliveryByOrderService(orderId);
    res.json({
      message: "Delivery retrieved successfully",
      delivery,
    });
  } catch (error) {
    logger.error("Error retrieving delivery", {
      error: error.message,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res
      .status(500)
      .json({ error: "Failed to retrieve delivery", details: error.message });
  }
};

export const listDeliveries = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const deliveries = await listDeliveriesService(req.query, userId);
    res.json({
      message: "Deliveries retrieved successfully",
      deliveries,
      total: deliveries.length,
    });
  } catch (error) {
    logger.error("Error in listDeliveries", {
      error: error.message,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, message: error.details });
    }
    res
      .status(500)
      .json({ error: "Failed to retrieve deliveries", details: error.message });
  }
};

export const listDrivers = async (req, res) => {
  try {
    const { isAvailable, limit } = req.query;
    const drivers = await listDriversService(isAvailable, limit);
    res.json({
      message: "Drivers retrieved successfully",
      drivers,
      total: drivers.length,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res
      .status(500)
      .json({ error: "Failed to retrieve drivers", details: error.message });
  }
};

export const deliveryStats = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const stats = await getStatsService(userId);
    res.json({
      message: userId ? "Driver statistics retrieved successfully" : "Delivery statistics retrieved successfully",
      stats,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to retrieve delivery statistics",
      details: error.message,
    });
  }
};

export const pickupDeliveryByDriver = async (req, res) => {
  try {
    const { deliveryId, orderId, driverId } = req.body;
    const result = await pickupDeliveryService(deliveryId, orderId, driverId, req.producer);

    res.json({
      message: "Delivery picked up successfully",
      ...result,
    });
  } catch (error) {
    console.error(
      `❌ [delivery-service] Error picking up delivery:`,
      error.message
    );
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res
      .status(500)
      .json({ error: "Failed to pick up delivery", details: error.message });
  }
};

export const completeDeliveryByDriver = async (req, res) => {
  try {
    const { deliveryId, orderId, driverId } = req.body;
    const result = await completeDeliveryService(deliveryId, orderId, driverId, req.producer);

    res.json({
      message: "Delivery completed successfully",
      ...result,
    });
  } catch (error) {
    console.error(
      `❌ [delivery-service] Error completing delivery:`,
      error.message
    );
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res
      .status(500)
      .json({ error: "Failed to complete delivery", details: error.message });
  }
};

export const toggleMyAvailability = async (req, res) => {
  try {
    const userId = req.user?.userId; 
    const { isAvailable } = req.body;

    const result = await toggleAvailabilityService(userId, isAvailable);

    res.json({
      message: `Driver is now ${result.isAvailable ? "online" : "offline"}`,
      isAvailable: result.isAvailable,
    });
  } catch (error) {
    logger.error("Error toggling driver availability", {
      error: error.message,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to update availability",
      details: error.message,
    });
  }
};

export const acceptDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const userId = req.user?.userId;

    const result = await acceptDeliveryService(deliveryId, userId, req.producer);

    res.json({
      message: "Delivery accepted successfully",
      deliveryId: result.deliveryId,
    });
  } catch (error) {
    logger.error("Error accepting delivery", {
      error: error.message,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to accept delivery",
      details: error.message,
    });
  }
};

export const declineDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { reason } = req.body;
    const userId = req.user?.userId;

    const result = await declineDeliveryService(deliveryId, reason, userId, req.producer);

    res.json({
      message: "Delivery declined successfully. Reassigning to another driver.",
      deliveryId: result.deliveryId,
    });
  } catch (error) {
    logger.error("Error declining delivery", {
      error: error.message,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to decline delivery",
      details: error.message,
    });
  }
};

export const getDeliveryDetails = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const delivery = await getDeliveryDetailsService(deliveryId);

    res.json({
      message: "Delivery details retrieved successfully",
      delivery,
    });
  } catch (error) {
    logger.error("Error getting delivery details", {
      error: error.message,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to get delivery details",
      details: error.message,
    });
  }
};

/**
 * Update the authenticated driver's current GPS location.
 * Called by the courier frontend at regular intervals (every ~10 seconds).
 *
 * PUT /drivers/me/location
 * Body: { latitude: number, longitude: number }
 */
export const updateMyLocation = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { latitude, longitude } = req.body;

    // Validate coordinates
    if (latitude == null || longitude == null) {
      return res.status(400).json({
        error: "latitude and longitude are required",
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        error: "Invalid coordinates. Latitude must be -90 to 90, longitude -180 to 180.",
      });
    }

    const result = await updateLocationService(userId, lng, lat);

    res.json({
      message: "Location updated successfully",
      location: result.location,
      locationUpdatedAt: result.locationUpdatedAt,
    });
  } catch (error) {
    logger.error("Error updating driver location", {
      error: error.message,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({
      error: "Failed to update location",
      details: error.message,
    });
  }
};