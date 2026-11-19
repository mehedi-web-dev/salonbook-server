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
 * Parses common 12-hour or 24-hour time slots into { hours, minutes }
 * Supports: "10:00 AM", "2:30 PM", "14:00", "10:00 - 11:00 AM"
 */
export const parseTimeSlot = (slotStr) => {
  if (!slotStr || typeof slotStr !== "string") return null;

  // If slot has a range (e.g. "10:00 AM - 11:00 AM"), extract start time
  const rawStartTime = slotStr.includes("-") ? slotStr.split("-")[0].trim() : slotStr.trim();

  // Check 12-hour format e.g. "10:00 AM", "2:30 pm", "10:00am"
  const match12 = rawStartTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const meridiem = (match12[3] || "").toUpperCase();

    // Also check if meridiem was at the end of the full slot (e.g. "10:00 - 11:00 AM")
    const fullMeridiemMatch = slotStr.match(/\b(AM|PM)\b/i);
    const effectiveMeridiem = meridiem || (fullMeridiemMatch ? fullMeridiemMatch[1].toUpperCase() : "");

    if (effectiveMeridiem === "PM" && hours < 12) hours += 12;
    if (effectiveMeridiem === "AM" && hours === 12) hours = 0;

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return { hours, minutes };
    }
  }

  // Check 24-hour format e.g. "14:30"
  const match24 = rawStartTime.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return { hours, minutes };
    }
  }

  return null;
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
