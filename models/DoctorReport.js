const mongoose = require("mongoose");

/**
 * "This information is wrong" — sent by patients from a doctor's page.
 * Doctors change chambers, numbers and fees often; this is how stale
 * data gets noticed without anyone manually auditing the whole list.
 */
const doctorReportSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    reason: {
      type: String,
      enum: ["wrong_phone", "moved_chamber", "wrong_schedule", "wrong_fee", "not_practicing", "other"],
      required: true,
    },
    note: { type: String, default: "" },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DoctorReport", doctorReportSchema);