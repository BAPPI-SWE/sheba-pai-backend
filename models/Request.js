const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema(
  {
    // Who asked for help (points to a User by id)
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // What service role they need, e.g. "Nurse"
    role: {
      type: String,
      required: true,
    },

    // Which helper won the request (empty until someone accepts)
    helper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // The request's current state — your state machine lives here.
    // enum = only these values are ever allowed.
    status: {
      type: String,
      enum: [
        "searching",
        "accepted",
        "on_the_way",
        "helping",
        "completed",
        "cancelled",
        "no_helper_found",
      ],
      default: "searching",
    },

    // Where the patient is (so the helper knows where to go)
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Request", requestSchema);