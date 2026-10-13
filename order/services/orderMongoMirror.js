import { isOutletPortalMongoConnected } from '../../outlet-portal/config/portalDb.js';
import { getFirestoreOrderModel } from '../models/firestoreOrder.js';

const nowTimestamp = () => {
  const ms = Date.now();
  return {
    _seconds: Math.floor(ms / 1000),
    _nanoseconds: (ms % 1000) * 1e6,
  };
};

const isFirestoreTimestamp = (value) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.toDate === 'function' &&
      (typeof value.seconds === 'number' || typeof value._seconds === 'number')
  );

const timestampToPlain = (value) => ({
  _seconds: typeof value.seconds === 'number' ? value.seconds : value._seconds,
  _nanoseconds:
    typeof value.nanoseconds === 'number' ? value.nanoseconds : value._nanoseconds || 0,
});

/**
 * Firestore values that are not plain JSON (Timestamp, server timestamp sentinel)
 * become the same shape the Admin SDK exposes on a stored document.
 */
export const toFirestorePlain = (value) => {
  if (value == null || typeof value !== 'object') return value;
  if (value.constructor?.name === 'ServerTimestampTransform') return nowTimestamp();
  if (isFirestoreTimestamp(value)) return timestampToPlain(value);
  if (Array.isArray(value)) return value.map((item) => toFirestorePlain(item));

  const constructorName = value.constructor?.name;
  if (
    constructorName === 'DeleteTransform' ||
    constructorName === 'NumericIncrementTransform' ||
    constructorName === 'ArrayUnionTransform' ||
    constructorName === 'ArrayRemoveTransform'
  ) {
    return undefined;
  }

  if (
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    constructorName === 'GeoPoint'
  ) {
    return { latitude: value.latitude, longitude: value.longitude };
  }

  const plain = {};
  for (const [key, nested] of Object.entries(value)) {
    const converted = toFirestorePlain(nested);
    if (converted !== undefined) plain[key] = converted;
  }
  return plain;
};

let indexesReady = false;

const ensureIndexes = async (FirestoreOrder) => {
  if (indexesReady) return;
  await FirestoreOrder.createIndexes();
  indexesReady = true;
};

/** Upsert one order into the outlet portal database. Mongo errors do not fail the Firestore write. */
export const mirrorFirestoreOrder = async (orderId, data) => {
  if (!orderId || !data || typeof data !== 'object') return;
  if (!isOutletPortalMongoConnected()) {
    console.warn(`Order ${orderId} was not copied to MongoDB: outlet portal database is not connected`);
    return;
  }

  try {
    const FirestoreOrder = getFirestoreOrderModel();
    const plain = toFirestorePlain(data);
    delete plain._id;
    delete plain.id;
    await ensureIndexes(FirestoreOrder);
    await FirestoreOrder.collection.replaceOne(
      { _id: orderId },
      { _id: orderId, ...plain },
      { upsert: true }
    );
  } catch (error) {
    console.error(`Failed to copy order ${orderId} to MongoDB:`, error.message);
  }
};

/** Remove mirrored orders. Mongo errors are logged and do not fail the Firestore delete. */
export const deleteMirroredOrders = async (orderIds) => {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  if (!isOutletPortalMongoConnected()) {
    console.warn(`Orders were not removed from MongoDB: outlet portal database is not connected`);
    return;
  }

  try {
    const FirestoreOrder = getFirestoreOrderModel();
    await FirestoreOrder.collection.deleteMany({ _id: { $in: ids } });
  } catch (error) {
    console.error('Failed to remove orders from MongoDB:', error.message);
  }
};
