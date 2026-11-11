import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import mongoose from 'mongoose';
import { describeMilkMongo, isMongoConnected, resolveDataEnv } from '../config/db.js';
import { describePortalMongo, getPortalConnection, isOutletPortalMongoConnected } from '../outlet-portal/config/portalDb.js';
import { canonicalizeTenantId, isAllowedOrderTenantId } from '../util/tenantMiddleware.js';
import { HttpError, sendData } from './http.js';

const DOCUMENT_LIMIT = 10;
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);
const SECRET_KEYS = new Set([
  'password',
  'passwordhash',
  'passwd',
  'secret',
  'salt',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'fcmtoken',
  'apikey',
  'privatekey',
  'authorization',
  'serviceaccount',
  'otp',
  'pin',
]);

function secretKey(key) {
  const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SECRET_KEYS.has(normalized);
}

function plainValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value === 'bigint') return value.toString();
  if (depth > 6) return '[nested]';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[binary]';

  if (typeof value === 'object') {
    const bsonType = value._bsontype;
    if (bsonType === 'ObjectId') return String(value);
    if (bsonType === 'Long' || bsonType === 'Decimal128' || bsonType === 'Double' || bsonType === 'Timestamp') {
      return typeof value.toString === 'function' ? value.toString() : String(value);
    }
    if (bsonType === 'Binary') return '[binary]';
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch {
        // Keep walking the object when this is not a timestamp.
      }
    }
    if (value.constructor?.name === 'GeoPoint') {
      return { latitude: value.latitude, longitude: value.longitude };
    }
    if (typeof value.path === 'string' && value.firestore) return value.path;
    if (Array.isArray(value)) {
      const items = value.slice(0, 40).map((item) => plainValue(item, depth + 1));
      if (value.length > 40) items.push(`[${value.length - 40} more]`);
      return items;
    }

    const output = {};
    const keys = Object.keys(value).slice(0, 80);
    for (const key of keys) {
      output[key] = secretKey(key) ? '[hidden]' : plainValue(value[key], depth + 1);
    }
    if (Object.keys(value).length > 80) output['…'] = `${Object.keys(value).length - 80} more fields`;
    return output;
  }

  return String(value);
}

function requestedTenantId(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'all') return '';
  const tenantId = canonicalizeTenantId(raw);
  if (!tenantId || !isAllowedOrderTenantId(tenantId)) {
    throw new HttpError(400, 'Choose a valid tenant.');
  }
  return tenantId;
}

function assertCollectionName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 200 || /[/\0$]/.test(value) || value.startsWith('system.')) {
    throw new HttpError(400, 'Invalid collection name.');
  }
  return value;
}

function firebaseProjectId() {
  const options = admin.app().options || {};
  return options.projectId || options.credential?.projectId || 'Firestore';
}

async function firestoreDatabaseNames() {
  const projectId = firebaseProjectId();
  if (!projectId || projectId === 'Firestore') return ['(default)'];
  try {
    const tokenResult = await admin.app().options.credential.getAccessToken();
    const token = tokenResult?.access_token;
    if (!token) return ['(default)'];
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return ['(default)'];
    const payload = await response.json();
    const names = (payload.databases || [])
      .map((item) => {
        const match = String(item.name || '').match(/\/databases\/(.+)$/);
        return match ? decodeURIComponent(match[1]) : '';
      })
      .filter(Boolean);
    return names.length ? names : ['(default)'];
  } catch (err) {
    console.warn('Could not list Firestore databases:', err.message);
    return ['(default)'];
  }
}

function firestoreHandle(name) {
  if (!name || name === '(default)') return getFirestore();
  return getFirestore(admin.app(), name);
}

async function mongoDatabaseNames(conn) {
  try {
    const client = typeof conn.getClient === 'function' ? conn.getClient() : null;
    if (!client) return [conn.name].filter(Boolean);
    const result = await client.db(conn.name || 'admin').admin().listDatabases({ nameOnly: true });
    const names = (result.databases || [])
      .map((item) => item.name)
      .filter((name) => name && !SYSTEM_DATABASES.has(name));
    return names.length ? names : [conn.name].filter(Boolean);
  } catch (err) {
    console.warn('MongoDB listDatabases failed:', err.message);
    return [conn.name].filter(Boolean);
  }
}

