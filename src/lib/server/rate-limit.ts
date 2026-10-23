import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

const RATE_LIMITS = {
  posts: { limit: 5, windowMs: 60 * 60 * 1000 },
  comments: { limit: 30, windowMs: 60 * 60 * 1000 },
  messages: { limit: 30, windowMs: 60 * 1000 },
} as const;

type RateLimitAction = keyof typeof RATE_LIMITS;
type RateLimitEntry = { count: number; expiresAt: number };

const entries = new Map<string, RateLimitEntry>();
const MAX_ENTRIES = 10_000;
const ipHashKey = randomBytes(32);

function getClientKey(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor?.split(",").at(-1)?.trim();
  const ip = realIp || forwardedIp || "unknown";
  return createHmac("sha256", ipHashKey).update(ip).digest("hex");
}

export function enforceRateLimit(request: Request, action: RateLimitAction) {
  const now = Date.now();

  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }

  const policy = RATE_LIMITS[action];
  const key = `${action}:${getClientKey(request)}`;
  const entry = entries.get(key);

  if (entry && entry.expiresAt > now && entry.count >= policy.limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
    return NextResponse.json(
      { error: `Too many ${action} requests. Please try again in ${retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  if (!entry || entry.expiresAt <= now) {
    if (entries.size >= MAX_ENTRIES) {
      return NextResponse.json(
        { error: "The server is busy. Please try again shortly." },
        { status: 503, headers: { "Retry-After": "60" } },
      );
    }
    entries.set(key, { count: 1, expiresAt: now + policy.windowMs });
  } else {
    entry.count += 1;
  }

  return null;
}
