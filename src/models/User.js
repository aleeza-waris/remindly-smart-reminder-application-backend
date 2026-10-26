import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
       type: String,
        required: true, 
        trim: true,
        maxlength: 100
      },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true, 
      trim: true,
      maxlength: 254
    },
    password: {
      type: String,
      default: null,
      select: false,
    },
    googleId: { 
      type: String, 
      default: null 
    },
    avatar: { 
      type: String, 
      default: null 
    },
    timezone: { 
      type: String, 
      default: 'UTC'
     },
    timezoneConfigured: {
      type: Boolean,
      default: false,
    },
    defaultAdvanceNotice: { 
      type: Number, 
      default: 15
     },
    emailAlertsEnabled: { 
      type: Boolean, 
      default: true
     },
    soundAlertsEnabled: { 
      type: Boolean, 
      default: true 
    },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  transform: (_document, result) => {
    delete result.password;
    delete result.googleId;
    delete result.timezoneConfigured;
    delete result.__v;
    delete result._id;
    delete result.id;
    return result;
  },
});

export default mongoose.model('User', userSchema);
