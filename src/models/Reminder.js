import mongoose from 'mongoose';
import normalizeReminderTitle from '../utils/normalizeReminderTitle.js';

const reminderSchema = new mongoose.Schema(
  {
    userId: {
       type: mongoose.Schema.Types.ObjectId, 
       ref: 'User', 
       required: true, 
       index: true 
      },
    title: {
       type: String, 
       required: true,
        trim: true, 
        maxlength: 120 
      },
    normalizedTitle: {
      type: String,
      select: false,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    category: {
      type: String,
      enum: ['work', 'personal', 'health', 'study', 'finance', 'urgent', 'other'],
      default: 'personal',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    dueDate: { 
      type: Date,
       required: true, 
       index: true 
      },
    advanceNoticeMinutes: { 
      type: Number,
       default: 0
       },
    notifyAt: { 
      type: Date, 
      required: true, 
      index: true },
    status: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending',
      index: true,
    },
    completedAt: { type: Date, default: null },
    isNotified: { type: Boolean, default: false, index: true },
    notifiedAt: { type: Date, default: null },
    notificationError: { type: String, default: null },
  },
  { timestamps: true }
);

reminderSchema.pre('validate', function normalizeTitleForUniqueness() {
  if (this.isModified('title')) {
    this.normalizedTitle = normalizeReminderTitle(this.title);
  }
});

reminderSchema.set('toJSON', {
  transform: (_document, result) => {
    delete result.normalizedTitle;
    delete result.__v;
    return result;
  },
});

reminderSchema.index({ userId: 1, status: 1, dueDate: 1 });
reminderSchema.index({ isNotified: 1, status: 1, notifyAt: 1 });
reminderSchema.index(
  { userId: 1, normalizedTitle: 1 },
  {
    unique: true,
    partialFilterExpression: { normalizedTitle: { $type: 'string' } },
    name: 'unique_user_normalized_reminder_title',
  }
);

export default mongoose.model('Reminder', reminderSchema);
