/** Shared types for the public "report without the app" claim-link flow
 * (src/app/claim). Mirrors apps/mobile's insurance-claim data shapes closely
 * enough that the two stay easy to keep in sync by hand. */

export type HeightStep = "overhead" | "chest" | "waist";
export const HEIGHT_STEPS: HeightStep[] = ["overhead", "chest", "waist"];

export type StopPhoto = {
  stopIndex: number;
  heightStep: HeightStep;
  blob: Blob;
  capturedAtIso: string;
};

export type LocationSnapshot = {
  capturedAtIso: string;
  capturedAtDisplayLocal: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  locationPermission: "granted" | "denied" | "unavailable";
  locationLabel: string | null;
};

/** What the claim-link token (minted by the insurer dashboard) carries. */
export type ClaimLinkIdentity = {
  nic: string;
  plateNumber: string;
};

/** What verify-claimant resolves the NIC + plate to, once confirmed. */
export type VerifiedClaimant = {
  fullName: string;
  licenceNumber: string;
  vehicleId: string;
  vehicleModel: string;
  plateNumber: string;
  insuranceProvider: string | null;
  policyNumber: string | null;
  insuranceExpireMonth: string | null;
};

export type ClaimStage =
  | "verify"
  | "callInsurer"
  | "guidedCaptureIntro"
  | "guidedCapture"
  | "drivingLicence"
  | "userVerification"
  | "thirdParty"
  | "submit"
  | "done";

export const STAGE_ORDER: ClaimStage[] = [
  "verify",
  "callInsurer",
  "guidedCaptureIntro",
  "guidedCapture",
  "drivingLicence",
  "userVerification",
  "thirdParty",
  "submit",
  "done",
];
