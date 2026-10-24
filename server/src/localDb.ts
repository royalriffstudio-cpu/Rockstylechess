// True only when DATABASE_URL points at the local Postgres dev database (see server/README.md's "Local development
// vs. production"). Everything that exists purely for development -- the test-account perks and exemptions in
// emailPolicy.ts -- is gated on this so it can never fire against the real Neon database, whether someone runs the
// server locally with ENV_FILE=.env.production or this ends up deployed reading .env.production directly. Checked by
// hostname, not NODE_ENV (nothing in this server sets NODE_ENV), since the DB target is the one thing that actually
// distinguishes "local" from "production" here.
export function isLocalDatabase(url: string | undefined = process.env.DATABASE_URL): boolean {
  try {
    const { hostname } = new URL(url ?? '');
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}
