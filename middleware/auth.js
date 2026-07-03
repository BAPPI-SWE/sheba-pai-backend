const jwt = require("jsonwebtoken");

// Gatekeeper: verifies the JWT on incoming requests.
// If valid, attaches the user's info to req.user and continues.
// If missing/invalid, blocks with 401.
function auth(req, res, next) {
  // Token arrives in the header as: "Authorization: Bearer <token>"
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = header.split(" ")[1]; // grab the part after "Bearer "

  try {
    // Verify signature + expiry using our secret.
    // If anyone tampered with the token, this throws.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach id + role so protected routes know who's calling
    req.user = decoded; // { id, role }
    next(); // let the request proceed to the actual route
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = auth;