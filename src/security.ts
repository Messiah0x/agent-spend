// HTTP hardening shared by every route: security headers with a per-request
// CSP nonce, same-origin checks for browser form posts (CSRF), request body
// limits, and a small in-memory rate limiter for write routes.

import { randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";
import { bodyLimit } from "hono/body-limit";

declare module "hono" {
  interface ContextVariableMap {
    /** Per-request CSP nonce; every inline <style>/<script> must carry it. */
    nonce: string;
  }
}

/**
 * Strict CSP: no third-party origins, no inline code except what carries this
 * request's nonce, no framing, forms may only post back to us. Same-origin
 * stylesheets are allowed so the app can serve its responsive presentation
 * layer without weakening the inline-style nonce requirement.
 */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    const nonce = randomBytes(16).toString("base64");
    c.set("nonce", nonce);
    await next();
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `style-src 'self' 'nonce-${nonce}'`,
        `script-src 'nonce-${nonce}'`,
        "img-src 'self' data:",
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ].join("; "),
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https") {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  };
}

/**
 * CSRF protection for browser form posts. Basic Auth credentials are sent by
 * the browser automatically, so without this any site could make a logged-in
 * operator's browser rename (or, later, revoke) agents.
 *
 * A request passes when the browser says it is same-origin (Sec-Fetch-Site),
 * or its Origin's host matches the host it was sent to. Host comparison
 * (rather than full origin) keeps this working behind TLS-terminating proxies
 * like Railway, where the app itself sees plain http.
 */
export function csrfProtection(publicUrl?: string): MiddlewareHandler {
  return csrf({
    origin: (origin, c) => {
      try {
        const o = new URL(origin);
        if (publicUrl && o.origin === new URL(publicUrl).origin) return true;
        const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
        return o.host === host;
      } catch {
        return false;
      }
    },
  });
}

export function limitBody(maxBytes = 16 * 1024): MiddlewareHandler {
  return bodyLimit({
    maxSize: maxBytes,
    onError: (c) => c.text("Request body too large", 413),
  });
}

/** Client IP; X-Forwarded-For is trusted only when explicitly configured. */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "local";
}

/**
 * Fixed-window rate limiter keyed by client IP. In-memory by design: this is
 * a single-process deployment; it bounds brute force on Basic Auth and spam on
 * the agent API, it is not a distributed quota system.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  trustProxy: boolean;
  /** Only count requests this returns true for (default: all). */
  when?: (c: Context) => boolean;
}): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c, next) => {
    if (opts.when && !opts.when(c)) return next();
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const ip = clientIp(c, opts.trustProxy);
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > opts.max) {
      c.header("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.text("Too many requests", 429);
    }
    return next();
  };
}
