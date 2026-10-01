const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Gatekeeper: verifies the JWT on incoming requests.
// If valid, attaches the user's info to req.user and continues.
// If missing/invalid, blocks with 401.
//
// It ALSO rejects tokens that belong to a deleted account. A JWT is valid
// for 7 days by itself, so without this a deleted user's old token would
// keep working. To avoid a database hit on every request, the answer is
// cached per user for a minute; a deletion is remembered immediately.
const DELETED_CHECK_TTL_MS = 60 * 1000;
const deletedCache = new Map(); // userId -> { deleted, at }

async function isAccountGone(userId) {
  const hit = deletedCache.get(userId);
  if (hit && Date.now() - hit.at < DELETED_CHECK_TTL_MS) return hit.deleted;
  const u = await User.findById(userId).select("isDeleted").lean();
  const deleted = !u || u.isDeleted === true; // flagged OR removed entirely
  deletedCache.set(userId, { deleted, at: Date.now() });
  return deleted;
}

async function auth(req, res, next) {
  // Token arrives in the header as: "Authorization: Bearer <token>"
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = header.split(" ")[1]; // grab the part after "Bearer "

  let decoded;
  try {
    // Verify signature + expiry using our secret.
    // If anyone tampered with the token, this throws.
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    if (await isAccountGone(String(decoded.id))) {
      return res.status(401).json({ error: "This account no longer exists" });
    }
  } catch (err) {
    // If the check itself fails (database hiccup), don't lock everyone out.
    console.error("auth: deleted-account check failed:", err.message);
  }

  req.user = decoded; // { id, role } — protected routes know who's calling
  next(); // let the request proceed to the actual route
}

// Called right after an account is deleted so its token stops working at once.
auth.markDeleted = (userId) => {
  deletedCache.set(String(userId), { deleted: true, at: Number.MAX_SAFE_INTEGER });
};

module.exports = auth;