import { isLocalDatabase } from './localDb.js';

// Outbound mail (verification and password-reset codes) over Resend's HTTP API -- no mail dependency, plain fetch.
//   RESEND_API_KEY, MAIL_FROM   required in production
// With neither set on the LOCAL development database the message is printed to the console instead, so the flows can
// be driven by hand. A non-local database never prints a message (that would put codes in production logs) and
// never pretends to have sent one: with no key it fails loudly.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const RESEND_URL = process.env.MAIL_API_URL ?? 'https://api.resend.com/emails'; // overridable so tests can point at a stub

export async function sendMail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    if (isLocalDatabase()) {
      console.log(`[mail:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
      return;
    }
    throw new Error('mail is not configured (RESEND_API_KEY / MAIL_FROM)');
  }
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (!res.ok) throw new Error(`mail provider answered HTTP ${res.status}`);
}

// Per-address pacing so the code endpoints cannot be used to mail-bomb a stranger: one message per address per
// 60 s and at most 10 a day, whichever endpoint asked. In memory, like the other limiters (a restart resets it).
const sent = new Map<string, number[]>();
export function mailAllowed(address: string, now = Date.now()): boolean {
  const key = address.trim().toLowerCase();
  const recent = (sent.get(key) ?? []).filter((t) => now - t < 86_400_000);
  if (recent.length >= 10) return false;
  if (recent.length > 0 && now - recent[recent.length - 1] < 60_000) return false;
  recent.push(now);
  sent.set(key, recent);
  if (sent.size > 20_000) for (const [k, ts] of sent) if (ts.every((t) => now - t >= 86_400_000)) sent.delete(k);
  return true;
}

// Test seam (in-process tests only): forget the pacing so a second code can be requested at once.
export function resetMailThrottleForTests(): void {
  sent.clear();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function layout(heading: string, intro: string, code: string, outro: string): { html: string; text: string } {
  return {
    text: `${heading}\n\n${intro}\n\n${code}\n\n${outro}\n\n-- Rockstyle Chess`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0B0709;color:#F2EEF0">
<h2 style="margin:0 0 12px">${esc(heading)}</h2><p>${esc(intro)}</p>
<p style="font-size:34px;letter-spacing:8px;font-weight:bold;color:#FF5A1F;margin:20px 0">${esc(code)}</p>
<p style="color:#A89AA2;font-size:13px">${esc(outro)}</p></div>`,
  };
}

export function verificationMail(to: string, otp: string): Mail {
  const body = layout(
    'Verify your email',
    'Enter this code in Rockstyle Chess to confirm your email address.',
    otp,
    "It expires in 10 minutes. If you didn't create an account, you can ignore this email.",
  );
  return { to, subject: `${otp} is your Rockstyle Chess code`, ...body };
}

export function passwordResetMail(to: string, otp: string): Mail {
  const body = layout(
    'Reset your password',
    'Enter this code in Rockstyle Chess to choose a new password.',
    otp,
    "It expires in 10 minutes. If you didn't ask for this, you can ignore this email; your password hasn't changed.",
  );
  return { to, subject: `${otp} is your Rockstyle Chess reset code`, ...body };
}
