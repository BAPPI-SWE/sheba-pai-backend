const mongoose = require("mongoose");

/**
 * A helper's manual commission payment declaration (bKash/Nagad/Rocket).
 * Admin cross-checks against their own MFS merchant panel and approves/rejects.
 */
const paymentSubmissionSchema = new mongoose.Schema(
  {
    helper: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    method: { type: String, enum: ["bkash", "nagad", "rocket"], required: true },
    senderPhone: { type: String, required: true },
    transactionId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentSubmission", paymentSubmissionSchema);