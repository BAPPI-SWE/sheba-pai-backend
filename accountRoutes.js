/**
 * Account deletion — required by Google Play for any app that lets people
 * create an account.
 *
 *   DELETE /api/me    body: { password }
 *
 * WHAT HAPPENS
 *   Removed:   name, phone, password, saved addresses, push token; every
 *              identity / verification document (NID, selfies, certificates,
 *              licence, service-requirement photos) — from the database AND
 *              from image storage; a helper's service listings; a shop's
 *              stock rows.
 *   Scrubbed:  the delivery address, phone and map coordinates stored on
 *              the person's past orders and bookings.
 *   Kept:      the order / booking / payment / rating records themselves,
 *              now pointing at "Deleted user" — needed for accounting and
 *              dispute handling. Prescription photos stay attached to their
 *              orders (pharmacy record-keeping); the privacy policy says so.
 *
 * WHAT STOPS IT
 *   Work in progress (an active booking, order or delivery) or money owed
 *   (a caregiver's unpaid commission). The person is told exactly why.
 *
 * The record is anonymized rather than removed so history keeps a valid
 * reference — removing it would leave orphaned orders pointing at nothing.
 *
 * Wire into index.js:
 *   const accountRoutes = require("./accountRoutes");
 *   accountRoutes(app, { auth, cloudinary });
 */
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("./models/User");
const HelperProfile = require("./models/HelperProfile");
const HelperService = require("./models/HelperService");
const RiderProfile = require("./models/RiderProfile");
const Shop = require("./models/Shop");
const ShopStock = require("./models/ShopStock");
const RequirementSubmission = require("./models/RequirementSubmission");
const OtpVerification = require("./models/OtpVerification");
const Request = require("./models/Request");
const Order = require("./models/Order");

const ACTIVE_REQUEST = ["searching", "accepted", "on_the_way", "helping"];
const OPEN_ORDER = { $nin: ["delivered", "cancelled"] };
const ACTIVE_DELIVERY = ["rider_assigned", "picked_up", "out_for_delivery"];

/** The first reason this account can't be deleted yet, or null. `code` lets the app show it in Bangla. */
async function findBlocker(user) {
  const id = user._id;
  if (user.role === "patient") {
    if (await Request.exists({ patient: id, status: { $in: ACTIVE_REQUEST } })) {
      return { code: "ACTIVE_REQUEST", error: "You have a caregiver request in progress. Please complete or cancel it first." };
    }
    if (await Order.exists({ patient: id, status: OPEN_ORDER })) {
      return { code: "ACTIVE_ORDER", error: "You have a medicine order in progress. Please wait until it is delivered or cancel it first." };
    }
  }
  if (user.role === "helper") {
    if (await Request.exists({ helper: id, status: { $in: ACTIVE_REQUEST } })) {
      return { code: "ACTIVE_JOB", error: "You have a job in progress. Please finish it first." };
    }
    const hp = await HelperProfile.findOne({ user: id }).select("commissionBalance").lean();
    if (hp && hp.commissionBalance > 0) {
      return { code: "COMMISSION_DUE", amount: hp.commissionBalance, error: `You still owe ৳${hp.commissionBalance} in commission. Please pay it first, or contact support.` };
    }
  }
  if (user.role === "rider") {
    if (await Order.exists({ assignedRider: id, status: { $in: ACTIVE_DELIVERY } })) {
      return { code: "ACTIVE_DELIVERY", error: "You have a delivery in progress. Please complete it first." };
    }
  }
  if (user.role === "shop") {
    const shop = await Shop.findOne({ owner: id }).select("_id").lean();
    if (shop && (await Order.exists({ matchedShop: shop._id, status: OPEN_ORDER }))) {
      return { code: "SHOP_ORDERS", error: "Your shop has orders in progress. Please finish them first." };
    }
  }
  return null;
}

/**
 * Cloudinary URL → public id, e.g.
 *   https://res.cloudinary.com/x/image/upload/v1712345678/nid/abc123.jpg → "nid/abc123"
 * Returns null for anything that doesn't look like a Cloudinary upload URL.
 */
function publicIdFromUrl(url) {
  if (typeof url !== "string") return null;
  const i = url.indexOf("/upload/");
  if (i === -1) return null;
  const parts = url.slice(i + "/upload/".length).split("/");
  const v = parts.findIndex((p) => /^v\d+$/.test(p)); // skip any transformation + the version segment
  const idParts = v >= 0 ? parts.slice(v + 1) : parts;
  if (idParts.length === 0) return null;
  idParts[idParts.length - 1] = idParts[idParts.length - 1].replace(/\.[a-zA-Z0-9]+$/, "");
  try { return decodeURIComponent(idParts.join("/")); } catch (e) { return idParts.join("/"); }
}

