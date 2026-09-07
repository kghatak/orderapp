import mongoose from 'mongoose';

export const isMongoConnected = () => mongoose.connection.readyState === 1;

export const connectMongoDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/orderapp';
    await mongoose.connect(uri);
        return true;
  } catch (err) {
    console.warn('⚠️ MongoDB not connected – skipping. Order app will work; Milk module will be unavailable.', err.message);
    return false;
  }
};
