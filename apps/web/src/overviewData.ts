import type { AppleAdsCampaign, AppStoreVersion, BuildSummary, MutationPlan } from "@asc-studio/contracts";

const platformOrder: Record<string, number> = {
  IOS: 0,
  MAC_OS: 1,
  TV_OS: 2,
  VISION_OS: 3,
};

const timestamp = (value: string | null | undefined) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const versionParts = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);

const compareVersions = (left: string, right: string) => {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

export const sortBuilds = (builds: BuildSummary[]) => [...builds].sort((left, right) => {
  const dateDifference = timestamp(right.uploadedAt) - timestamp(left.uploadedAt);
  if (dateDifference !== 0) return dateDifference;
  return right.buildNumber.localeCompare(left.buildNumber, undefined, { numeric: true });
});

export const sortVersions = (versions: AppStoreVersion[]) => [...versions].sort((left, right) => {
  if (left.editable !== right.editable) return left.editable ? -1 : 1;
  const dateDifference = timestamp(right.createdAt) - timestamp(left.createdAt);
  if (dateDifference !== 0) return dateDifference;
  const versionDifference = compareVersions(left.versionString, right.versionString);
  if (versionDifference !== 0) return versionDifference;
  return (platformOrder[left.platform] ?? 99) - (platformOrder[right.platform] ?? 99);
});

export const selectPrimaryRelease = (versions: AppStoreVersion[], builds: BuildSummary[]) => {
  const sortedVersions = sortVersions(versions);
  const editable = sortedVersions.filter((version) => version.editable);
  const candidates = editable.length ? editable : sortedVersions;
  const buildsByRelease = new Map<string, number>();

  for (const build of builds) {
    const key = `${build.platform}:${build.version}`;
    buildsByRelease.set(key, Math.max(buildsByRelease.get(key) ?? 0, timestamp(build.uploadedAt)));
  }

  return [...candidates].sort((left, right) => {
    const leftUpload = buildsByRelease.get(`${left.platform}:${left.versionString}`) ?? 0;
    const rightUpload = buildsByRelease.get(`${right.platform}:${right.versionString}`) ?? 0;
    if (leftUpload !== rightUpload) return rightUpload - leftUpload;
    return candidates.indexOf(left) - candidates.indexOf(right);
  })[0] ?? null;
};

export const matchingBuild = (version: AppStoreVersion | null, builds: BuildSummary[]) => {
  if (!version) return null;
  return sortBuilds(builds).find((build) =>
    build.platform === version.platform && build.version === version.versionString
  ) ?? null;
};

export const activePlans = (plans: MutationPlan[], now = Date.now()) => plans.filter((plan) =>
  plan.state === "awaiting_confirmation" && timestamp(plan.expiresAt) > now
);

export const pendingPlanCountLabel = (sourcePlans: MutationPlan[], activeCount = activePlans(sourcePlans).length) =>
  sourcePlans.length >= 50 ? `${activeCount}+` : String(activeCount);

export const campaignCounts = (campaigns: AppleAdsCampaign[]) => {
  const current = campaigns.filter((campaign) => !campaign.deleted);
  return {
    total: current.length,
    enabled: current.filter((campaign) => campaign.status.toUpperCase() === "ENABLED").length,
    paused: current.filter((campaign) => campaign.status.toUpperCase() === "PAUSED").length,
  };
};

export const budgetSummary = (campaigns: AppleAdsCampaign[]) => {
  const totals = new Map<string, number>();
  for (const campaign of campaigns) {
    if (campaign.deleted) continue;
    const amount = Number(campaign.dailyBudget.amount);
    if (!Number.isFinite(amount)) continue;
    totals.set(campaign.dailyBudget.currency, (totals.get(campaign.dailyBudget.currency) ?? 0) + amount);
  }

  if (totals.size === 0) return "No daily budget";
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => `${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)} ${currency}`)
    .join(" · ");
};

export const relativeTime = (value: string | null | undefined, now = Date.now()) => {
  const target = timestamp(value);
  if (!target) return "Time unavailable";
  const seconds = Math.round((target - now) / 1_000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (absolute < 60) return formatter.format(seconds, "second");
  if (absolute < 3_600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3_600), "hour");
  return formatter.format(Math.round(seconds / 86_400), "day");
};
