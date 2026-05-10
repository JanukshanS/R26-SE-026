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
 * GET    /api/v1/providers/nearby   — Find nearby available providers
 * 
 * @module routes/provider
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { createProviderSchema, locationSchema } from '../utils/validators';
import { getProviderCapabilities } from '../constants/capability-matrix';
import { ProviderType } from '../types';

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
