/**
 * Ratings: submit after a completed job, and read a user's rating summary.
 * Wire into index.js:
 *   const ratingsRoutes = require("./ratingsRoutes");
 *   ratingsRoutes(app, { auth });
 */
const Rating = require("./models/Rating");
const Request = require("./models/Request");
const User = require("./models/User");
const HelperProfile = require("./models/HelperProfile");

module.exports = function ratingsRoutes(app, deps) {
  const { auth } = deps;

  // Submit a rating for a completed job.
  app.post("/api/requests/:id/rate", auth, async (req, res) => {
    try {
      const { stars, comment } = req.body;
      if (!stars || stars < 1 || stars > 5) {
        return res.status(400).json({ error: "stars must be 1-5" });
      }

      const request = await Request.findById(req.params.id);
      if (!request) return res.status(404).json({ error: "Request not found" });
      if (request.status !== "completed") {
        return res.status(400).json({ error: "You can only rate a completed job" });
      }

      // Determine rater and ratee from the job
      const meId = req.user.id;
      const patientId = request.patient?.toString();
      const helperId = request.helper?.toString();
      if (meId !== patientId && meId !== helperId) {
        return res.status(403).json({ error: "You were not part of this job" });
      }

      const rateeId = meId === patientId ? helperId : patientId;
      const rateeRole = meId === patientId ? "helper" : "patient";
      if (!rateeId) return res.status(400).json({ error: "No counterpart to rate" });

      // Create (unique index prevents double-rating)
      let rating;
      try {
        rating = await new Rating({
          request: request._id,
          rater: meId,
          ratee: rateeId,
          rateeRole,
          stars,
          comment: comment || null,
        }).save();
      } catch (e) {
        if (e.code === 11000) {
          return res.status(400).json({ error: "You already rated this job" });
        }
        throw e;
      }

      // Recompute the ratee's aggregate
      const agg = await Rating.aggregate([
        { $match: { ratee: rating.ratee } },
        { $group: { _id: "$ratee", avg: { $avg: "$stars" }, count: { $sum: 1 } } },
      ]);
      const avg = agg[0]?.avg || stars;
      const count = agg[0]?.count || 1;

      // Store aggregate where it's read from: helper -> HelperProfile, patient -> User
      if (rateeRole === "helper") {
        await HelperProfile.findOneAndUpdate(
          { user: rateeId },
          { ratingAvg: avg, ratingCount: count }
        );
      } else {
        await User.findByIdAndUpdate(rateeId, { ratingAvg: avg, ratingCount: count });
      }

      res.status(201).json({ rating, ratingAvg: avg, ratingCount: count });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Has the current user already rated this job? (to show/hide the prompt)
  app.get("/api/requests/:id/my-rating", auth, async (req, res) => {
    try {
      const rating = await Rating.findOne({ request: req.params.id, rater: req.user.id });
      res.json({ rated: !!rating, rating: rating || null });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Recent reviews for a user (for profiles later)
  app.get("/api/users/:id/ratings", async (req, res) => {
    try {
      const ratings = await Rating.find({ ratee: req.params.id })
        .populate("rater", "name")
        .sort({ createdAt: -1 })
        .limit(20);
      res.json(ratings);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};