/**
 * Validates if a date string is in strict YYYY-MM-DD format and represents a real calendar date.
 */
export const isValidDateString = (dateStr) => {
  if (!dateStr || typeof dateStr !== "string") return false;
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
};

/**
 * Parses common 12-hour or 24-hour time slots into { hours, minutes }.
 * Supports: "10:00 AM", "2:30 PM", "02:30 PM", "14:00", "10:00 - 11:00 AM".
 * Rejects invalid hours (e.g. 14:00 PM, 25:00) and invalid minutes.
 */
export const parseTimeSlot = (slotStr) => {
  if (!slotStr || typeof slotStr !== "string") return null;

  const trimmed = slotStr.trim();
  if (trimmed.length < 3 || trimmed.length > 50) return null;

  // If slot has a range (e.g. "10:00 AM - 11:00 AM" or "10:00 - 11:00"), extract start time
  const rawStartTime = trimmed.includes("-") ? trimmed.split("-")[0].trim() : trimmed;

  // Check if meridiem (AM/PM) was specified at the end of the full range: "10:00 - 11:00 AM"
  const rangeMeridiemMatch = trimmed.includes("-") ? trimmed.match(/\b(AM|PM)\b/i) : null;

  // 1. Check 12-hour format e.g. "10:00 AM", "2:30 pm", "02:30 PM"
  const match12 = rawStartTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12 || (rangeMeridiemMatch && rawStartTime.match(/^(\d{1,2}):(\d{2})$/))) {
    const timeMatch = match12 || rawStartTime.match(/^(\d{1,2}):(\d{2})$/);
    const rawHours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const meridiem = (match12 ? match12[3] : rangeMeridiemMatch[1]).toUpperCase();

    // In 12-hour format, hours must be between 1 and 12, minutes 0 to 59
    if (rawHours < 1 || rawHours > 12 || minutes < 0 || minutes > 59) {
      return null;
    }

    let hours = rawHours;
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;

    return { hours, minutes };
  }

  // 2. Check 24-hour format e.g. "00:00" to "23:59", "10:00", "14:30"
  const match24 = rawStartTime.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }

  return null;
};

/**
 * Normalizes any valid 12-hour or 24-hour time input into canonical 24-hour 'HH:mm' format.
 * Returns null if the input cannot be parsed into a valid time.
 * Examples:
 *   "10:00 AM" -> "10:00"
 *   "10:00"    -> "10:00"
 *   "02:30 PM" -> "14:30"
 *   "2:30 PM"  -> "14:30"
 *   "14:30"    -> "14:30"
 *   "12:00 AM" -> "00:00"
 *   "12:00 PM" -> "12:00"
 */
export const normalizeTimeSlot = (slotStr) => {
  const parsed = parseTimeSlot(slotStr);
  if (!parsed) return null;

  const hh = String(parsed.hours).padStart(2, "0");
  const mm = String(parsed.minutes).padStart(2, "0");
  return `${hh}:${mm}`;
};

/**
 * Checks if a given appointmentDate (YYYY-MM-DD) and timeSlot is in the past compared to current server time.
 */
export const isPastDateTime = (dateStr, timeSlotStr) => {
  if (!isValidDateString(dateStr)) return true;

  const [year, month, day] = dateStr.trim().split("-").map(Number);
  const now = new Date();

  // Today's date boundary at midnight
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const targetDateMidnight = new Date(year, month - 1, day, 0, 0, 0, 0);

  // If date is before today, it is strictly in the past
  if (targetDateMidnight < todayMidnight) {
    return true;
  }

  // If date is today, check if timeSlot is in the past
  if (targetDateMidnight.getTime() === todayMidnight.getTime()) {
    const parsedTime = parseTimeSlot(timeSlotStr);
    if (parsedTime) {
      const slotDateTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        parsedTime.hours,
        parsedTime.minutes,
        0,
        0
      );
      if (slotDateTime <= now) {
        return true;
      }
    }
  }

  return false;
};
