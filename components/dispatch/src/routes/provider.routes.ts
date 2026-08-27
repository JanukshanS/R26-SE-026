/**
 * ============================================================================
 * Provider Routes
 * ============================================================================
 * 
 * REST API endpoints for managing service providers in the roadside
 * assistance network.
 * 
 * POST   /api/v1/providers          — Register a new provider
 * GET    /api/v1/providers          — List providers (with filters)
 * GET    /api/v1/providers/:id      — Get provider by ID
 * PATCH  /api/v1/providers/:id/status — Update provider availability
 * PATCH  /api/v1/providers/:id/location — Update provider location
 * PATCH  /api/v1/providers/:id/profile — Update name/phone/vehicle/services
 * GET    /api/v1/providers/:id/feedbacks — Resolution history + summary metrics
 * GET    /api/v1/providers/nearby   — Find nearby available providers
 * 
 * @module routes/provider
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { assertOwnsProvider } from '../middleware/auth';
import { createProviderSchema, locationSchema, updateProviderProfileSchema } from '../utils/validators';
import { getProviderCapabilities } from '../constants/capability-matrix';
import { ProviderType, ServiceType } from '../types';

export const providerRouter = Router();

/**
 * POST /api/v1/providers
 * Register a new service provider.
 * Capabilities are automatically derived from provider type using the capability matrix.
 */
