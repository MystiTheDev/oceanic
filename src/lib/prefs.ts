/** App-wide preferences read outside React props (calendar maths, timer chime). App keeps them in sync with Settings. */
export const prefs = {
  /** 0 = Sunday, 1 = Monday. */
  weekStart: 0 as 0 | 1,
  chime: true,
};

/** Start of the week containing `d`, honouring Settings → Preferences → Start week on. */
export const startOfWeek = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() - prefs.weekStart + 7) % 7));
/** Weekday numbers (0 = Sun) in display order. */
export const weekOrder = () => Array.from({ length: 7 }, (_, i) => (i + prefs.weekStart) % 7);
