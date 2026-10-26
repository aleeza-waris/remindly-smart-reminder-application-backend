import mongoose from 'mongoose';

const connectDB = async () => {
  const { MONGODB_URI } = process.env;

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required to connect to MongoDB.');
  }

  mongoose.connection.on('error', (error) => {
    const code = typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(error.code)
      ? ` (code=${error.code})`
      : '';
    console.error(`MongoDB connection error: ${error?.name || 'UnknownError'}${code}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.error('MongoDB connection was disconnected.');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB connection recovered.');
  });

  await mongoose.connect(MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
  });

  console.log('MongoDB connected.');
};

export default connectDB;
