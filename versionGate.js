/**
 * Forced app updates — the SERVER side.
 *
 * The mobile app sends its version code in an `X-App-Version-Code` header on
 * every request. If that number is below the minimum the admin has set
 * (Settings → App updates), the request is refused with HTTP 426 "Upgrade
 * Required", and the app shows a full-screen "Update now" page. This is the
 * hard stop: even if the app's own check were skipped, an out-of-date version
 * simply stops working.
 *
 * Deliberate behaviours:
 *   - NO header (the admin panel, scripts, and app versions released before
 *     this feature existed) → never blocked. Those old versions can't show the
 *     update page anyway, so blocking them would only break them silently.
 *   - GET /api/app-version is never blocked — it is how the app finds out.
 *   - Minimum 0 (the default) means the whole feature is off.
 *   - The minimum is cached for 30 seconds, so this adds no database query to
 *     almost every request.
 *   - `highestSeenVersionCode` remembers the newest version any real phone has
 *     run. The admin panel refuses a minimum above it, so you can't require a
 *     version that nobody has been able to install yet.
 *
 * Wire into index.js (after express.json()):
 *   const { versionGate, versionRoutes } = require("./versionGate");
 *   app.use("/api", versionGate);
 *   versionRoutes(app);
 */
const PlatformSettings = require("./models/PlatformSettings");

const CACHE_TTL_MS = 30 * 1000;
const MAX_SANE_CODE = 1000000; // anything bigger is garbage, not a real version
let cache = { at: 0, min: 0, message: null, highestSeen: 0 };

async function loadConfig() {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache;
  try {
    const s = await PlatformSettings.findOne({ key: "global" })
      .select("minVersionCode updateMessage highestSeenVersionCode").lean();
    cache = {
      at: Date.now(),
      min: s?.minVersionCode || 0,
      message: s?.updateMessage || null,
      highestSeen: Math.max(s?.highestSeenVersionCode || 0, cache.highestSeen),
    };
  } catch (err) {
    // A database hiccup must never lock people out: keep the last known values
    // and look again in a few seconds.
    cache.at = Date.now() - CACHE_TTL_MS + 5000;
  }
  return cache;
}

/** Called when the admin saves, so the new minimum applies immediately. */
function invalidateVersionCache() { cache.at = 0; }

function parseCode(req) {
  const n = parseInt(req.headers["x-app-version-code"], 10);
  return Number.isFinite(n) && n > 0 && n < MAX_SANE_CODE ? n : null;
}

function recordSeen(code) {
  if (code <= cache.highestSeen) return;
  cache.highestSeen = code;
  // $max is atomic and idempotent: two phones reporting at once can't overwrite a higher number.
  PlatformSettings.updateOne({ key: "global" }, { $max: { highestSeenVersionCode: code } }).catch(() => {});
}

async function versionGate(req, res, next) {
  try {
    const code = parseCode(req);
    if (code === null || req.method === "OPTIONS") return next();

    const cfg = await loadConfig();
    recordSeen(code);

    if (req.path === "/app-version") return next(); // mounted at /api, so this is /api/app-version
    if (cfg.min > 0 && code < cfg.min) {
      return res.status(426).json({
        error: "Please update the app to continue",
        code: "UPDATE_REQUIRED",
        minVersionCode: cfg.min,
        message: cfg.message,
      });
    }
    next();
  } catch (err) {
    next(); // never let this check itself take the API down
  }
}

function versionRoutes(app) {
  /** What the app asks at launch and whenever it comes back to the foreground. */
  app.get("/api/app-version", async (req, res) => {
    const cfg = await loadConfig();
    res.set("Cache-Control", "no-store");
    res.json({ minVersionCode: cfg.min, message: cfg.message });
  });
}

module.exports = { versionGate, versionRoutes, invalidateVersionCache, _test: { parseCode, resetCache: () => { cache = { at: 0, min: 0, message: null, highestSeen: 0 }; } } };