providerRouter.post('/', async (req, res) => {
  try {
    const parsed = createProviderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid provider data',
        details: parsed.error.flatten(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { name, type, location, phone, vehiclePlate } = parsed.data;

    // Auto-derive capabilities from provider type
    const capabilities = getProviderCapabilities(type as ProviderType);

    const provider = await prisma.provider.create({
      data: {
        name,
        type: type as any,
        latitude: location.latitude,
        longitude: location.longitude,
        capabilities: capabilities as any[],
        phone,
        vehiclePlate,
        trustScore: 0.75, // Default trust score (mean from research)
      },
    });

    logger.info('Provider registered', {
      providerId: provider.id,
      name,
      type,
      capabilities,
    });

    res.status(201).json({
      success: true,
      data: provider,
      message: `Provider registered with capabilities: ${capabilities.join(', ')}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to register provider:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/providers
 * List all providers with optional filters.
 */
providerRouter.get('/', async (req, res) => {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = parseInt(String(req.query.limit || '50'), 10);
    const offset = parseInt(String(req.query.offset || '0'), 10);

    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const [providers, total] = await Promise.all([
      prisma.provider.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { trustScore: 'desc' },
      }),
      prisma.provider.count({ where }),
    ]);

    res.json({
      success: true,
      data: { providers, total },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to list providers:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/providers/:id
 * Get a specific provider by ID.
 */
providerRouter.get('/:id', async (req, res) => {
  try {
    const provider = await prisma.provider.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!provider) {
      res.status(404).json({
        success: false,
        error: 'Provider not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    return res.json({
      success: true,
      data: provider,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PATCH /api/v1/providers/:id/status
 * Update provider availability status (AVAILABLE, BUSY, OFFLINE).
 */
providerRouter.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['AVAILABLE', 'BUSY', 'OFFLINE'].includes(status)) {
      res.status(400).json({
        success: false,
        error: 'Invalid status. Must be AVAILABLE, BUSY, or OFFLINE',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const provider = await prisma.provider.update({
      where: { id: String(req.params.id) },
      data: { status: status as any },
    });

    logger.info('Provider status updated', {
      providerId: provider.id,
      newStatus: status,
    });

    res.json({
      success: true,
      data: provider,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PATCH /api/v1/providers/:id/location
 * Update provider's current GPS location.
 */
providerRouter.patch('/:id/location', async (req, res) => {
  try {
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid location',
        details: parsed.error.flatten(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const provider = await prisma.provider.update({
      where: { id: String(req.params.id) },
      data: {
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
      },
    });

    res.json({
      success: true,
      data: provider,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * PATCH /api/v1/providers/:id/profile
 * Update editable profile fields. `capabilities` must stay a subset of what
 * the provider's `type` can do (the fixed matrix is still the ceiling —
 * see capability-matrix.ts); `serviceTimes` keys must be a subset of the
 * resulting `capabilities`. Owner-only.
 */
providerRouter.patch('/:id/profile', async (req, res) => {
  try {
    const providerId = String(req.params.id);
    if (!(await assertOwnsProvider(req, res, providerId))) return;

    const parsed = updateProviderProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid profile update',
        details: parsed.error.flatten(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const existing = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Provider not found', timestamp: new Date().toISOString() });
      return;
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.phone !== undefined) data.phone = parsed.data.phone;
    if (parsed.data.vehiclePlate !== undefined) data.vehiclePlate = parsed.data.vehiclePlate;

    // Capabilities are validated BEFORE serviceTimes, and the resulting set
    // (new if provided, else the existing one) is what serviceTimes keys are
    // checked against below — so submitting both in one request narrows
    // capabilities and sets times for the narrowed set in a single step.
    let effectiveCapabilities = existing.capabilities as ServiceType[];
    if (parsed.data.capabilities !== undefined) {
      const allowed = new Set(getProviderCapabilities(existing.type as ProviderType));
      const notAllowed = parsed.data.capabilities.filter((c) => !allowed.has(c as ServiceType));
      if (notAllowed.length > 0) {
        res.status(400).json({
          success: false,
          error: `A ${existing.type} can't offer: ${notAllowed.join(', ')}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      effectiveCapabilities = parsed.data.capabilities as ServiceType[];
      data.capabilities = effectiveCapabilities;
    }

    if (parsed.data.serviceTimes !== undefined) {
      const offered = new Set(effectiveCapabilities);
      const notOffered = Object.keys(parsed.data.serviceTimes).filter((k) => !offered.has(k as ServiceType));
      if (notOffered.length > 0) {
        res.status(400).json({
          success: false,
          error: `Can't set a time-to-fix for a service you don't offer: ${notOffered.join(', ')}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      // Merge rather than replace: a partial update (one service's time
      // changed) must not silently drop times set for the others.
      data.serviceTimes = { ...(existing.serviceTimes as object), ...parsed.data.serviceTimes };
    }

    const provider = await prisma.provider.update({ where: { id: providerId }, data });

    logger.info('Provider profile updated', { providerId, fields: Object.keys(data) });

    res.json({ success: true, data: provider, timestamp: new Date().toISOString() });
  } catch (error: any) {
    logger.error('Failed to update provider profile:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/v1/providers/:id/feedbacks
 * A provider's own resolution history plus summary metrics (match rate,
 * average resolution time, average rating). Owner-only.
 */
providerRouter.get('/:id/feedbacks', async (req, res) => {
  try {
    const providerId = String(req.params.id);
    if (!(await assertOwnsProvider(req, res, providerId))) return;

    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10), 100);
    const offset = parseInt(String(req.query.offset || '0'), 10);

    const [feedbacks, total, matched, agg] = await Promise.all([
      prisma.resolutionFeedback.findMany({
        where: { providerId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.resolutionFeedback.count({ where: { providerId } }),
      prisma.resolutionFeedback.count({ where: { providerId, wasMatch: true } }),
      prisma.resolutionFeedback.aggregate({
        where: { providerId },
        _avg: { resolutionTimeMinutes: true, userRating: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        feedbacks,
        total,
        limit,
        offset,
        summary: {
          totalJobs: total,
          matchRate: total > 0 ? matched / total : null,
          averageResolutionTimeMinutes: agg._avg.resolutionTimeMinutes,
          averageRating: agg._avg.userRating,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to load provider feedback history:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

/**
 * GET /api/v1/providers/nearby
 * Find available providers near a given location.
 * Uses Haversine approximation for distance filtering.
 */
providerRouter.get('/nearby', async (req, res) => {
  try {
    const latStr = typeof req.query.latitude === 'string' ? req.query.latitude : undefined;
    const lngStr = typeof req.query.longitude === 'string' ? req.query.longitude : undefined;
    const radiusStr = typeof req.query.radiusKm === 'string' ? req.query.radiusKm : '25';
    const typeFilter = typeof req.query.type === 'string' ? req.query.type : undefined;

    if (!latStr || !lngStr) {
      res.status(400).json({
        success: false,
        error: 'latitude and longitude query parameters are required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    const radius = parseFloat(radiusStr);

    // Approximate bounding box for initial filter (1 degree ≈ 111km)
    const latDelta = radius / 111;
    const lngDelta = radius / (111 * Math.cos(lat * Math.PI / 180));

    const where: any = {
      status: 'AVAILABLE',
      latitude: { gte: lat - latDelta, lte: lat + latDelta },
      longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
    };

    if (typeFilter) where.type = typeFilter;

    const providers = await prisma.provider.findMany({ where });

    // Calculate actual distance using Haversine formula and filter
    const nearbyProviders = providers
      .map((p) => ({
        ...p,
        distanceKm: haversineDistance(lat, lng, p.latitude, p.longitude),
      }))
      .filter((p) => p.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    res.json({
      success: true,
      data: {
        providers: nearbyProviders,
        total: nearbyProviders.length,
        searchCenter: { latitude: lat, longitude: lng },
        radiusKm: radius,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Haversine distance between two GPS coordinates in kilometers.
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
