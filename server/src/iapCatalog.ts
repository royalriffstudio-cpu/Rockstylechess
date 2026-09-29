// Authoritative real-money pack catalog -- the client's shop.tsx display data
// (id/amount/badge/bonus copy) is display-only and must never be trusted for
// price or reward amount; this is the only source of truth the server credits
// against, matched to the Android product IDs created in Play Console ->
// Monetization -> Products -> In-app products (IDs must match EXACTLY).
//
// 'stadium-vault' (shop.tsx's free "Claim" pack) is deliberately absent --
// it's not a real-money product.
//
// bonusCosmeticId is null for every pack today: shop.tsx's "bonus-pack"
// previously advertised a bundled "Electric Legend" piece skin, but no such
// cosmetic exists in the pieceSets.ts/cosmeticItems catalog (no art asset
// behind it) -- rather than invent a fake cosmeticItems.id, the bonus claim
// was removed from the pack's display copy and this stays null until a real
// cosmetic is created, at which point set this to that cosmeticItems.id.
export interface IapPack {
  id: string;
  androidProductId: string;
  currency: 'chips' | 'gems';
  amount: number;
  priceUsdCents: number;
  bonusCosmeticId: string | null;
}

export const IAP_CATALOG: IapPack[] = [
  { id: 'starter', androidProductId: 'chips_starter_1000', currency: 'chips', amount: 1_000, priceUsdCents: 199, bonusCosmeticId: null },
  { id: 'roadie-box', androidProductId: 'chips_roadie_10000', currency: 'chips', amount: 10_000, priceUsdCents: 999, bonusCosmeticId: null },
  { id: 'bonus-pack', androidProductId: 'chips_bonus_250000', currency: 'chips', amount: 250_000, priceUsdCents: 4999, bonusCosmeticId: null },
  { id: 'headliner-chest', androidProductId: 'chips_headliner_50000', currency: 'chips', amount: 50_000, priceUsdCents: 2499, bonusCosmeticId: null },
  { id: 'gem-100', androidProductId: 'gems_100', currency: 'gems', amount: 100, priceUsdCents: 99, bonusCosmeticId: null },
  { id: 'gem-550', androidProductId: 'gems_550', currency: 'gems', amount: 550, priceUsdCents: 499, bonusCosmeticId: null },
  { id: 'gem-1200', androidProductId: 'gems_1200', currency: 'gems', amount: 1_200, priceUsdCents: 999, bonusCosmeticId: null },
];

const BY_ID = new Map(IAP_CATALOG.map((pack) => [pack.id, pack]));
const BY_ANDROID_PRODUCT_ID = new Map(IAP_CATALOG.map((pack) => [pack.androidProductId, pack]));

export function getPackById(packId: string): IapPack | undefined {
  return BY_ID.get(packId);
}

export function getPackByAndroidProductId(androidProductId: string): IapPack | undefined {
  return BY_ANDROID_PRODUCT_ID.get(androidProductId);
}
