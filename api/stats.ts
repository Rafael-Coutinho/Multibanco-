import { computeStats, type DashboardStats } from "../lib/stats.js";

/**
 * Endpoint JSON do dashboard: /api/stats?key=DASHBOARD_SECRET
 * Cache em memória de 30s para não martelar a Shopify/Evolution a cada refresh.
 */

interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

let cache: { at: number; data: DashboardStats } | null = null;
const CACHE_MS = 30_000;

export default async function handler(req: Req, res: Res): Promise<void> {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    res.status(500).json({ error: "DASHBOARD_SECRET não configurado" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  if (url.searchParams.get("key") !== secret) {
    res.status(401).json({ error: "Não autorizado" });
    return;
  }

  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      cache = { at: Date.now(), data: await computeStats() };
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(cache.data);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
}
