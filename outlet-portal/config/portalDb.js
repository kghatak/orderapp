import mongoose from 'mongoose';

let portalConn = null;

export const connectOutletPortalMongo = async () => {
  const uri = process.env.OUTLET_PORTAL_MONGODB_URI;
  if (!uri) {
    console.warn('⚠️ OUTLET_PORTAL_MONGODB_URI not set – outlet portal module disabled.');
    return false;
  }
  const dbName = process.env.OUTLET_PORTAL_DB_NAME || 'outlet_portal';
  try {
    portalConn = await mongoose.createConnection(uri, { dbName }).asPromise();
    console.log('✅ Outlet portal MongoDB connected:', dbName);
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
