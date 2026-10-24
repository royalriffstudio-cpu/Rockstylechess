import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Request, Response } from 'express';
import type { Socket } from 'socket.io';

import { auth } from './betterAuth.js';
import { needsEmailVerification } from './db/emailGate.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Rejects the request outright -- for endpoints that require a real
// signed-in account (currently just PATCH /me/profile and friends).
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.userId = session.user.id;
  next();
}

// After requireAuth, on the online/social REST actions: an account that has not verified its email yet gets a 403 the
// app turns into its "verify your email" prompt (soft gate, see db/emailGate.ts; always passes with EMAIL_GATE off).
export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction) {
  if (await needsEmailVerification(req.userId as string)) {
    res.status(403).json({ error: 'email-not-verified' });
    return;
  }
  next();
}

// Socket.IO connection middleware -- unlike requireAuth, a missing/invalid
// token doesn't reject the connection: anonymous/guest play (src/lib/
// playerId.ts's guest UUID) keeps working exactly as before. It just means
// socket.data.userId stays unset, and match persistence (persistMatchResult.ts)
// never fires for that seat -- a client-supplied "I'm logged in" claim would
// be forgeable, a server-verified session isn't.
export async function socketAuth(socket: Socket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token as string | undefined;
  if (token) {
    try {
      const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) });
      if (session) socket.data.userId = session.user.id;
    } catch {
      // Stay anonymous rather than reject the connection.
    }
  }
  next();
}
