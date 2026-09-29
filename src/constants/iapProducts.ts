// Maps shop.tsx's pack ids to the Android product IDs created in Play
// Console -> Monetization -> Products -> In-app products. Mirrors (id-only,
// not price/amount) server/src/iapCatalog.ts, which is the actual source of
// truth the server credits against -- this side just needs to know which
// SKU to ask the store for. Keep both lists in sync by hand when either
// changes, same convention as this project's other client/server mirror
// pairs (e.g. countries.ts / countryCodes.ts).
export const IAP_PRODUCT_IDS: Record<string, string> = {
  starter: 'chips_starter_1000',
  'roadie-box': 'chips_roadie_10000',
  'bonus-pack': 'chips_bonus_250000',
  'headliner-chest': 'chips_headliner_50000',
  'gem-100': 'gems_100',
  'gem-550': 'gems_550',
  'gem-1200': 'gems_1200',
};

export const ALL_IAP_ANDROID_PRODUCT_IDS = Object.values(IAP_PRODUCT_IDS);

export function androidProductIdForPack(packId: string): string | undefined {
  return IAP_PRODUCT_IDS[packId];
}

export function packIdForAndroidProductId(androidProductId: string): string | undefined {
  return Object.keys(IAP_PRODUCT_IDS).find((packId) => IAP_PRODUCT_IDS[packId] === androidProductId);
}
