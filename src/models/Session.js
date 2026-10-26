import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    userId: {
       type: mongoose.Schema.Types.ObjectId, 
       ref: 'User', 
       required: true, 
       index: true 
      },
    token: { 
      type: String, 
      required: true,
      unique: true,
      index: true,
      select: false,
      },
    userAgent: {   // A user agent is information sent by the browser that describes the browser, operating system, and sometimes the device.
      type: String,
       default: 'Unknown' 
      },
    ipAddress: {  //An IP address identifies the network address from which the request reached your server.
      type: String, 
      default: 'Unknown' 
    },
    expiresAt: {
       type: Date, 
       required: true, 
       index: { expires: 0 } 
      }, // TTL at the absolute expiration time
  },
  { timestamps: true }
);

sessionSchema.set('toJSON', {
  transform: (_document, result) => {
    delete result.token;
    delete result.__v;
    delete result._id;
    delete result.id;
    return result;
  },
});

export default mongoose.model('Session', sessionSchema);
