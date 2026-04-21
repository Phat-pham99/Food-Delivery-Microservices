import mongoose from "mongoose";

const deliveryStatusEnum = [
  "pending_assignment",
  "assigned",
  "picked_up",
  "completed",
  "cancelled",
  "unassigned",
];

const acceptanceStatusEnum = ["pending", "accepted", "declined"];

const deliverySchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    driverId: { type: mongoose.Schema.Types.ObjectId, required: true }, // References Driver (which is a User)
    driverName: { type: String, required: true },
    driverPhone: { type: String, required: true },
    vehicle: { type: String, required: true },
    licensePlate: { type: String, required: true },
    deliveryAddress: { type: mongoose.Schema.Types.Mixed, required: true }, // JSON in Postgres
    status: {
      type: String,
      enum: deliveryStatusEnum,
      required: true,
      default: "assigned",
    },
    assignedAt: { type: Date },
    pickedUpAt: { type: Date },
    estimatedDeliveryTime: { type: Date },
    actualDeliveryTime: { type: Date },
    
    // Gig-worker model fields
    deliveryFee: { type: Number, default: 3.50 },
    acceptanceStatus: {
      type: String,
      enum: acceptanceStatusEnum,
      default: "pending",
    },
    declinedByDrivers: { type: [String], default: [] },

    // Restaurant information
    restaurantId: { type: mongoose.Schema.Types.ObjectId },
    restaurantName: { type: String },
    restaurantAddress: { type: mongoose.Schema.Types.Mixed },
    restaurantPhone: { type: String },

    // Customer information
    customerName: { type: String },
    customerPhone: { type: String },

    // Order information
    orderItems: { type: mongoose.Schema.Types.Mixed },
    orderTotal: { type: Number },
  },
  {
    timestamps: true, // Creates createdAt and updatedAt
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: function (doc, ret) {
        delete ret._id;
      }
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: function (doc, ret) {
        delete ret._id;
      }
    }
  }
);

// Virtual property for delivery ID
deliverySchema.virtual('id').get(function() {
  return this._id;
});

// Index for efficient querying
deliverySchema.index({ driverId: 1 });
deliverySchema.index({ status: 1 });
deliverySchema.index({ orderId: 1 });

const driverSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, required: true }, // Manually set to match User ID
    name: { type: String, required: true },
    phone: { type: String, required: true },
    vehicle: { type: String, required: true },
    licensePlate: { type: String, required: true },
    isAvailable: { type: Boolean, default: true },
    currentLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
    },
    locationUpdatedAt: { type: Date },
    rating: { type: Number, default: 0.0 },
    totalDeliveries: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    _id: false, // Disable auto-generation of _id since we use String _id
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: function (doc, ret) {
        delete ret._id;
      }
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: function (doc, ret) {
        delete ret._id;
      }
    }
  }
);

// Ensure _id is used as the primary key
driverSchema.virtual('id').get(function() {
  return this._id;
});

// Geospatial index for proximity queries (used by $near, $geoNear)
driverSchema.index({ currentLocation: "2dsphere" });

export const Delivery = mongoose.model("Delivery", deliverySchema);
export const Driver = mongoose.model("Driver", driverSchema);
export { driverSchema };
