import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  canonicalizeTenantId,
  isAllowedOrderTenantId,
  TENANTS,
} from '../util/tenantMiddleware.js';

const TEST_PROJECT_ID = 'orderapp-test-be3c6';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, '..', 'serviceAccountKey.test.json');

const COUNTERS = [
  { doc: 'orders', collection: 'orders', idField: 'parent orderId' },
  { doc: 'outlets', collection: 'outlets', idField: 'id' },
  { doc: 'products', collection: 'products', idField: 'productId' },
  { doc: 'customInvoiceCounter', collection: 'customInvoices', idField: 'id' },
  { doc: 'userCounter', collection: 'users', idField: 'userId' },
  { doc: 'paymentCounter', collection: 'payments', idField: 'paymentId' },
];

const parseSeq = (value) => {
  if (value == null) return 0;
  const match = String(value).match(/(\d+)\s*$/);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : 0;
};

const tenantOf = (data) => {
  const id = canonicalizeTenantId(data?.tenantId);
  if (id && isAllowedOrderTenantId(id)) return id;
  if (!id) return TENANTS.NAANU_MILK;
  return '';
};

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (serviceAccount.project_id !== TEST_PROJECT_ID) {
  throw new Error(
    `Refusing to run: expected ${TEST_PROJECT_ID}, got ${serviceAccount.project_id}`,
  );
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
console.log(`Using Firestore ${serviceAccount.project_id} (test only)`);

const snapAll = async (name) => {
  const snap = await db.collection(name).get();
  return snap.docs;
};

for (const item of COUNTERS) {
  const docs = await snapAll(item.collection);
  const byTenant = {};
  let unknown = 0;
  let maxSeq = 0;

  for (const doc of docs) {
    const data = doc.data() || {};
    const tenant = tenantOf(data);
    if (!tenant) {
      unknown += 1;
      continue;
    }
    byTenant[tenant] = (byTenant[tenant] || 0) + 1;
    maxSeq = Math.max(maxSeq, parseSeq(data[item.idField] || doc.id));
  }

  const counterRef = db.collection('counters').doc(item.doc);
  const beforeSnap = await counterRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() || {} : {};
  const tenantSum = Object.values(byTenant).reduce((sum, n) => sum + n, 0);
  const nextCount = Math.max(Number(before.count) || 0, maxSeq, tenantSum);

  const payload = { count: nextCount, ...byTenant };
  await counterRef.set(payload);

  console.log(`\n${item.doc}`);
  console.log('  before', before);
  console.log('  docs', docs.length, 'unknownTenant', unknown, 'maxSeq', maxSeq);
  console.log('  after', payload);
}

console.log('\nDone. Voucher/chat counters left unchanged.');
process.exit(0);
