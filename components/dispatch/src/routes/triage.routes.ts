/**
 * Triage Routes — Diagnostic Questionnaire + Probability Engine
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { DASHBOARD_LAMPS, ENGINE_SOUNDS } from '../types';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { submitTriageSchema } from '../utils/validators';
import { runTriageEngine } from '../services/triage-engine';

export const triageRouter = Router();

/** GET /api/v1/triage/questions — Returns the 8-question diagnostic schema */
triageRouter.get('/questions', (_req, res) => {
  const questions = [
    {
      id: 'Q1', question: 'Is there any visible damage to the vehicle?',
      type: 'SINGLE_SELECT', required: true, order: 1,
      options: [
        { value: 'CRASH', label: 'Serious crash damage' },
        { value: 'MINOR', label: 'Minor damage' },
        { value: 'NONE', label: 'No visible damage' },
      ],
    },
    {
      id: 'Q2', question: 'Can you start the engine?',
      type: 'SINGLE_SELECT', required: true, order: 2,
      options: [
        { value: 'YES', label: 'Yes, runs normally' },
        { value: 'NO', label: 'No, won\'t start' },
        { value: 'PARTIAL', label: 'Cranks but won\'t start' },
      ],
    },
    {
      id: 'Q3', question: 'What sound does the engine make?',
      type: 'AUDIO_PICKER', required: false, order: 3,
      conditionalOn: { questionId: 'Q2', showWhen: ['NO', 'PARTIAL'] },
      options: ENGINE_SOUNDS.map((s) => ({ value: s, label: engineSoundLabel(s), hint: engineSoundHint(s) })),
    },
    {
      id: 'Q4', question: 'Which dashboard warning lights are on?',
      type: 'ICON_MULTI_SELECT', required: true, order: 4,
      helpText: 'Tap all warning lights currently lit on your dashboard',
      options: DASHBOARD_LAMPS.map((l) => ({ value: l, label: lampLabel(l), icon: l.toLowerCase() })),
    },
    {
      id: 'Q5', question: 'Is there any fluid leaking under the vehicle?',
      type: 'SINGLE_SELECT', required: false, order: 5,
      options: [
        { value: 'YES_COOLANT', label: 'Yes — green/orange liquid (coolant)' },
        { value: 'YES_OIL', label: 'Yes — dark/brown liquid (oil)' },
        { value: 'YES_FUEL', label: 'Yes — with fuel smell' },
        { value: 'YES_UNKNOWN', label: 'Yes — not sure what type' },
        { value: 'NO', label: 'No leaks visible' },
      ],
    },
    {
      id: 'Q6', question: 'When did the problem start?',
      type: 'SINGLE_SELECT', required: true, order: 6,
      options: [
        { value: 'JUST_NOW', label: 'Just now / Suddenly' },
        { value: 'TODAY', label: 'Earlier today' },
        { value: 'GRADUAL', label: 'Gradually getting worse' },
      ],
    },
    {
      id: 'Q7', question: 'Do you notice any unusual smells?',
      type: 'SINGLE_SELECT', required: true, order: 7,
      options: [
        { value: 'BURNING', label: 'Burning smell' },
        { value: 'FUEL', label: 'Fuel/petrol smell' },
        { value: 'ROTTEN_EGGS', label: 'Rotten eggs / Sulfur' },
        { value: 'NONE', label: 'No unusual smells' },
      ],
    },
    {
      id: 'Q8', question: 'Did you notice any warning signs recently?',
      type: 'MULTI_SELECT', required: true, order: 8,
      options: [
        { value: 'FLICKERING_LIGHTS', label: 'Flickering dashboard/headlights' },
        { value: 'POWER_LOSS', label: 'Loss of power while driving' },
        { value: 'UNUSUAL_NOISES', label: 'Unusual noises' },
        { value: 'NONE', label: 'No recent warning signs' },
      ],
    },
  ];

  res.json({
    success: true,
    data: { questions, totalQuestions: questions.length, version: '1.0.0' },
    timestamp: new Date().toISOString(),
  });
});

/** POST /api/v1/triage/submit — Submit responses and get probability distribution */
triageRouter.post('/submit', async (req, res) => {
  try {
    // Validate input
    const parsed = submitTriageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, error: 'Invalid triage submission',
        details: parsed.error.flatten(), timestamp: new Date().toISOString(),
      });
      return;
    }

    const { incidentId, responses } = parsed.data;

    // Verify incident exists and is in correct state
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found', timestamp: new Date().toISOString() });
      return;
    }

    // Run the Diagnostic Triage Engine (Tier 1: Questionnaire-Only)
    const triageResult = runTriageEngine(responses as any);

    // Persist triage response and result to database
    const triageRecord = await prisma.triageResponse.create({
      data: {
        incidentId,
        visibleDamage: responses.visibleDamage,
        canStartEngine: responses.canStartEngine,
        engineSound: responses.engineSound ?? null,
        dashboardLamps: responses.dashboardLamps,
        fluidLeaking: responses.fluidLeaking ?? null,
        problemOnset: responses.problemOnset,
        unusualSmells: responses.unusualSmells,
        recentWarnings: responses.recentWarnings,
        probabilities: triageResult.probabilities as any,
        predictedServiceType: triageResult.predictedServiceType,
        confidence: triageResult.confidence,
        tier: triageResult.tier,
        entropy: triageResult.entropy,
        obdDataUsed: triageResult.obdDataUsed,
        bayesianPriorsApplied: triageResult.bayesianPriorsApplied,
      },
    });

    // Update incident status to TRIAGING → DISPATCHING
    await prisma.incident.update({
      where: { id: incidentId },
      data: { status: 'DISPATCHING' },
    });

    logger.info('Triage submitted and processed', {
      incidentId,
      predictedServiceType: triageResult.predictedServiceType,
      confidence: triageResult.confidence.toFixed(3),
      tier: triageResult.tier,
    });

    res.json({
      success: true,
      data: {
        triageId: triageRecord.id,
        incidentId,
        result: triageResult,
        message: `Diagnosis: ${triageResult.predictedServiceType} (${(triageResult.confidence * 100).toFixed(1)}% confidence)`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Triage submission failed:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

function engineSoundLabel(s: string): string {
  const m: Record<string, string> = {
    RAPID_CLICKING: 'Rapid clicking sound',
    SINGLE_CLICK: 'Single click then silence',
    GRINDING_WHIRRING: 'Grinding or whirring',
    CRANKS_NO_START: 'Cranks normally but won\'t fire',
    NO_SOUND: 'Complete silence',
  };
  return m[s] || s;
}

function engineSoundHint(s: string): string {
  const m: Record<string, string> = {
    RAPID_CLICKING: 'Weak battery or bad solenoid',
    SINGLE_CLICK: 'Failed starter motor',
    GRINDING_WHIRRING: 'Starter gear or flywheel damage',
    CRANKS_NO_START: 'Fuel delivery or ignition issue',
    NO_SOUND: 'Complete electrical failure / dead battery',
  };
  return m[s] || '';
}

function lampLabel(l: string): string {
  const m: Record<string, string> = {
    BATTERY: 'Battery / Charging', CHECK_ENGINE: 'Check Engine',
    OIL_PRESSURE: 'Oil Pressure', TEMPERATURE: 'Engine Temperature',
    ABS: 'ABS', BRAKE: 'Brake System', AIRBAG: 'Airbag / SRS',
    TIRE_PRESSURE: 'Tire Pressure', TRANSMISSION: 'Transmission',
  };
  return m[l] || l;
}
