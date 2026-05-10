/**
 * ============================================================================
 * Database Seed — Sample Providers for Colombo Area
 * ============================================================================
 * 
 * Seeds the database with 15 sample service providers distributed across
 * the Colombo metropolitan area. Locations are based on real Sri Lankan
 * coordinates to support realistic simulation.
 * 
 * Run with: npm run prisma:seed
 * 
 * @author Janukshan Sivakumar - IT22635266
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding dispatch database...');

  // Clear existing data
  await prisma.resolutionFeedback.deleteMany();
  await prisma.dispatchDecision.deleteMany();
  await prisma.triageResponse.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.bayesianPrior.deleteMany();
  await prisma.provider.deleteMany();

  // ── Seed Providers ──
  const providers = [
    // Mobile Mechanics (6)
    { name: 'Colombo Mobile Mechanic - Rajitha', type: 'MOBILE_MECHANIC' as const, lat: 6.9271, lng: 79.8612, capabilities: ['BATTERY_JUMP', 'BATTERY_REPLACE', 'FLAT_TIRE', 'MECHANIC_FIX'] },
    { name: 'Nugegoda Auto Repair - Kamal', type: 'MOBILE_MECHANIC' as const, lat: 6.8723, lng: 79.8897, capabilities: ['BATTERY_JUMP', 'BATTERY_REPLACE', 'FLAT_TIRE', 'MECHANIC_FIX'] },
    { name: 'Dehiwala Mechanic Service - Suresh', type: 'MOBILE_MECHANIC' as const, lat: 6.8567, lng: 79.8650, capabilities: ['BATTERY_JUMP', 'BATTERY_REPLACE', 'FLAT_TIRE', 'MECHANIC_FIX'] },
    { name: 'Kaduwela Mobile Fix - Nimal', type: 'MOBILE_MECHANIC' as const, lat: 6.9309, lng: 79.9844, capabilities: ['BATTERY_JUMP', 'BATTERY_REPLACE', 'FLAT_TIRE', 'MECHANIC_FIX'] },
    { name: 'Moratuwa Auto Services - Chaminda', type: 'MOBILE_MECHANIC' as const, lat: 6.7737, lng: 79.8814, capabilities: ['BATTERY_JUMP', 'BATTERY_REPLACE', 'FLAT_TIRE', 'MECHANIC_FIX'] },
    { name: 'Battaramulla Mechanic - Pradeep', type: 'MOBILE_MECHANIC' as const, lat: 6.9000, lng: 79.9180, capabilities: ['BATTERY_JUMP', 'BATTERY_REPLACE', 'FLAT_TIRE', 'MECHANIC_FIX'] },

    // Light Tow Trucks (4)
    { name: 'Colombo Towing - Asanka', type: 'TOW_LIGHT' as const, lat: 6.9344, lng: 79.8428, capabilities: ['BATTERY_JUMP', 'FLAT_TIRE', 'TOW_LIGHT'] },
    { name: 'Rajagiriya Tow Service - Lakmal', type: 'TOW_LIGHT' as const, lat: 6.9127, lng: 79.8969, capabilities: ['BATTERY_JUMP', 'FLAT_TIRE', 'TOW_LIGHT'] },
    { name: 'Maharagama Towing - Dinesh', type: 'TOW_LIGHT' as const, lat: 6.8469, lng: 79.9268, capabilities: ['BATTERY_JUMP', 'FLAT_TIRE', 'TOW_LIGHT'] },
    { name: 'Kottawa Recovery - Saman', type: 'TOW_LIGHT' as const, lat: 6.8420, lng: 80.0000, capabilities: ['BATTERY_JUMP', 'FLAT_TIRE', 'TOW_LIGHT'] },

    // Heavy Tow Trucks (2)
    { name: 'Heavy Recovery Lanka - Mahinda', type: 'TOW_HEAVY' as const, lat: 6.9497, lng: 79.8625, capabilities: ['BATTERY_JUMP', 'FLAT_TIRE', 'TOW_LIGHT', 'TOW_HEAVY'] },
    { name: 'Southern Expressway Recovery', type: 'TOW_HEAVY' as const, lat: 6.7500, lng: 80.0300, capabilities: ['BATTERY_JUMP', 'FLAT_TIRE', 'TOW_LIGHT', 'TOW_HEAVY'] },

    // Fuel Delivery (2)
    { name: 'Quick Fuel Colombo - Ruwan', type: 'FUEL_DELIVERY' as const, lat: 6.9167, lng: 79.8476, capabilities: ['FUEL_DELIVERY'] },
    { name: 'Southern Fuel Express', type: 'FUEL_DELIVERY' as const, lat: 6.8200, lng: 79.9600, capabilities: ['FUEL_DELIVERY'] },

    // Locksmith (1)
    { name: 'Key Master Lanka - Anura', type: 'LOCKSMITH' as const, lat: 6.9100, lng: 79.8700, capabilities: ['LOCKOUT'] },
  ];

  for (const p of providers) {
    await prisma.provider.create({
      data: {
        name: p.name,
        type: p.type,
        latitude: p.lat,
        longitude: p.lng,
        capabilities: p.capabilities as any[],
        trustScore: 0.65 + Math.random() * 0.3, // Random 0.65-0.95
        status: 'AVAILABLE',
      },
    });
  }

  console.log(`✅ Seeded ${providers.length} providers`);

  // Print summary
  const counts = await prisma.provider.groupBy({
    by: ['type'],
    _count: true,
  });
  console.log('\nProvider distribution:');

counts.forEach((c: { type: string; _count: number }) => {
  console.log(`  ${c.type}: ${c._count}`);
});

  console.log('\n🎉 Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
