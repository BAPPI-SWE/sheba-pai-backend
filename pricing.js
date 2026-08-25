/**
 * The ONE place that decides what a medicine actually costs right now.
 *
 * Every screen that shows a price (search, browse, product page) and the
 * checkout endpoint that actually charges the customer all call this same
 * function. That's deliberate: a discount is only real if what's displayed
 * and what's charged can never disagree.
 */
function priceInfo(medicine) {
  const now = new Date();
  const hasDiscount = medicine.discountPercent > 0;
  const started = !medicine.discountStartsAt || now >= new Date(medicine.discountStartsAt);
  const notEnded = !medicine.discountEndsAt || now <= new Date(medicine.discountEndsAt);
  const onSale = hasDiscount && started && notEnded;

  const effectivePrice = onSale
    ? Math.round(medicine.price * (1 - medicine.discountPercent / 100) * 100) / 100
    : medicine.price;

  return {
    onSale,
    originalPrice: medicine.price,
    effectivePrice,
    discountPercent: onSale ? medicine.discountPercent : 0,
    discountEndsAt: onSale ? medicine.discountEndsAt : null,
  };
}

/** Attach { onSale, effectivePrice, discountPercent } onto a medicine object (mutates + returns it). */
function withPricing(medicineDoc) {
  const obj = typeof medicineDoc.toObject === "function" ? medicineDoc.toObject() : medicineDoc;
  return Object.assign(obj, priceInfo(obj));
}

module.exports = { priceInfo, withPricing };