async function catalog() {
  const env = resolveDataEnv();
  const projectId = firebaseProjectId();
  const firestoreNames = await firestoreDatabaseNames();
  const databases = firestoreNames.map((name) => ({
    id: `fs:${name}`,
    engine: 'Firestore',
    name,
    detail: `${projectId} · ${env}`,
    status: 'connected',
  }));

  const milk = describeMilkMongo();
  const portal = describePortalMongo();
  const sources = [
    {
      key: 'milk',
      role: 'Milk',
      env: milk.env,
      description: milk,
      conn: isMongoConnected() ? mongoose.connection : null,
    },
    {
      key: 'portal',
      role: 'Outlet portal',
      env: portal.env,
      description: portal,
      conn: isOutletPortalMongoConnected() ? getPortalConnection() : null,
    },
  ];

  const seenHosts = new Map();
  for (const source of sources) {
    const detailFor = (roles) => `${roles.join(', ')} · ${source.env}`;
    if (source.key === 'portal' && !source.description.configured && !source.conn) continue;

    if (!source.conn) {
      databases.push({
        id: `mg:${source.key}:${source.description.name}`,
        engine: 'MongoDB',
        name: source.description.name,
        detail: detailFor([source.role]),
        status: 'unavailable',
      });
      continue;
    }

    const hostKey = `${source.conn.host || source.key}:${source.conn.port || ''}`;
    const names = await mongoDatabaseNames(source.conn);
    for (const name of names) {
      const dedupe = `${hostKey}:${name}`;
      const existing = seenHosts.get(dedupe);
      if (existing) {
        if (!existing.roles.includes(source.role)) {
          existing.roles.push(source.role);
          existing.detail = detailFor(existing.roles);
        }
        continue;
      }
      const row = {
        id: `mg:${source.key}:${name}`,
        engine: 'MongoDB',
        name,
        detail: detailFor([source.role]),
        status: 'connected',
        roles: [source.role],
      };
      seenHosts.set(dedupe, row);
      databases.push(row);
    }
  }

  for (const database of databases) delete database.roles;

  return databases;
}

async function requireDatabase(databaseId) {
  const id = String(databaseId || '').trim();
  const match = (await catalog()).find((item) => item.id === id);
  if (!match) throw new HttpError(404, 'Database not found.');
  if (match.status !== 'connected') throw new HttpError(503, 'Database is not connected.');
  return match;
}

async function openDatabase(database) {
  if (database.engine === 'Firestore') {
    const name = database.id.slice(3);
    return { engine: 'Firestore', db: firestoreHandle(name) };
  }

  const source = database.id.split(':')[1];
  const name = database.id.split(':').slice(2).join(':');
  const conn = source === 'portal' ? getPortalConnection() : mongoose.connection;
  if (!conn || conn.readyState !== 1) throw new HttpError(503, 'Database is not connected.');
  const known = await mongoDatabaseNames(conn);
  if (!known.includes(name)) throw new HttpError(404, 'Database not found.');
  const client = conn.getClient();
  return { engine: 'MongoDB', db: client.db(name) };
}

export async function getDatabases(_req, res) {
  sendData(res, { databases: await catalog() });
}

export async function getCollections(req, res) {
  const database = await requireDatabase(req.query.databaseId);
  const opened = await openDatabase(database);
  try {
    if (opened.engine === 'Firestore') {
      const collections = await opened.db.listCollections();
      const names = collections.map((collection) => collection.id).sort((a, b) => a.localeCompare(b));
      sendData(res, { collections: names });
      return;
    }
    const listed = await opened.db.listCollections({}, { nameOnly: true }).toArray();
    const names = listed
      .map((collection) => collection.name)
      .filter((name) => name && !name.startsWith('system.'))
      .sort((a, b) => a.localeCompare(b));
    sendData(res, { collections: names });
  } catch (err) {
    if (err.status) throw err;
    console.error('Could not list collections:', err.message);
    throw new HttpError(502, 'Could not list collections.');
  }
}

export async function getDocuments(req, res) {
  const database = await requireDatabase(req.query.databaseId);
  const collectionName = assertCollectionName(req.query.collection);
  const tenantId = requestedTenantId(req.query.tenantId);
  const opened = await openDatabase(database);

  try {
    if (opened.engine === 'Firestore') {
      const collection = opened.db.collection(collectionName);
      let snapshot;
      if (!tenantId) {
        snapshot = await collection.limit(DOCUMENT_LIMIT).get();
      } else {
        const [byTenantId, byCode] = await Promise.all([
          collection.where('tenantId', '==', tenantId).limit(DOCUMENT_LIMIT).get(),
          collection.where('code', '==', tenantId).limit(DOCUMENT_LIMIT).get(),
        ]);
        const seen = new Set();
        snapshot = {
          docs: [...byTenantId.docs, ...byCode.docs].filter((doc) => {
            if (seen.has(doc.id)) return false;
            seen.add(doc.id);
            return true;
          }).slice(0, DOCUMENT_LIMIT),
        };
      }
      sendData(res, {
        limit: DOCUMENT_LIMIT,
        order: 'stored',
        tenantId,
        documents: snapshot.docs.map((doc) => ({
          id: doc.id,
          data: plainValue(doc.data()),
        })),
      });
      return;
    }

    const filter = tenantId ? { $or: [{ tenantId }, { code: tenantId }] } : {};
    let rows;
    let order = 'newest';
    try {
      rows = await opened.db.collection(collectionName).find(filter).sort({ _id: -1 }).limit(DOCUMENT_LIMIT).toArray();
    } catch {
      order = 'stored';
      rows = await opened.db.collection(collectionName).find(filter).limit(DOCUMENT_LIMIT).toArray();
    }
    sendData(res, {
      limit: DOCUMENT_LIMIT,
      order,
      tenantId,
      documents: rows.map((row) => ({
        id: row._id == null ? '' : String(row._id),
        data: plainValue(row),
      })),
    });
  } catch (err) {
    if (err.status) throw err;
    console.error('Could not read documents:', err.message);
    throw new HttpError(502, 'Could not read documents.');
  }
}
