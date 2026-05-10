/**
 * Triage Routes — adaptive questionnaire + decision-tree triage
 *
 * GET  /api/v1/triage/questions  — adaptive form schema (with branching rules)
 * POST /api/v1/triage/submit     — run the triage engine on submitted answers
 *
 * NOTE on persistence (Phase 1 status, May 2026):
 *   The /submit route currently runs the engine but DOES NOT persist the
 *   triage record to Postgres. Reason: the existing TriageResponse table
 *   uses the legacy column schema (visibleDamage, canStartEngine, ...) and
 *   the legacy ServiceType enum (9 values). The Prisma migration that
 *   widens both is task 1.7 of the roadmap and will land in the next
 *   session. Until then, persistence is intentionally skipped behind the
 *   `PERSIST_TRIAGE_RECORDS` flag below — flip it on AFTER the migration.
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { submitTriageSchema } from '../utils/validators';
import { runTriageEngine } from '../services/triage-engine';
import {
  Q1_ML_INTENTS, Q1_FAST_INTENTS,
  DASHBOARD_LAMPS, RECENT_WARNINGS,
} from '../types';

export const triageRouter = Router();

/** Persistence flag — true now that the Prisma migration (1.7) is live. */
const PERSIST_TRIAGE_RECORDS = true;

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/triage/questions  — adaptive form schema
// ─────────────────────────────────────────────────────────────────────────

