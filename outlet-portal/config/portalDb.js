import mongoose from 'mongoose';
import { resolveDataEnv } from '../../config/db.js';

let portalConn = null;

const resolvePortalMongo = (env) => {
  const testUri = (process.env.OUTLET_PORTAL_MONGODB_TEST_URI || '').trim();
  const prodUri = (process.env.OUTLET_PORTAL_MONGODB_URI || '').trim();
  const testDb = (process.env.OUTLET_PORTAL_TEST_DB_NAME || '').trim();
  const prodDb = (process.env.OUTLET_PORTAL_DB_NAME || '').trim() || 'outlet_portal';

  if (env === 'test') {
    if (testUri) {
      return { uri: testUri, dbName: testDb || 'outlet_portal_test' };
    }
    const milkTestUri = (process.env.MONGODB_TEST_URI || '').trim();
    if (milkTestUri) {
      return { uri: milkTestUri, dbName: testDb || 'outlet_portal_test' };
    }
    return { uri: '', dbName: testDb || 'outlet_portal_test' };
  }
  return { uri: prodUri, dbName: prodDb };
};

export const connectOutletPortalMongo = async () => {
  const env = resolveDataEnv();
  const { uri, dbName } = resolvePortalMongo(env);
  if (!uri) {
    console.warn(
      `⚠️ Outlet portal MongoDB URI not set (FIREBASE_ENV=${env}) – outlet portal module disabled.`
    );
    return false;
  }
  try {
    portalConn = await mongoose.createConnection(uri, { dbName }).asPromise();
    console.log(`✅ Outlet portal MongoDB connected (FIREBASE_ENV=${env}): ${dbName}`);
    return true;
  } catch (err) {
    console.warn('⚠️ Outlet portal MongoDB not connected:', err.message);
    portalConn = null;
    return false;
  }
};

export const isOutletPortalMongoConnected = () => portalConn?.readyState === 1;

export const getPortalConnection = () => {
  if (!portalConn || portalConn.readyState !== 1) {
    throw new Error('Outlet portal MongoDB is not connected');
  }
  return portalConn;
};
