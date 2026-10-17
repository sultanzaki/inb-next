export type AnalyticsPeriod = 30 | 90;
export type AnalyticsBucket = {
  from: string;
  to: string;
  passed: number;
  failed: number;
  issued: number;
};
export type DashboardAnalytics = {
  period: AnalyticsPeriod;
  from: string;
  to: string;
  buckets: AnalyticsBucket[];
  documents: { valid: number; expiring: number; expired: number };
};
export function shiftDate(date: string, days: number) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function analyticsBuckets(
  today: string,
  period: AnalyticsPeriod,
): AnalyticsBucket[] {
  const start = shiftDate(today, 1 - period),
    size = period / 6;
  return Array.from({ length: 6 }, (_, i) => ({
    from: shiftDate(start, i * size),
    to: shiftDate(start, (i + 1) * size - 1),
    passed: 0,
    failed: 0,
    issued: 0,
  }));
}
