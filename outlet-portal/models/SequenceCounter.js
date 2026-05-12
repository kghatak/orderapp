import mongoose from 'mongoose';
import { getPortalConnection } from '../config/portalDb.js';

/**
 * Central store for monotonic sequences (e.g. sale invoice numbers).
 * One document per logical counter: _id = namespaced key, seq = last value before $inc emit (see businessIds).
 */
const sequenceCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 }
  },
  { collection: 'sequencecounters', strict: true, versionKey: false }
);

export const getSequenceCounterModel = () => {
  const conn = getPortalConnection();
  return conn.models.SequenceCounter || conn.model('SequenceCounter', sequenceCounterSchema);
};
