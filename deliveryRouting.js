/**
 * Decides HOW an order gets fulfilled — the single place this logic lives,
 * so checkout, the admin Orders view, and any future reporting all agree
 * on the same answer.
 *
 * The fee is decided ONCE, at order-creation time, from information we
 * already have (delivery coordinates + real-time shop stock) — never
 * asked as a form, and never changed after the fact even if a rider
 * takes a while to accept the job.
 */
const Shop = require("./models/Shop");
const ShopStock = require("./models/ShopStock");
const PlatformSettings = require("./models/PlatformSettings");

async function getSettings() {
  let s = await PlatformSettings.findOne({ key: "global" });
  if (!s) s = await PlatformSettings.create({ key: "global" });
  return s;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Computed silently from coordinates — never a form the customer fills in. */
async function isInsideDhaka(latitude, longitude) {
  const settings = await getSettings();
  const distance = haversineKm(latitude, longitude, settings.dhakaCenterLat, settings.dhakaCenterLng);
  return distance <= settings.dhakaRadiusKm;
}

/**
 * Find the single nearest APPROVED, OPEN shop within radius whose stock
 * fully covers every line item in the cart (v1 rule: one shop must cover
 * the whole order, or it doesn't count as a local match — see the design
 * discussion this was built from).
 *
 * items: [{ medicineId, quantity }]
 * Returns the matching Shop document, or null.
 */
async function findFullyCoveringShop(latitude, longitude, items) {
  const settings = await getSettings();

  const candidateShops = await Shop.find({
    verificationStatus: "approved",
    isOpen: true,
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [longitude, latitude] },
        $maxDistance: settings.shopMatchRadiusKm * 1000,
      },
    },
  });

  for (const shop of candidateShops) {
    const stocks = await ShopStock.find({
      shop: shop._id,
      medicine: { $in: items.map((i) => i.medicineId) },
    });
    const stockByMedicine = {};
    stocks.forEach((s) => { stockByMedicine[s.medicine.toString()] = s.stock; });

    const fullyCovered = items.every((item) => {
      const available = stockByMedicine[item.medicineId.toString()] || 0;
      return available >= item.quantity;
    });

    if (fullyCovered) return shop; // $near already sorts nearest-first, so the first full match wins
  }
  return null;
}

/**
 * The one function checkout calls. Decides fulfillment type, fee, and
 * (if local) which shop — all in one atomic decision at order time.
 */
async function decideFulfillment(latitude, longitude, items) {
  const settings = await getSettings();
  const insideDhaka = await isInsideDhaka(latitude, longitude);
  const matchedShop = await findFullyCoveringShop(latitude, longitude, items);

  if (matchedShop) {
    return {
      fulfillmentType: "local",
      isInsideDhaka: insideDhaka,
      deliveryFee: settings.localDeliveryFee,
      matchedShop,
    };
  }

  return {
    fulfillmentType: "central",
    isInsideDhaka: insideDhaka,
    deliveryFee: insideDhaka ? settings.courierFeeInsideDhaka : settings.courierFeeOutsideDhaka,
    matchedShop: null,
  };
}

/** A short, easy-to-read-aloud pickup code — not a long database ID. */
function generatePickupCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

module.exports = { getSettings, haversineKm, isInsideDhaka, findFullyCoveringShop, decideFulfillment, generatePickupCode };