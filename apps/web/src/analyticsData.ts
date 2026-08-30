import type {
  AnalyticsAvailability,
  AnalyticsFilters,
  AnalyticsMetricChange,
  AnalyticsMetricId,
  AnalyticsMetricUnit,
  AnalyticsMetricValue,
  AnalyticsSeriesPoint,
} from "@asc-studio/contracts";

export type AnalyticsRangePreset = "7d" | "30d" | "90d";

export const analyticsRangeDays: Record<AnalyticsRangePreset, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const analyticsMetricLabels: Record<AnalyticsMetricId, string> = {
  IMPRESSIONS: "Impressions",
  DOWNLOADS: "Total downloads",
  FIRST_TIME_DOWNLOADS: "First-time downloads",
  PRODUCT_PAGE_VIEWS: "Product page views",
  DOWNLOAD_RATE: "Download rate",
  SESSIONS: "Sessions",
  PROCEEDS: "Estimated proceeds",
};

const parseIsoDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
};

const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);

export const shiftIsoDate = (value: string, amount: number) => {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatIsoDate(date);
};

export const analyticsDateRange = (preset: AnalyticsRangePreset, endDate: string) => ({
  startDate: shiftIsoDate(endDate, -(analyticsRangeDays[preset] - 1)),
  endDate,
});

export const analyticsPortfolioMembershipKey = (appIds: readonly string[]) => [...appIds].sort().join("\u001f");

export const analyticsQueryKey = (input: {
  portfolioMembership: string;
  scopeId: string;
  range: AnalyticsRangePreset;
  compare: "NONE" | "PREVIOUS_PERIOD";
  filters: AnalyticsFilters;
}) => JSON.stringify(input);

export const emptyAnalyticsFilters = (): AnalyticsFilters => ({
  territories: [],
  sources: [],
  productPages: [],
  versions: [],
});

const analyticsFilterParameters = {
  territories: "analyticsTerritory",
  sources: "analyticsSource",
  productPages: "analyticsProductPage",
  versions: "analyticsVersion",
} as const;

export const analyticsFiltersFromSearchParams = (parameters: URLSearchParams): AnalyticsFilters => Object.fromEntries(
  Object.entries(analyticsFilterParameters).map(([dimension, parameter]) => {
    const value = parameters.get(parameter)?.trim();
    return [dimension, value && value.length <= 200 ? [value] : []];
  }),
) as AnalyticsFilters;

export const writeAnalyticsFiltersToSearchParams = (parameters: URLSearchParams, filters: AnalyticsFilters) => {
  Object.entries(analyticsFilterParameters).forEach(([dimension, parameter]) => {
    const value = filters[dimension as keyof AnalyticsFilters][0];
    if (value) parameters.set(parameter, value);
    else parameters.delete(parameter);
  });
};

export const analyticsFilterCount = (filters: AnalyticsFilters) => Object.values(filters)
  .reduce((total, values) => total + values.length, 0);

export const todayIsoDate = (now = new Date()) => formatIsoDate(new Date(Date.UTC(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
)));

export const availabilityLabel = (availability: AnalyticsAvailability) => {
  if (availability === "PRIVACY_WITHHELD") return "Withheld for privacy";
  if (availability === "PARTIAL") return "Partial";
  if (availability === "UNAVAILABLE") return "Unavailable";
  return "Available";
};

export const formatAnalyticsValue = (
  metricValue: AnalyticsMetricValue | null | undefined,
  unit: AnalyticsMetricUnit,
) => {
  if (!metricValue || metricValue.value === null || metricValue.availability === "UNAVAILABLE" || metricValue.availability === "PRIVACY_WITHHELD") {
    return "—";
  }
  if (unit === "RATIO") {
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(metricValue.value);
  }
  if (unit === "CURRENCY_USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(metricValue.value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(metricValue.value);
};

/**
 * A truthful, standalone rendering for values shown outside a KPI's two-line
 * layout. Missing and privacy-held observations stay distinguishable, while a
 * numeric partial observation keeps its qualification attached to the value.
 */
export const formatAnalyticsValueWithAvailability = (
  metricValue: AnalyticsMetricValue | null | undefined,
  unit: AnalyticsMetricUnit,
) => {
  const availability = metricValue?.availability ?? "UNAVAILABLE";
  if (availability === "PRIVACY_WITHHELD" || availability === "UNAVAILABLE") {
    return availabilityLabel(availability);
  }
  const formatted = formatAnalyticsValue(metricValue, unit);
  return availability === "PARTIAL" ? `${formatted} · Partial` : formatted;
};

export const formatAnalyticsChange = (
  change: AnalyticsMetricChange | null | undefined,
  unit: AnalyticsMetricUnit,
) => {
  if (!change) return null;
  if (unit === "RATIO" && change.absolute !== null) {
    const points = change.absolute * 100;
    return `${points > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(points)} pt`;
  }
  if (change.relative === null) return null;
  return `${change.relative > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(change.relative)}`;
};

export const analyticsChangeTone = (change: AnalyticsMetricChange | null | undefined) => {
  const value = change?.absolute ?? change?.relative;
  if (value === null || value === undefined || value === 0) return "neutral" as const;
  return value > 0 ? "positive" as const : "negative" as const;
};

export interface AnalyticsChartPoint {
  index: number;
  date: string;
  current: number | null;
  previous: number | null;
  currentAvailability: AnalyticsAvailability;
  previousAvailability: AnalyticsAvailability | null;
}

export const chartPoints = (points: AnalyticsSeriesPoint[]): AnalyticsChartPoint[] => points.map((point, index) => ({
  index,
  date: point.date,
  current: point.current.value,
  previous: point.previous?.value ?? null,
  currentAvailability: point.current.availability,
  previousAvailability: point.previous?.availability ?? null,
}));

export interface ChartSegment {
  path: string;
}

export const chartSegments = (
  points: AnalyticsChartPoint[],
  key: "current" | "previous",
  width: number,
  height: number,
  inset = 8,
) => {
  const numericValues = points.flatMap((point) => [point.current, point.previous]).filter((value): value is number => value !== null);
  const maximum = Math.max(...numericValues, 1);
  const minimum = Math.min(...numericValues, 0);
  const span = Math.max(maximum - minimum, 1);
  const denominator = Math.max(points.length - 1, 1);
  const x = (index: number) => inset + index / denominator * (width - inset * 2);
  const y = (value: number) => inset + (maximum - value) / span * (height - inset * 2);
  const segments: ChartSegment[] = [];
  let commands: string[] = [];

  points.forEach((point, index) => {
    const value = point[key];
    if (value === null) {
      if (commands.length) segments.push({ path: commands.join(" ") });
      commands = [];
      return;
    }
    commands.push(`${commands.length ? "L" : "M"} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`);
  });
  if (commands.length) segments.push({ path: commands.join(" ") });
  return { segments, maximum, minimum, x, y };
};

export const shortDate = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
}).format(parseIsoDate(value));
