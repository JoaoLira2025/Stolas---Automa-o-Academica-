import Redis from "ioredis";

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 5;

let redis: any = null;
let redisReady = false;
if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL);
    redis.on("ready", () => {
      redisReady = true;
    });
    redis.on("error", () => {
      redisReady = false;
    });
  } catch (e) {
    redis = null;
    redisReady = false;
  }
}

type MemEntry = { count: number; expiresAt: number };
const memoryStore = new Map<string, MemEntry>();

function now() {
  return Date.now();
}

export async function isRateLimited(key: string) {
  if (redis && redisReady) {
    try {
      const val = await redis.get(key);
      if (!val) return false;
      const n = parseInt(val, 10) || 0;
      return n >= RATE_LIMIT_MAX_ATTEMPTS;
    } catch {
      // fallback to memory
    }
  }

  const e = memoryStore.get(key);
  if (!e || e.expiresAt < now()) return false;
  return e.count >= RATE_LIMIT_MAX_ATTEMPTS;
}

export async function incrementRateLimit(key: string) {
  if (redis && redisReady) {
    try {
      const n = await redis.incr(key);
      if (n === 1) {
        await redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
      }
      return n;
    } catch {
      // fallback
    }
  }

  const e = memoryStore.get(key);
  const nowTs = now();
  if (!e || e.expiresAt < nowTs) {
    memoryStore.set(key, { count: 1, expiresAt: nowTs + RATE_LIMIT_WINDOW_MS });
    return 1;
  }
  e.count += 1;
  memoryStore.set(key, e);
  return e.count;
}

export async function resetRateLimit(key: string) {
  if (redis && redisReady) {
    try {
      await redis.del(key);
      return;
    } catch {
      // fallback
    }
  }
  memoryStore.delete(key);
}

export { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_ATTEMPTS };
