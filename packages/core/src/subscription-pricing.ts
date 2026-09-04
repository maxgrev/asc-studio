import type {
  SubscriptionParityReason,
  SubscriptionPrice,
  SubscriptionPricePoint,
  SubscriptionPriceSnapshot,
} from "@asc-studio/contracts";
import {
  SUBSCRIPTION_PRICE_LEVEL_RETRIEVED_AT,
  subscriptionPriceLevelFor,
} from "./subscription-price-levels.js";

export const subscriptionPriceSnapshot = (price: SubscriptionPrice): SubscriptionPriceSnapshot => ({
  id: price.id,
  territory: price.territory,
  currency: price.currency,
  customerPrice: price.customerPrice,
  proceeds: price.proceeds,
  proceedsYear2: price.proceedsYear2,
  pricePointId: price.pricePointId,
  startDate: price.startDate,
  preserved: price.preserved,
  planType: price.planType,
});

export const sortedSubscriptionPriceSnapshots = (prices: SubscriptionPrice[]) => prices
  .map(subscriptionPriceSnapshot)
  .sort((left, right) => (
    left.territory.localeCompare(right.territory)
    || (left.startDate ?? "").localeCompare(right.startDate ?? "")
    || left.id.localeCompare(right.id)
  ));

export const subscriptionPriceState = (prices: SubscriptionPrice[], asOfDate: string) => {
  const byTerritory = new Map<string, SubscriptionPrice[]>();
  for (const price of prices) {
    const values = byTerritory.get(price.territory) ?? [];
    values.push(price);
    byTerritory.set(price.territory, values);
  }
  const current = new Map<string, SubscriptionPrice>();
  const scheduled = new Map<string, SubscriptionPrice[]>();
  for (const [territory, values] of byTerritory) {
    const effective = values
      .filter((price) => price.startDate === null || price.startDate <= asOfDate)
      .sort((left, right) => (
        (left.startDate ?? "0000-00-00").localeCompare(right.startDate ?? "0000-00-00")
        || left.id.localeCompare(right.id)
      ));
    const selected = effective.at(-1);
    if (selected) current.set(territory, selected);
    const future = values
      .filter((price) => price.startDate !== null && price.startDate > asOfDate)
      .sort((left, right) => left.startDate!.localeCompare(right.startDate!));
    if (future.length > 0) scheduled.set(territory, future);
  }
  return { current, scheduled };
};

export interface SubscriptionParityBand {
  territoryName: string;
  priceLevelRatio: number | null;
  dataYear: number | null;
  factorPercent: number;
  reason: Exclude<SubscriptionParityReason, "scheduled">;
}

export const subscriptionParityBand = (
  territory: string,
  baseTerritory: string,
  floorPercent: number,
  strengthPercent: number,
): SubscriptionParityBand => {
  const datum = subscriptionPriceLevelFor(territory);
  const baseDatum = subscriptionPriceLevelFor(baseTerritory);
  if (territory === baseTerritory) {
    return {
      territoryName: datum?.name ?? territory,
      priceLevelRatio: datum?.ratio ?? null,
      dataYear: datum?.year ?? null,
      factorPercent: 100,
      reason: "base",
    };
  }
  if (!datum || !baseDatum) {
    return {
      territoryName: territory,
      priceLevelRatio: null,
      dataYear: null,
      factorPercent: 100,
      reason: "no_data",
    };
  }
  const relativeRatio = datum.ratio / baseDatum.ratio;
  const boundedRatio = Math.min(1, relativeRatio);
  const softened = 100 - (100 - boundedRatio * 100) * (strengthPercent / 100);
  const guarded = Math.max(floorPercent, softened);
  const factorPercent = Math.min(100, Math.ceil((guarded - Number.EPSILON) / 5) * 5);
  return {
    territoryName: datum.name,
    priceLevelRatio: relativeRatio,
    dataYear: datum.year,
    factorPercent,
    reason: softened <= floorPercent ? "floor" : "ppp",
  };
};

export const selectPricePointAtOrAbove = (
  points: SubscriptionPricePoint[],
  target: number,
) => points
  .slice()
  .sort((left, right) => Number(left.customerPrice) - Number(right.customerPrice))
  .find((point) => Number(point.customerPrice) + Number.EPSILON >= target) ?? null;

export const pricePointByTerritory = (points: SubscriptionPricePoint[]) => new Map(
  points.map((point) => [point.territory, point] as const),
);

export const subscriptionPriceLevelSource = {
  name: "World Bank World Development Indicators" as const,
  indicators: ["PA.NUS.PPP", "PA.NUS.FCRF"] as ["PA.NUS.PPP", "PA.NUS.FCRF"],
  retrievedAt: SUBSCRIPTION_PRICE_LEVEL_RETRIEVED_AT,
};
