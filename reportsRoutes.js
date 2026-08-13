/**
 * Admin reports: accountability patterns (cancel/no-show) and commission overview.
 * Read-only aggregation endpoints — no state changes here.
 *
 * Wire into index.js:
 *   const reportsRoutes = require("./reportsRoutes");
 *   reportsRoutes(app, { auth, adminOnly });
 */
const User = require("./models/User");
const HelperProfile = require("./models/HelperProfile");

module.exports = function reportsRoutes(app, deps) {
  const { auth, adminOnly } = deps;

  /**
   * GET /api/admin/accountability
   * Returns patients and helpers with any cancel/no-show history,
   * sorted worst-first, so problem accounts surface immediately.
   */
  app.get("/api/admin/accountability", auth, adminOnly, async (req, res) => {
    try {
      const patients = await User.find({
        role: "patient",
        $or: [{ cancelCount: { $gt: 0 } }, { noShowCount: { $gt: 0 } }],
      })
        .select("name phone cancelCount noShowCount")
        .lean();
      patients.sort((a, b) => (b.cancelCount + b.noShowCount) - (a.cancelCount + a.noShowCount));

      const helperProfiles = await HelperProfile.find({
        $or: [{ cancelCount: { $gt: 0 } }, { noShowCount: { $gt: 0 } }],
      })
        .populate("user", "name phone")
        .select("user cancelCount noShowCount")
        .lean();
      const helpers = helperProfiles
        .filter((p) => p.user)
        .map((p) => ({
          _id: p.user._id, name: p.user.name, phone: p.user.phone,
          cancelCount: p.cancelCount, noShowCount: p.noShowCount,
        }))
        .sort((a, b) => (b.cancelCount + b.noShowCount) - (a.cancelCount + a.noShowCount));

      res.json({ patients, helpers });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/commission-overview
   * Platform-wide commission stats: outstanding total, restricted count,
   * and every helper currently carrying a balance, worst-first.
   */
  app.get("/api/admin/commission-overview", auth, adminOnly, async (req, res) => {
    try {
      const profiles = await HelperProfile.find({ commissionBalance: { $gt: 0 } })
        .populate("user", "name phone")
        .select("user commissionBalance oldestUnpaidDueDate totalEarned")
        .lean();

      const now = new Date();
      const withHelper = profiles.filter((p) => p.user);
      const owing = withHelper.map((p) => ({
        _id: p.user._id,
        name: p.user.name,
        phone: p.user.phone,
        commissionBalance: p.commissionBalance,
        dueDate: p.oldestUnpaidDueDate,
        overdue: p.oldestUnpaidDueDate ? now > new Date(p.oldestUnpaidDueDate) : false,
      }));
      owing.sort((a, b) => b.commissionBalance - a.commissionBalance);

      const totalOutstanding = owing.reduce((sum, o) => sum + o.commissionBalance, 0);
      const totalEarnedAll = await HelperProfile.aggregate([
        { $group: { _id: null, total: { $sum: "$totalEarned" } } },
      ]);
      const restrictedCount = owing.filter((o) => o.overdue).length;

      res.json({
        totalOutstanding,
        totalEarnedAll: totalEarnedAll[0]?.total || 0,
        restrictedCount,
        owing,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
};