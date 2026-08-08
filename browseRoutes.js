/**
 * Browse-and-choose: paginated nearby helpers with full profile info,
 * and requesting specific helper(s).
 *
 * Wire into index.js:
 *   const browseRoutes = require("./browseRoutes");
 *   browseRoutes(app, { auth });
 */
const HelperProfile = require("./models/HelperProfile");
const HelperService = require("./models/HelperService");
const Service = require("./models/Service");
const Request = require("./models/Request");
const User = require("./models/User");

// Haversine distance in km between two [lng,lat] points
function distanceKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = function browseRoutes(app, deps) {
  const { auth } = deps;

  /**
   * GET /api/browse/helpers
   *   query: subServiceId, longitude, latitude, skip=0, limit=10
   * Returns nearby, available, approved helpers who OFFER that sub-service,
   * each with rating, profession, experience, distance, and price.
   * Sorted nearest-first, paginated (nearest 10, then see-more).
   */
  app.get("/api/browse/helpers", auth, async (req, res) => {
    try {
      const subServiceId = req.query.subServiceId;
      const longitude = parseFloat(req.query.longitude);
      const latitude = parseFloat(req.query.latitude);
      const skip = parseInt(req.query.skip) || 0;
      const limit = parseInt(req.query.limit) || 10;

      if (!subServiceId || isNaN(longitude) || isNaN(latitude)) {
        return res.status(400).json({ error: "subServiceId, longitude, latitude required" });
      }

      const sub = await Service.findById(subServiceId);
      if (!sub) return res.status(404).json({ error: "Service not found" });

      // Helpers who actively offer this sub-service
      const offerings = await HelperService.find({ service: subServiceId, isActive: true });
      if (offerings.length === 0) return res.json({ helpers: [], hasMore: false });

      const offeringByHelper = {};
      offerings.forEach((o) => { offeringByHelper[o.helper.toString()] = o; });
      const helperIds = offerings.map((o) => o.helper);

      // Their profiles must be approved + available, sorted by distance via $near
      const profiles = await HelperProfile.find({
        user: { $in: helperIds },
        isAvailable: true,
        verificationStatus: "approved",
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [longitude, latitude] },
            $maxDistance: 20000, // 20km ceiling
          },
        },
      })
        .populate("user", "name phone")
        .skip(skip)
        .limit(limit + 1); // fetch one extra to know if there's more

      const hasMore = profiles.length > limit;
      const page = profiles.slice(0, limit);

      const helpers = page.map((p) => {
        const offering = offeringByHelper[p.user._id.toString()];
        const [hLng, hLat] = p.location.coordinates;
        const dist = distanceKm(longitude, latitude, hLng, hLat);
        return {
          helperId: p.user._id,
          name: p.user.name,
          profession: p.profession || (p.roles && p.roles[0]) || null,
          ratingAvg: p.ratingAvg || 0,
          ratingCount: p.ratingCount || 0,
          yearsExperience: offering?.yearsExperience || 0,
          experienceNote: offering?.experienceNote || null,
          distanceKm: Math.round(dist * 10) / 10,
          chargeType: offering?.chargeType || sub.chargeType,
          amount: offering?.amount ?? sub.adminAmount ?? null,
        };
      });

      res.json({ helpers, hasMore });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * POST /api/browse/request
   *   body: { subServiceId, serviceName, roles, longitude, latitude, helperIds: [] }
   * Creates ONE request targeted at the chosen helpers. First to accept wins.
   */
  app.post("/api/browse/request", auth, async (req, res) => {
    try {
      const { subServiceId, serviceName, roles, longitude, latitude, helperIds } = req.body;
      if (!Array.isArray(helperIds) || helperIds.length === 0) {
        return res.status(400).json({ error: "Pick at least one helper" });
      }
      if (longitude === undefined || latitude === undefined) {
        return res.status(400).json({ error: "longitude and latitude required" });
      }

      const roleList = Array.isArray(roles) && roles.length ? roles : [];
      const request = new Request({
        patient: req.user.id,
        role: roleList[0] || "any",
        acceptedRoles: roleList,
        serviceName: serviceName || "Service",
        location: { type: "Point", coordinates: [longitude, latitude] },
        targetedHelpers: helperIds,
      });
      const saved = await request.save();

      // Notify only the chosen helpers
      const io = req.app.get("io");
      helperIds.forEach((hid) => io.to(hid.toString()).emit("newRequest", saved));

      res.status(201).json({ request: saved, targeted: helperIds.length });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};