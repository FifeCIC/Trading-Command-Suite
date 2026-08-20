#!/usr/bin/env node
/**
 * seed-capabilities.cjs — seed the capability table from the KNOWN_FEATURES
 * literal (src/data/known-features.js). One-time migration + safe to rerun:
 * upserts by name, never deletes.
 *
 * The DB is the live source of truth; this file exists only to move the
 * legacy literal into the table. Handoff batches should POST new entries to
 * /api/capabilities instead of editing the literal.
 *
 * Run: node nest/scripts/seed-capabilities.cjs
 */
'use strict';

const path = require('path');
const { PrismaClient } = require('@prisma/client');

const NEST_ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.resolve(NEST_ROOT, '..', 'src', 'data', 'known-features.js');

const FIELD_DEFAULTS = {
  category: 'General',
  area: 'Backend',
  type: 'Service',
  status: 'ALPHA',
  dataPersistence: 'ephemeral',
  uiSurfaces: 0,
  pipelineIntegration: 'none',
  devCompletion: 'partial',
};

async function loadFeatures() {
  const mod = await import(`file://${DATA_FILE.replace(/\\/g, '/')}`);
  return mod.KNOWN_FEATURES || {};
}

(async () => {
  const features = await loadFeatures();
  const names = Object.keys(features);
  if (!names.length) {
    console.log('No KNOWN_FEATURES entries found — nothing to seed.');
    process.exit(0);
  }

  const prisma = new PrismaClient();
  await prisma.$connect();
  let created = 0;
  let updated = 0;

  for (const name of names) {
    const entry = features[name] || {};
    const data = {
      name,
      category: entry.category ?? entry.area ? entry.area : FIELD_DEFAULTS.category,
      area: entry.area ?? FIELD_DEFAULTS.area,
      type: entry.type ?? FIELD_DEFAULTS.type,
      status: entry.status ?? FIELD_DEFAULTS.status,
      notes: entry.notes ?? (entry.description || null),
      dataPersistence: entry.dataPersistence ?? FIELD_DEFAULTS.dataPersistence,
      uiSurfaces: Number(entry.uiSurfaces ?? FIELD_DEFAULTS.uiSurfaces) || 0,
      pipelineIntegration: entry.pipelineIntegration ?? FIELD_DEFAULTS.pipelineIntegration,
      devCompletion: entry.devCompletion ?? FIELD_DEFAULTS.devCompletion,
    };
    const existing = await prisma.capability.findFirst({ where: { name }, select: { id: true } });
    if (existing) {
      await prisma.capability.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.capability.create({ data });
      created++;
    }
  }

  await prisma.$disconnect();
  console.log(`Capability seed complete: ${created} created, ${updated} updated (${names.length} total).`);
})().catch((err) => {
  console.error(`Capability seed failed: ${err.message}`);
  process.exit(1);
});
