/**
 * ============================================================================
 * Database Seed — Sri Lankan provider network for Colombo metro
 * ============================================================================
 *
 * Seeds the database with sample service providers across the Colombo
 * metropolitan area. Provider capabilities are auto-derived from the
 * capability matrix (src/constants/capability-matrix.ts) so they always
 * stay in sync with the 29-class service-type catalog.
 *
 * Run: npm run prisma:seed
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import { PrismaClient, ProviderType, ServiceType } from '@prisma/client';
import { getProviderCapabilities } from '../src/constants/capability-matrix';

const prisma = new PrismaClient();

interface SeedProvider {
  name:   string;
  type:   ProviderType;
  lat:    number;
  lng:    number;
  phone?: string;
}

const PROVIDERS: SeedProvider[] = [
  // Mobile Mechanics (6)
  { name: 'Colombo Mobile Mechanic - Rajitha',  type: 'MOBILE_MECHANIC', lat: 6.9271, lng: 79.8612 },
  { name: 'Nugegoda Auto Repair - Kamal',       type: 'MOBILE_MECHANIC', lat: 6.8723, lng: 79.8897 },
  { name: 'Dehiwala Mechanic Service - Suresh', type: 'MOBILE_MECHANIC', lat: 6.8567, lng: 79.8650 },
  { name: 'Kaduwela Mobile Fix - Nimal',        type: 'MOBILE_MECHANIC', lat: 6.9309, lng: 79.9844 },
  { name: 'Moratuwa Auto Services - Chaminda',  type: 'MOBILE_MECHANIC', lat: 6.7737, lng: 79.8814 },
  { name: 'Battaramulla Mechanic - Pradeep',    type: 'MOBILE_MECHANIC', lat: 6.9000, lng: 79.9180 },

  // Light Tow Trucks (4)
  { name: 'Colombo Towing - Asanka',         type: 'TOW_LIGHT', lat: 6.9344, lng: 79.8428 },
  { name: 'Rajagiriya Tow Service - Lakmal', type: 'TOW_LIGHT', lat: 6.9127, lng: 79.8969 },
  { name: 'Maharagama Towing - Dinesh',      type: 'TOW_LIGHT', lat: 6.8469, lng: 79.9268 },
  { name: 'Kottawa Recovery - Saman',        type: 'TOW_LIGHT', lat: 6.8420, lng: 80.0000 },

  // Heavy Tow Trucks (2)
  { name: 'Heavy Recovery Lanka - Mahinda',  type: 'TOW_HEAVY', lat: 6.9497, lng: 79.8625 },
  { name: 'Southern Expressway Recovery',    type: 'TOW_HEAVY', lat: 6.7500, lng: 80.0300 },

  // Fuel Delivery (2)
  { name: 'Quick Fuel Colombo - Ruwan',      type: 'FUEL_DELIVERY', lat: 6.9167, lng: 79.8476 },
  { name: 'Southern Fuel Express',           type: 'FUEL_DELIVERY', lat: 6.8200, lng: 79.9600 },

  // Locksmith (1)
  { name: 'Key Master Lanka - Anura',        type: 'LOCKSMITH', lat: 6.9100, lng: 79.8700 },
];

async function main() {
  console.log('Seeding dispatch database...');

  // Clear existing data (in dependency order)
  await prisma.resolutionFeedback.deleteMany();
  await prisma.dispatchDecision.deleteMany();
  await prisma.triageResponse.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.bayesianPrior.deleteMany();
  await prisma.provider.deleteMany();

  // Seed providers — capabilities auto-derived from the new capability matrix
  for (const p of PROVIDERS) {
    const capabilities = getProviderCapabilities(p.type) as ServiceType[];
    await prisma.provider.create({
      data: {
        name:         p.name,
        type:         p.type,
        latitude:     p.lat,
        longitude:    p.lng,
        capabilities,
        trustScore:   0.65 + Math.random() * 0.3,
        status:       'AVAILABLE',
        phone:        p.phone,
      },
    });
  }

  console.log(`[OK] Seeded ${PROVIDERS.length} providers`);

  const counts = await prisma.provider.groupBy({
    by: ['type'],
    _count: true,
  });
  console.log('\nProvider distribution:');
  counts.forEach((c: { type: string; _count: number }) => {
    console.log(`  ${c.type}: ${c._count}`);
  });

  console.log('\nCapabilities by provider type:');
  for (const type of ['MOBILE_MECHANIC', 'FUEL_DELIVERY', 'LOCKSMITH', 'TOW_LIGHT', 'TOW_HEAVY'] as const) {
    const caps = getProviderCapabilities(type);
    console.log(`  ${type.padEnd(16)} (${caps.length}): ${caps.join(', ')}`);
  }

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
