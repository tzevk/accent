export const DAY_MS = 24 * 60 * 60 * 1000;

// Helper: normalize any date value to YYYY-MM-DD format for <input type="date" />
export const normalizeDate = (val) => {
  if (!val) return "";
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val; // already YYYY-MM-DD
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

// Parse a YYYY-MM-DD date into a stable local Date at midnight.
export const parseIsoDay = (iso) => {
  if (!iso || typeof iso !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatShortDayMonth = (d) => {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

export const formatWeekHeaderDate = (d) => {
  const label = formatShortDayMonth(d);
  return label ? label.replace(" ", "-") : "";
};
