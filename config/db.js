import mongoose from 'mongoose';

/** Same switch as Firebase: `npm run dev` → test, `npm start` → production. */
export const resolveDataEnv = () => {
  const explicit = (process.env.FIREBASE_ENV || '').trim().toLowerCase();
  if (explicit === 'test' || explicit === 'production') {
    return explicit;
  }
  const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'development' || nodeEnv === 'testing' || nodeEnv === 'test') {
    return 'test';
  }
  return 'production';
};

export const isMongoConnected = () => mongoose.connection.readyState === 1;

const databaseNameFromUri = (uri, fallback) => {
  if (!uri) return fallback;
  const normalized = uri.replace(/^mongodb(?:\+srv)?:\/\//, 'http://');
  try {
    const name = decodeURIComponent(new URL(normalized).pathname.replace(/^\//, '').split('/')[0] || '');
    return name || fallback;
  } catch {
    return fallback;
  }
};

/** Connected database name only. The URI stays on the server. */
export const describeMilkMongo = () => {
  const env = resolveDataEnv();
  const uri = resolveMilkMongoUri(env);
  return {
    env,
    name: databaseNameFromUri(uri, 'orderapp'),
    connected: isMongoConnected(),
  };
};

const resolveMilkMongoUri = (env) => {
  if (env === 'test') {
    return (
      (process.env.MONGODB_TEST_URI || '').trim() ||
      'mongodb://localhost:27017/orderapp'
    );
  }
  return (
    (process.env.MONGODB_URI || '').trim() ||
    'mongodb://localhost:27017/orderapp'
  );
};

export const connectMongoDB = async () => {
  const env = resolveDataEnv();
  const uri = resolveMilkMongoUri(env);
  try {
    await mongoose.connect(uri);
    const dbName = mongoose.connection.name || '(default)';
    console.log(`✅ MongoDB connected (FIREBASE_ENV=${env}): ${dbName}`);
    return true;
  } catch (err) {
    console.warn(
      `⚠️ MongoDB not connected (FIREBASE_ENV=${env}) – skipping. Order app will work; Milk module will be unavailable.`,
      err.message
    );
    return false;
  }
};
