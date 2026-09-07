/**
 * One-time migration helper (PRD §12).
 *
 * Soft-read already maps empty/nannu_milk → TENANT_001 and test_tenant → TENANT_002.
 * This script WRITES canonical tenantId onto docs that are missing it (or legacy).
 *
 * Usage (from orderapp folder, Node running with Firebase creds):
 *   node scripts/migrateTenantIds.js --dry-run
 *   node scripts/migrateTenantIds.js --apply
 *
 * Collections: outlets, products, orders, users, returns, payments,
 * payment_requests, storeKeepers, utensils, utensilReturnRequests,
 * outlet_storekeepers, notifications, customInvoices, outlet_payments
 */

import dotenv from 'dotenv';
dotenv.config();

import { initializeFirestore, getFirestoreDB } from '../util/firebase.js';
import { docTenantId, DEFAULT_TENANT_ID } from '../util/tenant.js';

const COLLECTIONS = [
  'outlets',
  'products',
  'orders',
  'users',
  'returns',
  'payments',
  'payment_requests',
  'storeKeepers',
  'utensils',
  'utensilReturnRequests',
  'outlet_storekeepers',
  'notifications',
  'customInvoices',
  'outlet_payments',
];

const apply = process.argv.includes('--apply');
const dryRun = !apply;

async function migrateCollection(db, name) {
  const snap = await db.collection(name).get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const raw = data.tenantId;
    const canonical = docTenantId(raw);
    const rawStr = raw == null ? '' : String(raw).trim();

    if (rawStr === canonical) {
      skipped += 1;
      continue;
    }

    updated += 1;
    if (dryRun) {
      console.log(`[dry-run] ${name}/${doc.id}: "${rawStr || '(empty)'}" → ${canonical}`);
    } else {
      await doc.ref.update({ tenantId: canonical });
    }
  }

  console.log(
    `[${name}] total=${snap.size} wouldUpdate/updated=${updated} alreadyOk=${skipped}`,
  );
}

async function main() {
  console.log(
    apply
      ? 'APPLY mode — writing tenantId to Firestore'
      : 'DRY-RUN mode — no writes (pass --apply to write)',
  );
  console.log(`Default tenant: ${DEFAULT_TENANT_ID}`);

  await initializeFirestore();
  const db = getFirestoreDB();

  // Ensure tenant registry docs exist
  const tenants = [
    { id: 'TENANT_001', tenantName: 'Nannu Milk' },
    { id: 'TENANT_002', tenantName: 'Test Tenant' },
  ];
  for (const t of tenants) {
    const ref = db.collection('tenants').doc(t.id);
    const snap = await ref.get();
    if (!snap.exists) {
      const payload = {
        tenantId: t.id,
        tenantName: t.tenantName,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (dryRun) {
        console.log(`[dry-run] would create tenants/${t.id}`);
      } else {
        await ref.set(payload);
        console.log(`created tenants/${t.id}`);
      }
    }
  }

  for (const name of COLLECTIONS) {
    try {
      await migrateCollection(db, name);
    } catch (err) {
      console.error(`Failed ${name}:`, err.message);
    }
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
