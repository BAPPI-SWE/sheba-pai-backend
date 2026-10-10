const mongoose = require("mongoose");

/**
 * A caregiver booking REQUEST in directory ("manual") mode.
 *
 * Nothing is dispatched automatically: a family sends a request from the
 * app (or calls / messages and the admin team records it), and the team
 * phones them, agrees the details and price, and assigns a caregiver.
 *
 *   new → contacted → confirmed → ongoing → completed
 *                 ↘ cancelled (from any open status)
 */
const SHIFTS = ["day8", "day12", "night12", "live24"];
const STATUSES = ["new", "contacted", "confirmed", "ongoing", "completed", "cancelled"];

const historySchema = new mongoose.Schema(
  {
    status: { type: String, enum: STATUSES },
    note: { type: String, default: null },
    by: { type: String, enum: ["patient", "admin", "system"], default: "system" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const careBookingSchema = new mongoose.Schema(
  {
    // Short code people can say on the phone: "SP-7K3M9Q".
    code: { type: String, required: true, unique: true },

    // The family's account. Optional: a booking taken over the phone for
    // someone without the app has no account (it is linked automatically
    // when the phone number matches a patient account).
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    source: { type: String, enum: ["app", "phone", "whatsapp", "admin"], default: "app" },

    category: { type: mongoose.Schema.Types.ObjectId, ref: "CareCategory", default: null },
    categoryName: { type: String, default: null }, // snapshot, English
    categoryNameBangla: { type: String, default: null },

    // The caregiver the family asked for by name (optional — "let Sheba Pai choose").
    requestedCaregiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    requestedCaregiverCode: { type: String, default: null },
    requestedCaregiverName: { type: String, default: null },

    planType: { type: String, enum: ["short", "regular"], default: "short" },
    shift: { type: String, enum: SHIFTS, default: "day12" },
    startDate: { type: Date, default: null },
    durationDays: { type: Number, default: null, min: 1, max: 365 }, // null = ongoing / not sure

    patientName: { type: String, default: null },
    patientAge: { type: Number, default: null, min: 0, max: 120 },
    patientGender: { type: String, enum: ["female", "male", null], default: null },
    conditionNote: { type: String, default: null, maxlength: 1000 },
    preferredGender: { type: String, enum: ["any", "female", "male"], default: "any" },

    division: { type: String, default: null },
    district: { type: String, required: true },
    area: { type: String, default: null },
    address: { type: String, default: null },

    contactName: { type: String, required: true },
    contactPhone: { type: String, required: true },
    note: { type: String, default: null, maxlength: 1000 },

    status: { type: String, enum: STATUSES, default: "new" },
    history: { type: [historySchema], default: [] },
    cancelReason: { type: String, default: null },
    cancelledBy: { type: String, enum: ["patient", "admin", null], default: null },

    // Set by the admin team after talking to the family.
    assignedCaregiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    agreedPrice: { type: Number, default: null, min: 0 },
    priceNote: { type: String, default: null }, // e.g. "per 12-hour shift", "per month"
    adminNotes: { type: String, default: null },

    review: {
      stars: { type: Number, min: 1, max: 5 },
      comment: { type: String, maxlength: 500 },
      at: { type: Date },
    },
  },
  { timestamps: true }
);

careBookingSchema.index({ status: 1, createdAt: -1 });
careBookingSchema.index({ patient: 1, createdAt: -1 });
careBookingSchema.index({ assignedCaregiver: 1, status: 1 });
careBookingSchema.index({ contactPhone: 1 });

careBookingSchema.statics.SHIFTS = SHIFTS;
careBookingSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("CareBooking", careBookingSchema);
