import dns from 'node:dns/promises';
import { createRequire } from 'node:module';

import { isLocalDatabase } from './localDb.js';

// Is this email address plausible and deliverable? Runs on email/password sign-up (see betterAuth.ts hooks.before);
// proving the player OWNS it is the separate OTP flow. Google sign-ups arrive already verified and skip all of this.

const require = createRequire(import.meta.url);
// Data-only package: ~120k throwaway-mail domains (mailinator and friends).
const DISPOSABLE = new Set<string>(require('disposable-email-domains') as string[]);

export type EmailProblemCode = 'invalid-email' | 'email-undeliverable' | 'disposable-email' | 'email-typo';
export interface EmailProblem {
  code: EmailProblemCode;
  /** Only for `email-typo`: the full corrected address to offer. */
  suggestion?: string;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The fake test domain. TEST_EMAIL_DOMAIN lives only in a developer's local server/.env (never in source, docs or the
 * app). It counts ONLY against the local development database: on the production database this is always false, so
 * there the domain is an ordinary invalid address and every exemption/perk keyed on it is unreachable.
 */
export function isTestEmail(
  email: string,
  ctx: { local: boolean; domain: string | undefined } = { local: isLocalDatabase(), domain: process.env.TEST_EMAIL_DOMAIN },
): boolean {
  const domain = ctx.domain?.trim().toLowerCase().replace(/^@/, '');
  if (!ctx.local || !domain) return false;
  return normalizeEmail(email).endsWith(`@${domain}`);
}

// Practical syntax: dot-atom local part (no quotes/comments), a dotted hostname with an alphabetic TLD.
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z]{2,24}$/;

export function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at < 1 || email.length > 254) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TLD.test(labels[labels.length - 1])) return null;
  return { local, domain };
}

// Misspellings of the big providers that nobody types on purpose. An explicit list (not edit distance), so real
// small providers such as ymail.com are never "corrected".
const TYPO_DOMAINS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmal.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhoo.com': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outloook.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com', 'icloud.con': 'icloud.com', 'iclould.com': 'icloud.com',
};

function isDisposable(domain: string): boolean {
  const labels = domain.split('.');
  // Also catches subdomains of a listed domain (x.mailinator.com).
  for (let i = 0; i < labels.length - 1; i++) if (DISPOSABLE.has(labels.slice(i).join('.'))) return true;
  return false;
}

export interface DnsDeps {
  resolveMx: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  resolveAddress: (domain: string) => Promise<string[]>;
  timeoutMs: number;
}

let activeDns: DnsDeps;
const realDns: DnsDeps = {
  resolveMx: (d) => dns.resolveMx(d),
  resolveAddress: async (d) => [...(await dns.resolve4(d).catch(() => [])), ...(await dns.resolve6(d).catch(() => []))],
  timeoutMs: 2000,
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms))]);

/** true = can receive mail, false = definitely cannot, 'unknown' = DNS trouble (callers fail open). */
async function canReceiveMail(domain: string, deps: DnsDeps): Promise<boolean | 'unknown'> {
  try {
    const mx = await withTimeout(deps.resolveMx(domain), deps.timeoutMs);
    if (mx.length > 0) return !(mx.length === 1 && mx[0].exchange === ''); // a lone "." MX is the explicit "no mail here"
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'ENOTFOUND' && code !== 'ENODATA') return 'unknown';
  }
  try {
    // No MX record: mail falls back to the domain's own address record (RFC 5321).
    return (await withTimeout(deps.resolveAddress(domain), deps.timeoutMs)).length > 0;
  } catch {
    return 'unknown';
  }
}

/** Returns the first problem with this address, or null when it looks real. The test domain is exempt. */
// Test seam: lets in-process tests answer DNS without the network. Production code never calls it.
export function setDnsDepsForTests(deps: DnsDeps | null): void {
  activeDns = deps ?? realDns;
}
activeDns = realDns;

export async function checkEmail(raw: string, deps: DnsDeps = activeDns): Promise<EmailProblem | null> {
  const email = normalizeEmail(raw);
  if (isTestEmail(email)) return null;
  const parts = splitEmail(email);
  if (!parts) return { code: 'invalid-email' };
  const typo = TYPO_DOMAINS[parts.domain];
  if (typo) return { code: 'email-typo', suggestion: `${parts.local}@${typo}` };
  if (isDisposable(parts.domain)) return { code: 'disposable-email' };
  if ((await canReceiveMail(parts.domain, deps)) === false) return { code: 'email-undeliverable' };
  return null;
}
