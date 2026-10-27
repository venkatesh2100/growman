// Indian seasons and the next care reminder time.
// Plant care pages call seasonFor. My-plants reminders call nextDue, nextDueAt, and isDue.
// Months follow Asia/Kolkata, not the server clock. seasonFor returns the copy the app shows.

// A Date whose local fields match the clock in India. Callers that only need the month should use monthInIndia.
export function india(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

// Calendar month 1–12 in India. Used so a server in UTC does not call December "winter" a few hours early, or late.
function monthInIndia(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "numeric" }).formatToParts(date);
  return Number(parts.find((p) => p.type === "month").value);
}

// Care home and plant pages call this. Returns the season id, the sentences the app shows, guide slugs, and shop categories.
// Winter is Dec–Feb, summer Mar–May, monsoon Jun–Sep, and Oct–Nov is the reset after the rains.
export function seasonFor(date = new Date()) {
  const month = monthInIndia(date);
  if (month === 12 || month <= 2) {
    return {
      season: "winter",
      title: "Winter care",
      summary: "Growth slows and pots stay damp longer. Water less often, keep plants out of cold draughts, and hold off heavy feeding.",
      wateringNote: "Check the soil before watering. Many indoor pots only need water every 7–10 days.",
      fertilizingNote: "Feed lightly, or skip fertilizing until new growth starts.",
      tasks: [
        "Move balcony plants away from cold night wind.",
        "Water in the morning so foliage dries before evening.",
        "Wipe dust off indoor leaves so they can use the weaker light.",
      ],
      guideSlugs: ["how-often-to-water-indoor-plants", "best-indoor-plants-for-indian-homes"],
      shopCategories: ["indoor-plants"],
    };
  }
  if (month >= 3 && month <= 5) {
    return {
      season: "summer",
      title: "Summer care",
      summary: "Heat and dry air pull moisture out of pots quickly. Shade midday sun and water by checking the soil, not by a fixed summer habit.",
      wateringNote: "Check pots every two or three days. Water thoroughly when the top few centimetres are dry.",
      fertilizingNote: "A light feed every 3–4 weeks is enough while plants are growing. Do not feed a plant that is heat-stressed.",
      tasks: [
        "Shift pots back from west-facing glass in the afternoon.",
        "Mulch outdoor pots so the surface does not bake.",
        "Keep plants out of the direct blast of a cooler or AC vent.",
      ],
      guideSlugs: ["outdoor-and-balcony-plant-care-in-india", "how-often-to-water-indoor-plants"],
      shopCategories: ["outdoor-plants", "indoor-plants"],
    };
  }
  if (month >= 6 && month <= 9) {
    return {
      season: "monsoon",
      title: "Monsoon care",
      summary: "Humidity stays high and soil dries slowly. The usual summer watering routine is the fastest way to rot roots now.",
      wateringNote: "Wait until the top of the soil is dry. Outdoor pots may not need watering for a week after rain.",
      fertilizingNote: "Pause fertilizing while the soil stays wet. Feed again once the rains ease.",
      tasks: [
        "Tip excess water out of saucers and cache pots.",
        "Watch for fungus gnats and yellowing from wet roots.",
        "Give indoor plants air; do not crowd them against a damp wall.",
      ],
      guideSlugs: ["how-often-to-water-indoor-plants", "outdoor-and-balcony-plant-care-in-india"],
      shopCategories: ["indoor-plants"],
    };
  }
  return {
    season: "post_monsoon",
    title: "After the rains",
    summary: "October and November are the easiest months to reset a collection: repot, resume feeding, and set a watering rhythm before summer.",
    wateringNote: "Return to watering when the top few centimetres dry out, usually every 4–7 days indoors.",
    fertilizingNote: "Resume a monthly feed for plants that are putting out new leaves.",
    tasks: [
      "Repot anything that is root-bound, while the weather is mild.",
      "Prune damaged monsoon growth.",
      "Set watering and fertilizing reminders before the routine slips.",
    ],
    guideSlugs: ["outdoor-and-balcony-plant-care-in-india", "best-indoor-plants-for-indian-homes"],
    shopCategories: ["outdoor-plants", "fruit-plants"],
  };
}

// Year, month, day, and hour on the India clock. nextDueAt uses this so a reminder lands on a calendar day in Kolkata.
function partsInIndia(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
  };
}

// My-plants calls this when a watering or feeding interval is saved.
// Adds everyDays, then pins the clock to `hour` in India so the reminder is not a random UTC time.
// Returns a Date, or null when the interval is missing or not positive. An hour outside 0–23 becomes 8.
export function nextDueAt(from, everyDays, hour = 8) {
  if (!everyDays || everyDays <= 0) return null;
  if (hour < 0 || hour > 23) hour = 8;
  const base = from instanceof Date ? from : new Date(from);
  const shifted = new Date(base.getTime() + everyDays * 24 * 60 * 60 * 1000);
  const p = partsInIndia(shifted);
  const hh = String(hour).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  // +05:30 is India Standard Time. There is no daylight-saving shift to account for.
  return new Date(`${p.year}-${mm}-${dd}T${hh}:00:00+05:30`);
}

// Same as nextDueAt, always at 8:00 India time. Reminder jobs call this. Returns a Date or null.
export function nextDue(from, everyDays) {
  return nextDueAt(from, everyDays, 8);
}

// True when the reminder time has arrived. A missing next date is not due, so a plant with no schedule stays quiet.
export function isDue(next, now = new Date()) {
  if (!next) return false;
  return new Date(next).getTime() <= now.getTime();
}
