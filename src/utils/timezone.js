export const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
};

export const initializeUserTimeZone = async (user, timeZone) => {
  if (user.timezoneConfigured || !isValidTimeZone(timeZone)) {
    return;
  }

  if (user.timezone && user.timezone !== 'UTC') {
    user.timezoneConfigured = true;
    await user.save();
    return;
  }

  user.timezone = timeZone;
  user.timezoneConfigured = true;
  await user.save();
};
