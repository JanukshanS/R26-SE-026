/** report — en. Flat map of fully-qualified key → string. */
const report: Record<string, string> = {
  "report.action.back": "Back",
  "report.action.continue": "Continue",
  "report.action.done": "Done",
  "report.action.getHelp": "Get help",
  "report.action.next": "Next",
  "report.action.retry": "Try again",
  "report.crash.body":
    "1990 Suwa Seriya is the free ambulance service. We'll keep arranging the tow while you do.",
  "report.crash.title": "If anyone is hurt, call 1990 first.",
  "report.dispatch.assignedHeading": "Provider assigned",
  "report.dispatch.impactTooltip":
    "What this breakdown does to city traffic, scored 1-10 by the geo-intelligence service while dispatch was running. Context for road operators, not a ranking of who gets helped first.",
  "report.dispatch.impactValue": "{{score}}/10",
  "report.dispatch.minutes": "{{minutes}} min",
  "report.dispatch.noneBody":
    "Your report is filed and the diagnosis is saved — nobody has been assigned yet. Ops can see it, and the status updates in My Kaduna as soon as someone takes it.",
  "report.dispatch.noneTitle": "No providers available right now",
  "report.dispatch.providersEvaluated_one": "{{count}} provider",
  "report.dispatch.providersEvaluated_other": "{{count}} providers",
  "report.dispatch.rowConsidered": "Considered",
  "report.dispatch.rowEta": "Arrives in",
  "report.dispatch.rowImpact": "Traffic impact",
  "report.dispatch.rowType": "Type",
  "report.done.body":
    "Reference {{reference}}. Keep an eye on it — the status and the provider's phone number appear as soon as they accept.",
  "report.done.title": "That's everything we need",
  "report.done.track": "Track it in My Kaduna",
  "report.error.http": "{{message}} (HTTP {{status}})",
  "report.error.sessionExpired": "Your session expired. Sign out and back in, then report again.",
  "report.intent.unsureBody": "A few quick questions and we'll work out what you need.",
  "report.intent.unsureTitle": "Not sure what it is?",
  "report.notes.optional": "Optional",
  "report.notes.placeholder": "Parked on the shoulder just past the Malabe junction, hazards on.",
  "report.notes.title": "Anything else?",
  "report.page.title": "Report a breakdown",
  "report.pipeline.diagnosing": "Running the diagnosis…",
  "report.pipeline.failedBody":
    "{{message}} Nothing you answered has been lost — retrying picks up where it stopped.",
  "report.pipeline.failedTitle": "Couldn't finish your report",
  "report.pipeline.filing": "Filing your report…",
  "report.pipeline.matching": "Finding the closest provider…",
  "report.question.stepCounter": "{{topic}} · Step {{index}} of {{total}}",
  "report.triage.confidence": "({{percent}}%)",
  "report.triage.heading": "Looks like",
  "report.triage.percent": "{{percent}}%",
  "report.triage.tierNote":
    "Tier-1 diagnosis — questionnaire only. The mobile app adds live OBD telemetry when a dongle is paired.",
  "report.vehicle.groupLabel": "Vehicle",
  "report.vehicle.loadFailedTitle": "Couldn't load your vehicles",
  "report.vehicle.loading": "Loading your vehicles…",
  "report.vehicle.needPlate": "Add the number plate so we can match this report to you.",
  "report.vehicle.needVehicle": "Pick the vehicle that broke down.",
  "report.vehicle.noneBody":
    "You haven't added a vehicle yet. Type the plate instead — it's what links this report back to you, so you can follow it in My Kaduna.",
  "report.vehicle.plateLabel": "Number plate",
  "report.vehicle.title": "Which vehicle?",
  "report.where.body":
    "The provider is sent to this pin, so it has to be right. Phone GPS is often a block off — check the map and drag the pin if it's wrong.",
  "report.where.geoDenied":
    "Location permission was denied. Allow it in your browser, or just click the map below where you've broken down.",
  "report.where.geoFailed": "Couldn't read your location ({{message}}). Click the map below instead.",
  "report.where.geoUnsupported": "This browser can't share your location. Click the map below instead.",
  "report.where.locating": "Finding you…",
  "report.where.needLocation": "We need your location first.",
  "report.where.title": "Where are you?",
  "report.where.useMyLocation": "Use my location",
};

export default report;