/** Best-effort removal from image storage. A failure here never blocks the deletion. */
async function destroyImages(cloudinary, urls) {
  const ids = [...new Set(urls.map(publicIdFromUrl).filter(Boolean))];
  let failed = 0;
  for (const id of ids) {
    try {
      await cloudinary.uploader.destroy(id, { resource_type: "image", invalidate: true });
    } catch (e) {
      failed++;
      console.error("account deletion: could not remove image", id, e.message);
    }
  }
  return { attempted: ids.length, failed };
}

module.exports = function accountRoutes(app, deps) {
  const { auth, cloudinary } = deps;

  app.delete("/api/me", auth, async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user || user.isDeleted) return res.status(404).json({ error: "Account not found" });
      if (user.role === "admin") {
        return res.status(403).json({ error: "Admin accounts can't be deleted from the app" });
      }

      // Re-enter the password: a stolen/unlocked phone shouldn't be able to
      // wipe an account in one tap.
      const password = String((req.body || {}).password || "");
      if (!password || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Incorrect password", code: "BAD_PASSWORD" });
      }

      const blocker = await findBlocker(user);
      if (blocker) return res.status(409).json(blocker);

      const id = user._id;
      const oldPhone = user.phone;
      const imageUrls = [];

      // --- identity / verification documents, by role ---
      if (user.role === "helper") {
        const hp = await HelperProfile.findOne({ user: id }).lean();
        if (hp) {
          imageUrls.push(hp.nidFrontUrl, hp.nidBackUrl, hp.policeClearanceUrl, ...(hp.selfieUrls || []), ...(hp.certificateUrls || []));
          await HelperProfile.updateOne({ _id: hp._id }, {
            $set: {
              nidFrontUrl: null, nidBackUrl: null, policeClearanceUrl: null, selfieUrls: [], certificateUrls: [],
              nidNumber: null, fullName: null, altPhone: null, rejectionReason: null,
              isAvailable: false, verificationStatus: "unsubmitted",
              location: { type: "Point", coordinates: [0, 0] },
            },
          });
        }
        await HelperService.deleteMany({ helper: id }); // stop being listed to patients
      }
      if (user.role === "rider") {
        const rp = await RiderProfile.findOne({ user: id }).lean();
        if (rp) {
          imageUrls.push(rp.nidFrontUrl, rp.nidBackUrl, rp.selfieUrl);
          await RiderProfile.updateOne({ _id: rp._id }, {
            $set: { nidFrontUrl: null, nidBackUrl: null, selfieUrl: null, nidNumber: null, isAvailable: false, verificationStatus: "unsubmitted" },
            $unset: { location: "" }, // a rider with no location is simply absent — see RiderProfile.js
          });
        }
      }
      if (user.role === "shop") {
        const shop = await Shop.findOne({ owner: id }).lean();
        if (shop) {
          imageUrls.push(shop.licenseUrl);
          await Shop.updateOne({ _id: shop._id }, {
            $set: { name: "Deleted shop", address: "Deleted", contactPhone: "Deleted", licenseUrl: null, isOpen: false, verificationStatus: "unsubmitted", rejectionReason: null },
          });
          await ShopStock.deleteMany({ shop: shop._id });
        }
      }

      // Photos submitted for service requirements / patient verification (any role)
      const subs = await RequirementSubmission.find({ user: id }).select("imageUrls").lean();
      subs.forEach((s) => imageUrls.push(...(s.imageUrls || [])));
      await RequirementSubmission.deleteMany({ user: id });

      // --- scrub personal details from the records we keep ---
      await Request.updateMany({ patient: id }, { $set: { address: null, roughArea: null } });
      // Only where coordinates exist: writing a partial GeoJSON into a
      // document that has none would corrupt the geo index.
      await Request.updateMany({ patient: id, "location.coordinates.0": { $exists: true } }, { $set: { "location.coordinates": [0, 0] } });
      await Order.updateMany({ patient: id }, { $set: { address: null, contactPhone: "deleted" } });
      await Order.updateMany({ patient: id, "location.coordinates.0": { $exists: true } }, { $set: { "location.coordinates": [0, 0] } });

      // --- anonymize the account itself ---
      await User.updateOne({ _id: id }, {
        $set: {
          name: "Deleted user",
          phone: `deleted-${id}`, // frees the real number for a future signup
          password: await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10), // unguessable: no login possible
          pushToken: null,
          savedAddresses: [],
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
      await OtpVerification.deleteOne({ phone: oldPhone });
      auth.markDeleted(id); // the 7-day login token stops working immediately

      // Last, and non-fatal: remove the actual image files.
      const images = await destroyImages(cloudinary, imageUrls.filter(Boolean));
      console.log(`account deleted: ${id} (${user.role}); images removed ${images.attempted - images.failed}/${images.attempted}`);

      res.json({ ok: true });
    } catch (err) {
      console.error("account deletion failed:", err);
      res.status(500).json({ error: "Could not delete the account. Please try again or contact support." });
    }
  });
};

// Exposed for unit testing only.
module.exports._test = { publicIdFromUrl };