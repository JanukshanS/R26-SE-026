-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('BATTERY_JUMP', 'BATTERY_TERMINAL_CLEAN', 'BATTERY_REPLACE', 'ALTERNATOR_ISSUE', 'STARTER_MOTOR', 'COOLANT_LOW', 'RADIATOR_FAN_ISSUE', 'RADIATOR_HOSE_LEAK', 'ENGINE_OVERHEAT_SEVERE', 'BELT_BROKEN', 'FUEL_FILTER_CLOGGED', 'FUEL_PUMP', 'IGNITION_SYSTEM', 'ELECTRICAL_FAULT_RAIN', 'BRAKE_PAD_WORN', 'BRAKE_FAILURE', 'CLUTCH_WORN', 'TRANSMISSION_ISSUE', 'SEVERE_MECHANICAL_TOW', 'LOCKOUT', 'KEY_LOST', 'FLAT_TIRE_CHANGE', 'FUEL_EMPTY', 'FUEL_WRONG', 'LIGHT_BULB', 'BLOWN_FUSE', 'MAJOR_ACCIDENT', 'URGENT_TOW', 'FLOOD_RECOVERY');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('MOBILE_MECHANIC', 'FUEL_DELIVERY', 'LOCKSMITH', 'TOW_LIGHT', 'TOW_HEAVY');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('CREATED', 'TRIAGING', 'DISPATCHING', 'PROVIDER_ASSIGNED', 'EN_ROUTE', 'ON_SCENE', 'RESOLVED', 'ESCALATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('AVAILABLE', 'BUSY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "TriageTier" AS ENUM ('QUESTIONNAIRE_ONLY', 'OBD_ENHANCED', 'BAYESIAN_LEARNED');

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'CREATED',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "vehicleMake" TEXT,
    "vehicleModel" TEXT,
    "vehicleYear" INTEGER,
    "fuelType" TEXT,
    "registrationNo" TEXT,
    "hasOBD" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "assignedProviderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_responses" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "q1Intent" TEXT NOT NULL,
    "q2EngineStart" TEXT NOT NULL,
    "q2bRunningIssue" TEXT NOT NULL,
    "q3Sound" TEXT NOT NULL,
    "q3bElectrical" TEXT NOT NULL,
    "q4NoiseDetail" TEXT NOT NULL,
    "q7OverheatDetail" TEXT NOT NULL,
    "q8SmokeColor" TEXT NOT NULL,
    "qBrakeDetail" TEXT NOT NULL,
    "qGearDetail" TEXT NOT NULL,
    "q6Smells" TEXT NOT NULL,
    "q5Lights" TEXT[],
    "q9Recent" TEXT[],
    "locationType" TEXT NOT NULL,
    "recentRain" TEXT NOT NULL,
    "parkedOvernight" TEXT NOT NULL,
    "vehicleAgeBucket" TEXT NOT NULL,
    "lastFueled" TEXT NOT NULL,
    "probabilities" JSONB NOT NULL,
    "predictedServiceType" "ServiceType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "tier" "TriageTier" NOT NULL,
    "entropy" DOUBLE PRECISION NOT NULL,
    "obdDataUsed" BOOLEAN NOT NULL DEFAULT false,
    "bayesianPriorsApplied" BOOLEAN NOT NULL DEFAULT false,
    "obdData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'AVAILABLE',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "capabilities" "ServiceType"[],
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "totalJobs" INTEGER NOT NULL DEFAULT 0,
    "successfulJobs" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION,
    "phone" TEXT,
    "vehiclePlate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_decisions" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "expectedCost" DOUBLE PRECISION NOT NULL,
    "estimatedTravelTimeMin" DOUBLE PRECISION NOT NULL,
    "estimatedServiceTimeMin" DOUBLE PRECISION NOT NULL,
    "mismatchRisk" DOUBLE PRECISION NOT NULL,
    "costBreakdown" JSONB NOT NULL,
    "trafficImpactScore" DOUBLE PRECISION NOT NULL,
    "lambdaUsed" DOUBLE PRECISION NOT NULL,
    "accepted" BOOLEAN,
    "declineReason" TEXT,
    "responseTimeSeconds" INTEGER,
    "computationTimeMs" DOUBLE PRECISION NOT NULL,
    "totalProvidersEvaluated" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolution_feedbacks" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "predictedDistribution" JSONB NOT NULL,
    "predictedServiceType" "ServiceType" NOT NULL,
    "predictedConfidence" DOUBLE PRECISION NOT NULL,
    "actualServiceType" "ServiceType" NOT NULL,
    "wasMatch" BOOLEAN NOT NULL,
    "resolutionTimeMinutes" DOUBLE PRECISION NOT NULL,
    "reDispatches" INTEGER NOT NULL DEFAULT 0,
    "userRating" DOUBLE PRECISION,
    "providerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bayesian_priors" (
    "id" TEXT NOT NULL,
    "symptomKey" TEXT NOT NULL,
    "probabilities" JSONB NOT NULL,
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "currentLearningRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bayesian_priors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_latitude_longitude_idx" ON "incidents"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "incidents_createdAt_idx" ON "incidents"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "triage_responses_incidentId_key" ON "triage_responses"("incidentId");

-- CreateIndex
CREATE INDEX "providers_type_status_idx" ON "providers"("type", "status");

-- CreateIndex
CREATE INDEX "providers_latitude_longitude_idx" ON "providers"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "dispatch_decisions_incidentId_idx" ON "dispatch_decisions"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "resolution_feedbacks_incidentId_key" ON "resolution_feedbacks"("incidentId");

-- CreateIndex
CREATE INDEX "resolution_feedbacks_actualServiceType_idx" ON "resolution_feedbacks"("actualServiceType");

-- CreateIndex
CREATE INDEX "resolution_feedbacks_wasMatch_idx" ON "resolution_feedbacks"("wasMatch");

-- CreateIndex
CREATE INDEX "resolution_feedbacks_createdAt_idx" ON "resolution_feedbacks"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bayesian_priors_symptomKey_key" ON "bayesian_priors"("symptomKey");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assignedProviderId_fkey" FOREIGN KEY ("assignedProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_responses" ADD CONSTRAINT "triage_responses_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_decisions" ADD CONSTRAINT "dispatch_decisions_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_decisions" ADD CONSTRAINT "dispatch_decisions_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_feedbacks" ADD CONSTRAINT "resolution_feedbacks_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolution_feedbacks" ADD CONSTRAINT "resolution_feedbacks_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
