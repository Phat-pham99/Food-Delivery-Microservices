/**
 * OSRM (Open Source Routing Machine) Client Utility
 * Provides travel time calculations for driver assignment.
 *
 * Uses OSRM Table API to get road-network travel times from restaurant to drivers.
 * Falls back to Haversine (straight-line) distance when OSRM is unavailable.
 */

import { logger } from "./logger.js";

const OSRM_URL = process.env.OSRM_URL || "http://localhost:5050";

/**
 * Get travel time matrix from OSRM Table API.
 * Sends the restaurant as source and all driver locations as destinations.
 *
 * @param {Object} source - Restaurant location { lng: Number, lat: Number }
 * @param {Array} destinations - Driver locations [{ id: string, lng: Number, lat: Number }, ...]
 * @returns {Array|null} - Array of { driverId, travelTimeSeconds } sorted by travel time, or null on failure
 */
export async function getTravelTimeMatrix(source, destinations) {
  if (destinations.length === 0) return [];

  // Build coordinate string: source first, then all destinations
  // OSRM expects "lng,lat" format
  const coords = [
    `${source.lng},${source.lat}`,
    ...destinations.map((d) => `${d.lng},${d.lat}`),
  ].join(";");

  // sources=0 means the first coordinate (restaurant) is the source
  // destinations=1;2;3;... means all remaining coordinates (drivers) are destinations
  const destinationIndices = destinations.map((_, i) => i + 1).join(";");
  const url = `${OSRM_URL}/table/v1/driving/${coords}?sources=0&destinations=${destinationIndices}&annotations=duration`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const data = await response.json();

    if (data.code !== "Ok") {
      logger.warn("OSRM returned non-Ok response", {
        code: data.code,
        message: data.message,
      });
      return null; // Signal caller to use fallback
    }

    // data.durations[0] = array of travel times (in seconds) from source to each destination
    // null values indicate unreachable destinations
    const results = destinations.map((dest, i) => ({
      driverId: dest.id,
      travelTimeSeconds: data.durations[0][i], // Can be null if unreachable
    }));

    // Filter out unreachable drivers (null travel time)
    const reachable = results.filter((r) => r.travelTimeSeconds !== null);

    logger.info("OSRM travel time matrix calculated", {
      totalDrivers: destinations.length,
      reachableDrivers: reachable.length,
      unreachable: destinations.length - reachable.length,
    });

    return reachable;
  } catch (error) {
    if (error.name === "AbortError") {
      logger.error("OSRM request timed out after 5s");
    } else {
      logger.error("OSRM request failed", { error: error.message });
    }
    return null; // Signal caller to use fallback
  }
}

/**
 * Calculate Haversine (straight-line) distance between two points.
 * Used as fallback when OSRM is unavailable.
 *
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} - Distance in meters
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate travel time from Haversine distance.
 * Assumes average urban driving speed of ~30 km/h (~8.3 m/s).
 *
 * @param {number} distanceMeters - Haversine distance in meters
 * @returns {number} - Estimated travel time in seconds
 */
export function estimateTravelTime(distanceMeters) {
  const AVERAGE_SPEED_MPS = 8.3; // ~30 km/h in meters per second
  return distanceMeters / AVERAGE_SPEED_MPS;
}
