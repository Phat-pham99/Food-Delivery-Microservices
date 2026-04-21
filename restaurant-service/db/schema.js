import mongoose from "mongoose";

const restaurantSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    cuisine: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    address: {
      type: String,
      required: true,
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] }, // [longitude, latitude]
    },
    phone: {
      type: String,
      required: true,
    },
    rating: {
      type: Number,
      default: 0.0,
      min: 0,
      max: 5,
    },
    deliveryTime: {
      type: String,
      default: "30-40 min",
    },
    deliveryFee: {
      type: Number,
      default: 2.99,
    },
    isOpen: {
      type: Boolean,
      default: true,
    },
    openingTime: String,
    closingTime: String,
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    imageUrl: String,
  },
  {
    timestamps: true,
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
  },
);

// Virtual property for restaurant ID
restaurantSchema.virtual('id').get(function() {
  return this._id;
});

// Geospatial index for proximity queries (restaurants near me)
restaurantSchema.index({ location: "2dsphere" });

const menuItemSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    preparationTime: {
      type: Number,
      default: 15, // minutes
    },
    imageUrl: String,
  },
  {
    timestamps: true,
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
  },
);

// Virtual property for menuItem ID
menuItemSchema.virtual('id').get(function() {
  return this._id;
});

const kitchenOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    items: [
      {
        itemId: String,
        name: String,
        quantity: Number,
        price: Number,
        _id: false,
      },
    ],
    deliveryAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      _id: false,
    },
    customerName: String,
    customerPhone: String,
    total: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["received", "preparing", "ready", "completed", "cancelled"],
      default: "received",
      index: true,
    },
    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    startedAt: Date,
    estimatedReadyTime: Date,
    readyAt: Date,
    preparationTime: Number,
  },
  {
    timestamps: true,
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
  },
);

// Virtual property for kitchenOrder ID
kitchenOrderSchema.virtual('id').get(function() {
  return this._id;
});

export const Restaurant = mongoose.model("Restaurant", restaurantSchema);
export const MenuItem = mongoose.model("MenuItem", menuItemSchema);
export const KitchenOrder = mongoose.model("KitchenOrder", kitchenOrderSchema);
export { restaurantSchema, menuItemSchema };
