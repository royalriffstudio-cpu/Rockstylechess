import { GoogleAuth } from 'google-auth-library';

// Server-side verification against the Google Play Developer (Android
// Publisher) API -- the only trustworthy way to confirm a purchase actually
// happened. A client claiming "purchase succeeded, credit me" with no
// server-side check is trivially fakeable. Requires a Google Cloud service
// account linked in Play Console -> Setup -> API access with view access to
// "Financial data, orders, and cancellation survey responses" for this app
// (see this repo's IAP plan for the one-time manual setup).
//
// Declared/validated at point of use (not centralized in env.ts, which does
// no validation of its own) -- same pattern as betterAuth.ts's
// BETTER_AUTH_SECRET check.
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME;

let authClient: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (!SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set');
  if (!PACKAGE_NAME) throw new Error('ANDROID_PACKAGE_NAME is not set');
  if (!authClient) {
    authClient = new GoogleAuth({
      credentials: JSON.parse(SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  }
  return authClient;
}

const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

// purchaseState: 0 = purchased, 1 = canceled, 2 = pending.
interface ProductPurchase {
  purchaseState: number;
  acknowledgementState: number;
  orderId?: string;
}

export type VerifyResult = { status: 'valid'; orderId: string | null } | { status: 'invalid' };

export async function verifyProductPurchase(productId: string, purchaseToken: string): Promise<VerifyResult> {
  const client = await getAuth().getClient();
  const url = `${API_BASE}/applications/${PACKAGE_NAME}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await client.request<ProductPurchase>({ url });
  if (res.data.purchaseState !== 0) return { status: 'invalid' };
  return { status: 'valid', orderId: res.data.orderId ?? null };
}

// Acknowledging is required within 3 days of purchase or Google auto-refunds
// it. Consuming is required for a one-time ("managed") product meant to be
// repeatable (all chip/gem packs are) -- without it, Play Billing treats the
// product as permanently owned and blocks buying that same SKU again.
export async function acknowledgeAndConsume(productId: string, purchaseToken: string): Promise<void> {
  const client = await getAuth().getClient();
  const base = `${API_BASE}/applications/${PACKAGE_NAME}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  // Acknowledge can 400 if Play already auto-acknowledged/consumed it (e.g. a
  // retried call) -- not fatal, consume is what actually matters for
  // repeatability and is attempted regardless.
  try {
    await client.request({ url: `${base}:acknowledge`, method: 'POST', data: {} });
  } catch (error) {
    console.log('Purchase acknowledge failed (continuing to consume)', error);
  }
  await client.request({ url: `${base}:consume`, method: 'POST', data: {} });
}
