import mongoose from 'mongoose';
import { resolveDataEnv } from '../../config/db.js';

let eventConn = null;

const sharedClusterUri = (env) => {
  if (env === 'test') {
    return (
      (process.env.MONGODB_TEST_URI || '').trim() ||
      (process.env.MONGODB_URI || '').trim() ||
      'mongodb://localhost:27017/orderapp'
    );
  }
  return (process.env.MONGODB_URI || '').trim();
};

/** Event orders use their own database name, even when they share a cluster URI. */
export const resolveEventOrderMongo = (env = resolveDataEnv()) => {
  const testUri = (process.env.EVENT_ORDER_MONGODB_TEST_URI || '').trim();
  const prodUri = (process.env.EVENT_ORDER_MONGODB_URI || '').trim();
  const testDb = (process.env.EVENT_ORDER_TEST_DB_NAME || '').trim() || 'event_orders_test';
  const prodDb = (process.env.EVENT_ORDER_DB_NAME || '').trim() || 'event_orders';

  if (env === 'test') {
    return { uri: testUri || sharedClusterUri('test'), dbName: testDb };
  }
  return { uri: prodUri || sharedClusterUri('production'), dbName: prodDb };
};

export const connectEventOrderMongo = async () => {
  const env = resolveDataEnv();
  const { uri, dbName } = resolveEventOrderMongo(env);
  if (!uri) {
    console.warn(
      `⚠️ Event order MongoDB URI not set (FIREBASE_ENV=${env}) – event orders disabled.`,
    );
    return false;
  }
  try {
    eventConn = await mongoose.createConnection(uri, { dbName }).asPromise();
    console.log(`✅ Event order MongoDB connected (FIREBASE_ENV=${env}): ${dbName}`);
    return true;
  } catch (err) {
    console.warn('⚠️ Event order MongoDB not connected:', err.message);
    eventConn = null;
    return false;
  }
};

export const isEventOrderMongoConnected = () => eventConn?.readyState === 1;

export const getEventOrderConnection = () => {
  if (!eventConn || eventConn.readyState !== 1) {
    throw new Error('Event order MongoDB is not connected');
  }
  return eventConn;
};

export const describeEventOrderMongo = () => {
  const env = resolveDataEnv();
  const { uri, dbName } = resolveEventOrderMongo(env);
  return {
    env,
    name: dbName,
    configured: Boolean(uri),
    connected: isEventOrderMongoConnected(),
  };
};
