import mongoose from 'mongoose';
import { isMongoConnected } from '../config/db.js';

const DATABASE = 'order_telemetry';
const COLLECTION = 'request_events';
const RETENTION_SECONDS = 2 * 24 * 60 * 60;
const USER_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const PAGE = /^[\w ./:-]{1,120}$/;
const NAMED_CHANNELS = new Set(['web', 'pos']);

const buffer = [];
let indexesReady = null;
let flushing = false;

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function readGetTelemetry(req, resource) {
  const userId = header(req, 'x-user-id');
  const channel = header(req, 'x-client').toLowerCase();
  const page = header(req, 'x-page').split('?')[0].trim().slice(0, 120);
  const routePath = (req.route?.path
    ? `${req.baseUrl || ''}${req.route.path === '/' ? '' : req.route.path}`
    : String(req.originalUrl || req.url || '').split('?')[0]) || '/';

  return {
    timestamp: new Date(),
    tenantId: String(req.tenantId || '').slice(0, 64),
    userId: USER_ID.test(userId) && !/^\d{10,}$/.test(userId) ? userId : '',
    page: PAGE.test(page) ? page : '',
    channel: NAMED_CHANNELS.has(channel) ? channel : 'app',
    resource,
    path: String(routePath || '').slice(0, 200),
  };
}

export function recordGetRequests(resource) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.on('finish', () => {
      try {
        buffer.push(readGetTelemetry(req, resource));
        if (buffer.length > 500) buffer.splice(0, buffer.length - 500);
      } catch (err) {
        console.warn('Telemetry skipped:', err.message);
      }
    });
    next();
  };
}

function collection() {
  return mongoose.connection.getClient().db(DATABASE).collection(COLLECTION);
}

async function ensureIndexes() {
  if (!isMongoConnected()) return;
  if (!indexesReady) {
    indexesReady = (async () => {
      const events = collection();
      await events.createIndex({ tenantId: 1, timestamp: -1 });
      const existing = await events.indexes();
      const ttl = existing.find((index) => index.key?.timestamp === 1 && Object.keys(index.key).length === 1);
      if (!ttl) {
        await events.createIndex({ timestamp: 1 }, { expireAfterSeconds: RETENTION_SECONDS });
        return;
      }
      if (ttl.expireAfterSeconds !== RETENTION_SECONDS) {
        await mongoose.connection.getClient().db(DATABASE).command({
          collMod: COLLECTION,
          index: { name: ttl.name, expireAfterSeconds: RETENTION_SECONDS },
        });
      }
    })().catch((err) => {
      indexesReady = null;
      throw err;
    });
  }
  await indexesReady;
}

async function flush() {
  if (flushing || buffer.length === 0 || !isMongoConnected()) return;
  flushing = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    await ensureIndexes();
    await collection().insertMany(batch, { ordered: false });
  } catch (err) {
    console.warn('Telemetry flush failed:', err.message);
  } finally {
    flushing = false;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listRequestEvents({
  tenantId = '',
  channel = '',
  resource = '',
  search = '',
  from = null,
  to = null,
  page = 1,
  pageSize = 8,
} = {}) {
  if (!isMongoConnected()) {
    const err = new Error('Telemetry store is not connected.');
    err.status = 503;
    throw err;
  }

  const filter = {};
  if (tenantId) filter.tenantId = tenantId;
  if (channel) filter.channel = channel;
  if (resource) filter.resource = resource;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = from;
    if (to) filter.timestamp.$lte = to;
  }
  const term = String(search || '').trim();
  if (term) {
    const pattern = escapeRegex(term);
    filter.$or = [
      { userId: { $regex: pattern, $options: 'i' } },
      { page: { $regex: pattern, $options: 'i' } },
      { path: { $regex: pattern, $options: 'i' } },
    ];
  }

  const size = Math.min(100, Math.max(1, Number(pageSize) || 8));
  const safePage = Math.max(1, Number(page) || 1);
  const events = collection();
  const [total, rows, pathRows] = await Promise.all([
    events.countDocuments(filter),
    events.find(filter).sort({ timestamp: -1 }).skip((safePage - 1) * size).limit(size).toArray(),
    events.aggregate([
      { $match: filter },
      { $group: { _id: { path: '$path', resource: '$resource' }, count: { $sum: 1 } } },
      { $sort: { count: -1, '_id.path': 1 } },
      { $limit: 20 },
    ]).toArray(),
  ]);

  return {
    items: rows.map((row) => ({
      id: row._id == null ? '' : String(row._id),
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp || '',
      tenantId: row.tenantId || '',
      userId: row.userId || '',
      page: row.page || '',
      channel: row.channel || '',
      resource: row.resource || '',
      path: row.path || '',
    })),
    total,
    page: safePage,
    pageSize: size,
    paths: pathRows.map((row) => ({
      path: row._id?.path || '',
      resource: row._id?.resource || '',
      count: row.count,
    })),
  };
}

export function startRequestTelemetry() {
  ensureIndexes().catch((err) => console.warn('Telemetry index setup failed:', err.message));
  const timer = setInterval(() => {
    flush().catch((err) => console.warn('Telemetry flush failed:', err.message));
  }, 2000);
  if (typeof timer.unref === 'function') timer.unref();
}
