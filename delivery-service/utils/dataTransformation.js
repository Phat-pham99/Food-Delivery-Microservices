/**
 * Transform delivery document to API response format
 * @param {Object} delivery - The raw delivery document (lean)
 * @returns {Object} Transformed delivery object
 */
export const transformDelivery = (delivery) => {
  if (!delivery) return null;

  return {
    id: delivery.id,
    deliveryId: delivery.id, // Keep for backward compatibility if needed
    orderId: delivery.orderId?.toString(),
    driverId: delivery.driverId?.toString(),
    restaurantId: delivery.restaurantId?.toString(),
    
    // Driver details (if populated or joined)
    driverName: delivery.driverName,
    driverPhone: delivery.driverPhone,
    vehicle: delivery.vehicle,
    licensePlate: delivery.licensePlate,
    
    // Status and Timestamps
    status: delivery.status,
    acceptanceStatus: delivery.acceptanceStatus,
    assignedAt: delivery.assignedAt,
    pickedUpAt: delivery.pickedUpAt,
    deliveredAt: delivery.deliveredAt,
    estimatedDeliveryTime: delivery.estimatedDeliveryTime,
    actualDeliveryTime: delivery.actualDeliveryTime,
    
    // Addresses
    deliveryAddress: delivery.deliveryAddress, // Object
    restaurantAddress: delivery.restaurantAddress, // Object
    
    // Restaurant details
    restaurantName: delivery.restaurantName,
    restaurantPhone: delivery.restaurantPhone,
    
    // Customer details
    customerName: delivery.customerName,
    customerPhone: delivery.customerPhone,
    
    // Order details
    orderItems: delivery.orderItems,
    orderTotal: delivery.orderTotal,
    deliveryFee: delivery.deliveryFee,
    
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
};

/**
 * Transform driver document to API response format
 * @param {Object} driver - The raw driver document (lean)
 * @returns {Object} Transformed driver object
 */
export const transformDriver = (driver) => {
  if (!driver) return null;

  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    vehicle: driver.vehicle,
    licensePlate: driver.licensePlate,
    isAvailable: driver.isAvailable,
    currentLocation: driver.currentLocation,
    locationUpdatedAt: driver.locationUpdatedAt,
    rating: driver.rating,
    totalDeliveries: driver.totalDeliveries,
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt,
  };
};