triageRouter.get('/questions', (_req, res) => {
  res.json({
    success: true,
    data: {
      version: '2.0.0',
      adaptive: true,
      questions: [
        // ── Q1 intent picker (entry point) ─────────────────────────────
        {
          id: 'Q1_intent',
          question: 'What kind of help do you need?',
          type: 'INTENT_PICKER',
          required: true,
          options: [
            // ML-engaging (form continues to Q2)
            { value: 'WONT_START',     label: 'Engine won\'t start',           cohort: 'ML',   nextQuestion: 'Q2_engine_start' },
            { value: 'ENGINE_PROBLEM', label: 'Engine running but problem',    cohort: 'ML',   nextQuestion: 'Q2_engine_start' },
            { value: 'WEIRD_BEHAVIOR', label: 'Strange behaviour / not sure',  cohort: 'ML',   nextQuestion: 'Q2_engine_start' },
            { value: 'BRAKE_ISSUE',    label: 'Brake problem',                 cohort: 'ML',   nextQuestion: 'Q_brake_detail' },
            { value: 'GEAR_ISSUE',     label: 'Gear / transmission issue',     cohort: 'ML',   nextQuestion: 'Q_gear_detail' },
            // Fast-path (form ends, dispatch is deterministic)
            { value: 'LOCKOUT',             label: 'Locked out of vehicle',           cohort: 'FAST', dispatch: 'LOCKOUT',          skipRemaining: true },
            { value: 'KEY_LOST',            label: 'Lost the keys',                   cohort: 'FAST', dispatch: 'KEY_LOST',         skipRemaining: true },
            { value: 'FLAT_TIRE',           label: 'Flat tire',                       cohort: 'FAST', dispatch: 'FLAT_TIRE_CHANGE', skipRemaining: true },
            { value: 'FUEL_EMPTY',          label: 'Out of fuel',                     cohort: 'FAST', dispatch: 'FUEL_EMPTY',       skipRemaining: true },
            { value: 'FUEL_WRONG',          label: 'Wrong fuel filled',               cohort: 'FAST', dispatch: 'FUEL_WRONG',       skipRemaining: true },
            { value: 'LIGHT_BULB',          label: 'Headlight / taillight broken',    cohort: 'FAST', dispatch: 'LIGHT_BULB',       skipRemaining: true },
            { value: 'BLOWN_FUSE',          label: 'Specific accessory dead (fuse)',  cohort: 'FAST', dispatch: 'BLOWN_FUSE',       skipRemaining: true },
            { value: 'MAJOR_CRASH',         label: 'Major accident / crash',          cohort: 'FAST', dispatch: 'MAJOR_ACCIDENT',   skipRemaining: true, urgency: 'HIGH' },
            { value: 'FUEL_LEAK_FIRE_RISK', label: 'Fuel leak / smoke / fire risk',   cohort: 'FAST', dispatch: 'URGENT_TOW',       skipRemaining: true, urgency: 'CRITICAL' },
            { value: 'STUCK_FLOOD',         label: 'Stuck in flood / ditch / mud',    cohort: 'FAST', dispatch: 'FLOOD_RECOVERY',   skipRemaining: true },
          ],
        },
        // ── Q2 engine start ────────────────────────────────────────────
        {
          id: 'Q2_engine_start',
          question: 'What\'s the engine doing?',
          type: 'SINGLE_SELECT',
          required: true,
          showWhen: { Q1_intent: ['WONT_START', 'ENGINE_PROBLEM', 'WEIRD_BEHAVIOR'] },
          options: [
            { value: 'STARTS_NORMAL',    label: 'Starts and runs normally',          nextQuestion: 'Q2b_running_issue' },
            { value: 'STARTS_BUT_ISSUE', label: 'Starts but runs rough / stalls',    nextQuestion: 'Q2b_running_issue' },
            { value: 'CRANKS_NO_START',  label: 'Cranks but won\'t fire',            nextQuestion: 'Q3_sound' },
            { value: 'NO_CRANK',         label: 'No response — completely dead',     nextQuestion: 'Q3b_electrical' },
          ],
        },
        // ── Q2b running issue ─────────────────────────────────────────
        {
          id: 'Q2b_running_issue',
          question: 'What\'s the main problem while running?',
          type: 'SINGLE_SELECT',
          required: true,
          showWhen: { Q2_engine_start: ['STARTS_NORMAL', 'STARTS_BUT_ISSUE'] },
          options: [
            { value: 'OVERHEATING', label: 'Temperature gauge high / overheating',  nextQuestion: 'Q7_overheat_detail' },
            { value: 'NOISE',       label: 'Strange noise while driving',           nextQuestion: 'Q4_noise_detail' },
            { value: 'NO_POWER',    label: 'Loss of power / won\'t accelerate',     nextQuestion: null },
            { value: 'SMOKE',       label: 'Smoke from exhaust / engine bay',       nextQuestion: 'Q8_smoke_color' },
            { value: 'STALLING',    label: 'Engine stalls / dies while driving',    nextQuestion: null },
          ],
        },
        // ── Q3 sound (cranks-no-start path) ───────────────────────────
        {
          id: 'Q3_sound',
          question: 'What sound does it make when you try to start?',
          type: 'AUDIO_PICKER',
          required: true,
          showWhen: { Q2_engine_start: ['CRANKS_NO_START'] },
          options: [
            { value: 'RAPID_CLICKING',  label: 'Rapid clicking (tik-tik-tik)',     hint: 'Battery / loose terminals' },
            { value: 'SINGLE_CLICK',    label: 'Single loud click',                hint: 'Starter solenoid' },
            { value: 'NORMAL_CRANKING', label: 'Normal cranking (ruh-ruh-ruh)',    hint: 'Fuel or ignition' },
            { value: 'GRINDING',        label: 'Grinding / screeching',            hint: 'Starter / flywheel' },
            { value: 'NOTHING',         label: 'Complete silence',                 hint: 'Battery dead / electrical' },
            { value: 'WHIRRING',        label: 'Whirring without engaging',        hint: 'Starter bendix' },
          ],
        },
        // ── Q3b electrical (no-crank path) ────────────────────────────
        {
          id: 'Q3b_electrical',
          question: 'Are dashboard lights on?',
          type: 'SINGLE_SELECT',
          required: true,
          showWhen: { Q2_engine_start: ['NO_CRANK'] },
          options: [
            { value: 'ALL_DEAD_NO_LIGHTS', label: 'No lights at all'      },
            { value: 'DIM_LIGHTS',         label: 'Lights dim / flickering' },
            { value: 'SOME_LIGHTS_ON',     label: 'Some lights normal'    },
          ],
        },
        // ── Q4 noise detail ───────────────────────────────────────────
        {
          id: 'Q4_noise_detail',
          question: 'What kind of noise?',
          type: 'AUDIO_PICKER',
          required: true,
          showWhen: { Q2b_running_issue: ['NOISE'] },
          options: [
            { value: 'SQUEAL', label: 'Squealing (high-pitched)',  hint: 'Belt slipping / wear' },
            { value: 'KNOCK',  label: 'Knocking (rhythmic)',       hint: 'Engine timing / fuel' },
            { value: 'GRIND',  label: 'Grinding',                  hint: 'Brakes / bearing / starter' },
            { value: 'WHINE',  label: 'High-pitched whine',        hint: 'Alternator / power steering' },
            { value: 'CLUNK',  label: 'Clunking (intermittent)',   hint: 'Drivetrain / suspension' },
          ],
        },
        // ── Q7 overheat detail ────────────────────────────────────────
        {
          id: 'Q7_overheat_detail',
          question: 'When does it overheat?',
          type: 'SINGLE_SELECT',
          required: true,
          showWhen: { Q2b_running_issue: ['OVERHEATING'] },
          options: [
            { value: 'TRAFFIC_ONLY', label: 'Only in heavy traffic / when stopped' },
            { value: 'ALWAYS',       label: 'Even when driving normally' },
            { value: 'HILL_CLIMB',   label: 'Only when climbing hills' },
            { value: 'WITH_AC',      label: 'Only when AC is running' },
          ],
        },
        // ── Q8 smoke color ────────────────────────────────────────────
        {
          id: 'Q8_smoke_color',
          question: 'What color is the smoke?',
          type: 'SINGLE_SELECT',
          required: true,
          showWhen: { Q2b_running_issue: ['SMOKE'] },
          options: [
            { value: 'WHITE',              label: 'White smoke / steam',           hint: 'Coolant / head gasket' },
            { value: 'BLUE_GREY',          label: 'Blue / grey smoke',             hint: 'Burning oil' },
            { value: 'BLACK',              label: 'Black smoke',                   hint: 'Too much fuel' },
            { value: 'ELECTRICAL_BURNING', label: 'Smoke from dashboard / bonnet', hint: 'Electrical fire — STOP ENGINE', urgency: 'CRITICAL' },
          ],
        },
        // ── Q_brake_detail (only on BRAKE_ISSUE intent) ───────────────
        {
          id: 'Q_brake_detail',
          question: 'What\'s the brake doing?',
          type: 'SINGLE_SELECT',
          required: true,
          showWhen: { Q1_intent: ['BRAKE_ISSUE'] },
          options: [
            { value: 'SQUEALING',     label: 'Squealing under braking',  hint: 'Pads worn' },
            { value: 'GRINDING',      label: 'Grinding (metal-on-metal)', hint: 'Pads gone — replace immediately' },
            { value: 'PULL_ONE_SIDE', label: 'Pulls to one side',         hint: 'Caliper / hose' },
            { value: 'SOFT_PEDAL',    label: 'Pedal is soft / drops',     hint: 'Hydraulic failure — DO NOT DRIVE', urgency: 'CRITICAL' },
          ],
        },
        // ── Q_gear_detail (only on GEAR_ISSUE intent) ─────────────────
        {
          id: 'Q_gear_detail',
          question: 'What\'s the gearbox doing?',
          type: 'SINGLE_SELECT',
          required: true,
          showWhen: { Q1_intent: ['GEAR_ISSUE'] },
          options: [
            { value: 'SLIPPING',     label: 'Revs rise but no speed gain',          hint: 'Clutch slipping' },
            { value: 'WONT_ENGAGE',  label: 'Gear won\'t engage',                   hint: 'Transmission issue' },
            { value: 'GRINDING',     label: 'Grinding when shifting',               hint: 'Synchros worn' },
            { value: 'CLUTCH_SOFT',  label: 'Clutch pedal is soft / sinks',         hint: 'Clutch hydraulic' },
          ],
        },
        // ── Tail: Q5 lights, Q6 smells, Q9 recent (always asked) ──────
        {
          id: 'Q5_lights',
          question: 'Which dashboard warning lights are on?',
          type: 'ICON_MULTI_SELECT',
          required: false,
          options: DASHBOARD_LAMPS.map((l) => ({ value: l, label: l.replace('_', ' ') })),
        },
        {
          id: 'Q6_smells',
          question: 'Any unusual smells?',
          type: 'SINGLE_SELECT',
          required: true,
          options: [
            { value: 'BURNING_ELECTRICAL', label: 'Burning plastic / electrical' },
            { value: 'BURNING_OIL',        label: 'Burning oil / rubber'         },
            { value: 'FUEL_SMELL',         label: 'Strong fuel smell'            },
            { value: 'ROTTEN_EGGS',        label: 'Rotten eggs / sulfur'         },
            { value: 'SWEET',              label: 'Sweet smell (coolant)'        },
            { value: 'NO_SMELL',           label: 'No unusual smell'             },
          ],
        },
        {
          id: 'Q9_recent',
          question: 'Any warning signs in past few days?',
          type: 'MULTI_SELECT',
          required: false,
          options: RECENT_WARNINGS.map((w) => ({ value: w, label: w.replace('_', ' ') })),
        },
        // ── Sri Lankan context (always asked) ─────────────────────────
        {
          id: 'location_type',
          question: 'Where are you stranded?',
          type: 'SINGLE_SELECT', required: true,
          options: [
            { value: 'COASTAL', label: 'Coastal area' },
            { value: 'HILL',    label: 'Hill country' },
            { value: 'URBAN',   label: 'City / town'  },
            { value: 'RURAL',   label: 'Rural / off-highway' },
          ],
        },
        {
          id: 'recent_rain',
          question: 'Recent rain in your area?',
          type: 'SINGLE_SELECT', required: true,
          options: [
            { value: 'NONE',          label: 'None' },
            { value: 'YESTERDAY',     label: 'Yesterday' },
            { value: 'WITHIN_3_DAYS', label: 'Past 3 days' },
            { value: 'MONSOON',       label: 'Monsoon — heavy rain' },
          ],
        },
        {
          id: 'parked_overnight',
          question: 'Where was the vehicle parked overnight?',
          type: 'SINGLE_SELECT', required: true,
          options: [
            { value: 'INDOOR',  label: 'Garage / covered' },
            { value: 'OUTDOOR', label: 'Open / street'    },
          ],
        },
        {
          id: 'vehicle_age_bucket',
          question: 'How old is the vehicle?',
          type: 'SINGLE_SELECT', required: true,
          options: [
            { value: 'UNDER_3', label: 'Under 3 years' },
            { value: '3_7',    label: '3 to 7 years'  },
            { value: '8_15',   label: '8 to 15 years' },
            { value: 'OVER_15',label: 'Over 15 years' },
          ],
        },
        {
          id: 'last_fueled',
          question: 'When did you last fuel up?',
          type: 'SINGLE_SELECT', required: true,
          options: [
            { value: 'TODAY_NEW_STATION', label: 'Today — at a new/different station' },
            { value: 'TODAY_USUAL',       label: 'Today — at my usual station'        },
            { value: 'WITHIN_WEEK',       label: 'Within the past week'                },
            { value: 'OVER_WEEK',         label: 'More than a week ago'                },
          ],
        },
      ],
      mlIntents:   Q1_ML_INTENTS,
      fastIntents: Q1_FAST_INTENTS,
    },
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/triage/submit  — run engine, return result
// ─────────────────────────────────────────────────────────────────────────

triageRouter.post('/submit', async (req, res) => {
  try {
    const parsed = submitTriageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid triage submission',
        details: parsed.error.flatten(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { incidentId, responses, obdData } = parsed.data;

    // Confirm incident exists.
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      res.status(404).json({
        success: false, error: 'Incident not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Run the engine (decision tree, fast-path-aware).
    const triageResult = runTriageEngine(responses as any, obdData as any);

    // Persist the triage record to the new adaptive schema.
    let triageRecordId: string | null = null;
    if (PERSIST_TRIAGE_RECORDS) {
      const triageRecord = await prisma.triageResponse.create({
        data: {
          incidentId,

          // Q1 intent + adaptive single-selects
          q1Intent:         responses.Q1_intent,
          q2EngineStart:    responses.Q2_engine_start,
          q2bRunningIssue:  responses.Q2b_running_issue,
          q3Sound:          responses.Q3_sound,
          q3bElectrical:    responses.Q3b_electrical,
          q4NoiseDetail:    responses.Q4_noise_detail,
          q7OverheatDetail: responses.Q7_overheat_detail,
          q8SmokeColor:     responses.Q8_smoke_color,
          qBrakeDetail:     responses.Q_brake_detail,
          qGearDetail:      responses.Q_gear_detail,
          q6Smells:         responses.Q6_smells,

          // Multi-select tail
          q5Lights:         responses.Q5_lights,
          q9Recent:         responses.Q9_recent,

          // Sri Lankan context
          locationType:      responses.location_type,
          recentRain:        responses.recent_rain,
          parkedOvernight:   responses.parked_overnight,
          vehicleAgeBucket:  responses.vehicle_age_bucket,
          lastFueled:        responses.last_fueled,

          // Engine output
          probabilities:         triageResult.probabilities as any,
          predictedServiceType:  triageResult.predictedServiceType as any,
          confidence:            triageResult.confidence,
          tier:                  triageResult.tier,
          entropy:               triageResult.entropy,
          obdDataUsed:           triageResult.obdDataUsed,
          bayesianPriorsApplied: triageResult.bayesianPriorsApplied,

          // Optional OBD telemetry snapshot
          obdData: obdData ? (obdData as any) : undefined,
        },
      });
      triageRecordId = triageRecord.id;
    }

    // Move incident → DISPATCHING.
    await prisma.incident.update({
      where: { id: incidentId },
      data:  { status: 'DISPATCHING' },
    });

    logger.info('Triage submitted', {
      incidentId,
      triageRecordId,
      Q1_intent:            responses.Q1_intent,
      tier:                 triageResult.tier,
      predictedServiceType: triageResult.predictedServiceType,
      confidence:           triageResult.confidence.toFixed(3),
    });

    res.json({
      success: true,
      data: {
        incidentId,
        triageRecordId,
        result: triageResult,
        message: `Diagnosis: ${triageResult.predictedServiceType} (${(triageResult.confidence * 100).toFixed(1)}% confidence, tier ${triageResult.tier})`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Triage submission failed:', error);
    res.status(500).json({
      success: false, error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});
