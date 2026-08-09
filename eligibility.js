const Requirement = require("./models/Requirement");
const RequirementSubmission = require("./models/RequirementSubmission");
const Service = require("./models/Service");

/**
 * Compute whether a user satisfies every MANDATORY requirement for a service.
 * Checks the sub-service's own requirements AND its parent's (common) ones.
 *
 * Returns { eligible, missing: [requirement], pending: [requirement] }
 */
async function checkEligibility(userId, serviceId, forWhom) {
  const service = await Service.findById(serviceId);
  if (!service) return { eligible: false, missing: [], pending: [], error: "Service not found" };

  // Requirements = this service's + its parent's (if it's a sub-service)
  const serviceIds = [service._id];
  if (service.parent) serviceIds.push(service.parent);

  const requirements = await Requirement.find({
    service: { $in: serviceIds },
    forWhom,
    isActive: true,
  });

  const mandatory = requirements.filter((r) => r.isMandatory);
  if (mandatory.length === 0) {
    return { eligible: true, missing: [], pending: [], requirements };
  }

  const submissions = await RequirementSubmission.find({
    user: userId,
    requirement: { $in: mandatory.map((r) => r._id) },
  });

  const byReq = {};
  submissions.forEach((s) => { byReq[s.requirement.toString()] = s; });

  const missing = [];   // never submitted, or rejected
  const pending = [];   // submitted, awaiting review

  mandatory.forEach((r) => {
    const sub = byReq[r._id.toString()];
    if (!sub || sub.status === "rejected") missing.push(r);
    else if (sub.status === "pending") pending.push(r);
  });

  return {
    eligible: missing.length === 0 && pending.length === 0,
    missing,
    pending,
    requirements,
  };
}

/**
 * All requirements (mandatory + optional) that apply to a service,
 * with the user's current submission status for each.
 */
async function getRequirementsWithStatus(userId, serviceId, forWhom) {
  const service = await Service.findById(serviceId);
  if (!service) return [];

  const serviceIds = [service._id];
  if (service.parent) serviceIds.push(service.parent);

  const requirements = await Requirement.find({
    service: { $in: serviceIds },
    forWhom,
    isActive: true,
  }).populate("service", "name nameBangla parent");

  const submissions = await RequirementSubmission.find({
    user: userId,
    requirement: { $in: requirements.map((r) => r._id) },
  });

  const byReq = {};
  submissions.forEach((s) => { byReq[s.requirement.toString()] = s; });

  return requirements.map((r) => {
    const sub = byReq[r._id.toString()];
    return {
      requirement: r,
      // "common" = inherited from the parent main service
      scope: service.parent && r.service._id.toString() === service.parent.toString()
        ? "common" : "specific",
      status: sub ? sub.status : "not_submitted",
      imageUrls: sub ? sub.imageUrls : [],
      rejectionReason: sub ? sub.rejectionReason : null,
    };
  });
}

module.exports = { checkEligibility, getRequirementsWithStatus };

const HelperProfile = require("./models/HelperProfile");

/**
 * The single source of truth for "can this helper work this service right now?"
 * Requires BOTH:
 *   1. identity verification approved, AND
 *   2. all mandatory helper-requirements for the service (and its parent) approved.
 * Returns { cleared: bool, reason: string|null }.
 */
async function isHelperClearedForService(userId, serviceId) {
  const profile = await HelperProfile.findOne({ user: userId });
  if (!profile) return { cleared: false, reason: "no_profile" };
  if (profile.verificationStatus !== "approved") {
    return { cleared: false, reason: "identity_not_approved" };
  }
  const elig = await checkEligibility(userId, serviceId, "helper");
  if (!elig.eligible) return { cleared: false, reason: "requirements_not_approved" };
  return { cleared: true, reason: null };
}

module.exports.isHelperClearedForService = isHelperClearedForService;

/**
 * Whether a patient may request a service, based on the service's
 * patientVerificationMode and the patient's requirement submissions.
 * Returns { allowed, mode, needsUpload, reason }.
 *   - "none":     always allowed, no upload needed.
 *   - "submit":   allowed once docs are SUBMITTED (pending ok); needsUpload if missing.
 *   - "approved": allowed only when mandatory patient reqs are APPROVED.
 */
async function isPatientClearedForService(userId, serviceId) {
  const Service = require("./models/Service");
  const service = await Service.findById(serviceId);
  if (!service) return { allowed: false, mode: "none", needsUpload: false, reason: "no_service" };

  const mode = service.patientVerificationMode || "none";
  if (mode === "none") return { allowed: true, mode, needsUpload: false, reason: null };

  const elig = await checkEligibility(userId, serviceId, "patient");

  if (mode === "approved") {
    if (elig.eligible) return { allowed: true, mode, needsUpload: false, reason: null };
    // missing = never submitted or rejected; pending counts as not-yet-approved
    const needsUpload = elig.missing.length > 0;
    return { allowed: false, mode, needsUpload, reason: needsUpload ? "needs_upload" : "pending_approval" };
  }

  // mode === "submit": allowed once nothing mandatory is still missing
  // (pending is fine; only un-submitted/rejected blocks)
  if (elig.missing.length === 0) return { allowed: true, mode, needsUpload: false, reason: null };
  return { allowed: false, mode, needsUpload: true, reason: "needs_upload" };
}

module.exports.isPatientClearedForService = isPatientClearedForService;