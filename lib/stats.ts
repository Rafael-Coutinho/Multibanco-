/**
 * Estatísticas do dashboard.
 *
 * Método (definido com o utilizador):
 *  1. Ler o histórico de mensagens ENVIADAS pela instância EvolutionAPI.
 *  2. Identificar os lembretes (pelos textos) e extrair o nº da encomenda (#XXXX)
 *     e o telemóvel de destino.
 *  3. Associar à encomenda na Shopify e verificar se foi efetivamente paga.
 *  4. Encomendas pagas APÓS terem recebido lembrete = recuperadas; somar o valor.
 *
 * Nota de atribuição: os lembretes só são enviados a encomendas por pagar no
 * momento do envio, portanto qualquer encomenda paga que recebeu lembrete foi
 * paga depois do lembrete — a atribuição é direta.
 */

// Início da automação — mensagens/encomendas anteriores a isto não contam.
const AUTOMATION_START = "2026-07-18T16:00:00Z";

// ── EvolutionAPI ─────────────────────────────────────────────────────────────

interface EvoRecord {
  id: string;
  key?: { id?: string; fromMe?: boolean; remoteJid?: string };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
  };
  messageTimestamp?: number;
}

function evoConfig() {
  const baseUrl = process.env.EVOLUTION_BASE_URL;
  const instance = process.env.EVOLUTION_INSTANCE;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !instance || !apiKey) {
    throw new Error("Faltam variáveis EVOLUTION_* no ambiente.");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), instance, apiKey };
}

async function fetchSentMessages(): Promise<EvoRecord[]> {
  const { baseUrl, instance, apiKey } = evoConfig();
  const records: EvoRecord[] = [];
  let page = 1;
  let pages = 1;
  do {
    const res = await fetch(`${baseUrl}/chat/findMessages/${instance}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { fromMe: true } }, page }),
    });
    if (!res.ok) {
      throw new Error(`EvolutionAPI findMessages falhou: ${res.status}`);
    }
    const json = (await res.json()) as {
      messages: { pages: number; records: EvoRecord[] };
    };
    pages = json.messages.pages ?? 1;
    records.push(...(json.messages.records ?? []));
    page++;
  } while (page <= pages);
  return records;
}

// ── Identificação dos lembretes ──────────────────────────────────────────────

export type ReminderType = "r1" | "r2" | "r3" | "owner";

const MARKERS: Array<{ type: ReminderType; marker: string }> = [
  { type: "r1", marker: "Somos a Sofia Tavira" },
  { type: "r2", marker: "pendente há já 2 dias" },
  { type: "r3", marker: "ÚLTIMO AVISO" },
  { type: "owner", marker: "Encomenda não paga" },
];

export interface SentReminder {
  type: ReminderType;
  orderNumber: string | null;
  phone: string | null; // dígitos, do remoteJid
  timestamp: number; // epoch segundos
}

function textOf(rec: EvoRecord): string {
  return (
    rec.message?.conversation ??
    rec.message?.extendedTextMessage?.text ??
    ""
  );
}

/**
 * Extrai os lembretes do histórico, DEDUPLICADOS.
 *
 * A EvolutionAPI guarda a mesma mensagem em duplicado: uma vez com o JID novo
 * do WhatsApp (…@lid) e outra com o número real (…@s.whatsapp.net) — mesmo
 * waKeyId. Deduplicamos por (encomenda + tipo de lembrete), que por desenho só
 * ocorre uma vez, e preferimos o registo com o número real de telefone.
 */
export function extractReminders(records: EvoRecord[]): SentReminder[] {
  const startTs = Date.parse(AUTOMATION_START) / 1000;
  const byKey = new Map<string, SentReminder>();
  let anon = 0;
  for (const rec of records) {
    if (!rec.key?.fromMe) continue;
    const ts = rec.messageTimestamp ?? 0;
    if (ts < startTs) continue;
    const text = textOf(rec);
    const hit = MARKERS.find((m) => text.includes(m.marker));
    if (!hit) continue;
    const orderMatch = text.match(/#\s?(\d+)/);
    const orderNumber = orderMatch ? orderMatch[1] : null;
    const jid = rec.key?.remoteJid ?? "";
    // Número real só vem no JID @s.whatsapp.net; @lid é um ID interno.
    const phoneMatch = jid.match(/^(\d+)@s\.whatsapp\.net$/);
    const phone = phoneMatch ? phoneMatch[1] : null;

    const dedupKey = orderNumber ? `${orderNumber}:${hit.type}` : `anon:${anon++}`;
    const existing = byKey.get(dedupKey);
    if (existing) {
      // Mantém o registo mais completo (com telefone real) e o ts mais antigo.
      existing.phone = existing.phone ?? phone;
      existing.timestamp = Math.min(existing.timestamp, ts);
    } else {
      byKey.set(dedupKey, { type: hit.type, orderNumber, phone, timestamp: ts });
    }
  }
  return [...byKey.values()];
}

// ── Shopify ──────────────────────────────────────────────────────────────────

interface StatsOrder {
  id: number;
  order_number?: number;
  name?: string;
  financial_status?: string | null;
  cancelled_at?: string | null;
  total_price?: string;
  currency?: string;
  created_at?: string;
  updated_at?: string;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } | null;
  shipping_address?: { phone?: string | null } | null;
}

/**
 * Data (aproximada) de pagamento de uma encomenda.
 *
 * Nota Multibanco: a transação "sale" muda para success MANTENDO o processed_at
 * da criação — não serve como hora do pagamento. Confirmado com encomendas
 * reais. Heurística: se houver uma transação de sucesso claramente posterior à
 * criação (>10 min), usa-se essa; caso contrário usa-se o updated_at da
 * encomenda, que na prática coincide com a passagem a "paga".
 */
async function fetchPaidAt(order: StatsOrder): Promise<string | null> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION ?? "2024-10";
  const createdMs = Date.parse(order.created_at ?? "") || 0;
  try {
    const res = await fetch(
      `https://${domain}/admin/api/${version}/orders/${order.id}/transactions.json`,
      { headers: { "X-Shopify-Access-Token": token! } },
    );
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as {
      transactions?: Array<{ status?: string; kind?: string; processed_at?: string }>;
    };
    const paid = (json.transactions ?? [])
      .filter((t) => t.status === "success" && ["sale", "capture"].includes(t.kind ?? ""))
      .map((t) => t.processed_at)
      .filter((p): p is string => Boolean(p))
      .sort();
    const latest = paid[paid.length - 1];
    if (latest && Date.parse(latest) > createdMs + 10 * 60_000) return latest;
  } catch {
    /* fallback abaixo */
  }
  return order.updated_at ?? null;
}

async function fetchOrdersSinceStart(): Promise<StatsOrder[]> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION ?? "2024-10";
  if (!domain || !token) throw new Error("Faltam variáveis SHOPIFY_* no ambiente.");

  const orders: StatsOrder[] = [];
  let url: string | null =
    `https://${domain}/admin/api/${version}/orders.json?status=any&limit=250` +
    `&created_at_min=${encodeURIComponent(AUTOMATION_START)}` +
    `&fields=id,order_number,name,financial_status,cancelled_at,total_price,currency,created_at,updated_at,customer,shipping_address`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) throw new Error(`Shopify orders falhou: ${res.status}`);
    const json = (await res.json()) as { orders: StatsOrder[] };
    orders.push(...(json.orders ?? []));
    // paginação via Link header
    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return orders;
}

// ── Cálculo final ────────────────────────────────────────────────────────────

export interface DailyPoint {
  /** YYYY-MM-DD (Europe/Lisbon) */
  date: string;
  r1: number;
  r2: number;
  r3: number;
  owner: number;
  recoveredCount: number;
  recoveredEur: number;
}

export interface TimelineEvent {
  at: string; // ISO
  kind: ReminderType | "paid";
  orderNumber: string | null;
  name: string | null;
  valueEur: number | null;
}

export interface DashboardStats {
  generatedAt: string;
  remindersSent: { r1: number; r2: number; r3: number; owner: number; total: number };
  ordersReminded: number;
  ordersRecovered: number;
  recoveredValueEur: number;
  pendingValueEur: number; // valor ainda por pagar das encomendas com lembrete
  recoveryRate: number; // 0..1 sobre encomendas com lembrete e desfecho conhecido
  recoveredOrders: Array<{
    orderNumber: string;
    name: string;
    phone: string | null;
    valueEur: number;
    remindersReceived: number;
    lastReminderAt: string;
  }>;
  awaitingOrders: Array<{
    orderNumber: string;
    name: string;
    phone: string | null;
    valueEur: number;
    remindersReceived: number;
  }>;
  /** Série diária para os gráficos (do 1º dia da automação até hoje). */
  daily: DailyPoint[];
  /** Últimos eventos (lembretes + pagamentos), mais recentes primeiro. */
  events: TimelineEvent[];
}

/** Dia (YYYY-MM-DD) em hora de Portugal para um instante. */
function lisbonDay(ms: number): string {
  return new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" });
}

export async function computeStats(): Promise<DashboardStats> {
  const [records, orders] = await Promise.all([
    fetchSentMessages(),
    fetchOrdersSinceStart(),
  ]);
  const reminders = extractReminders(records);

  // Índice de encomendas por número visível
  const byNumber = new Map<string, StatsOrder>();
  for (const o of orders) {
    const num = o.order_number != null ? String(o.order_number) : o.name?.replace(/^#/, "");
    if (num) byNumber.set(num, o);
  }

  // Agrupar lembretes (só r1/r2/r3, dirigidos a clientes) por encomenda
  const perOrder = new Map<
    string,
    { count: number; phone: string | null; lastTs: number }
  >();
  const counts = { r1: 0, r2: 0, r3: 0, owner: 0 };
  for (const r of reminders) {
    counts[r.type]++;
    if (r.type === "owner" || !r.orderNumber) continue;
    const cur = perOrder.get(r.orderNumber) ?? { count: 0, phone: null, lastTs: 0 };
    cur.count++;
    cur.phone = cur.phone ?? r.phone;
    cur.lastTs = Math.max(cur.lastTs, r.timestamp);
    perOrder.set(r.orderNumber, cur);
  }

  const recovered: DashboardStats["recoveredOrders"] = [];
  const awaiting: DashboardStats["awaitingOrders"] = [];
  let recoveredValue = 0;
  let pendingValue = 0;

  for (const [orderNumber, info] of perOrder) {
    const order = byNumber.get(orderNumber);
    if (!order) continue; // encomenda fora da janela — ignorar
    const value = parseFloat(order.total_price ?? "0") || 0;
    const name = [order.customer?.first_name, order.customer?.last_name]
      .filter(Boolean)
      .join(" ") || "—";
    // Fallback do telefone: se o WhatsApp só guardou o ID interno (@lid),
    // usa o telefone registado na Shopify.
    const shopifyPhone = (order.customer?.phone || order.shipping_address?.phone || "")
      .replace(/[^\d]/g, "") || null;
    const phone = info.phone ?? shopifyPhone;
    const paid =
      order.financial_status === "paid" ||
      order.financial_status === "partially_paid";
    const cancelled = Boolean(order.cancelled_at) ||
      ["voided", "refunded"].includes(order.financial_status ?? "");

    if (paid) {
      recovered.push({
        orderNumber,
        name,
        phone,
        valueEur: value,
        remindersReceived: info.count,
        lastReminderAt: new Date(info.lastTs * 1000).toISOString(),
      });
      recoveredValue += value;
    } else if (!cancelled) {
      awaiting.push({
        orderNumber,
        name,
        phone,
        valueEur: value,
        remindersReceived: info.count,
      });
      pendingValue += value;
    }
  }

  recovered.sort((a, b) => b.lastReminderAt.localeCompare(a.lastReminderAt));
  awaiting.sort((a, b) => b.valueEur - a.valueEur);

  const decided = recovered.length + awaiting.length;

  // ── Timelines ──────────────────────────────────────────────────────────────
  // Data de pagamento das recuperadas (até 30, em paralelo).
  const paidAtByNumber = new Map<string, string>();
  await Promise.all(
    recovered.slice(0, 30).map(async (r) => {
      const order = byNumber.get(r.orderNumber);
      if (!order) return;
      const paidAt = await fetchPaidAt(order);
      if (paidAt) paidAtByNumber.set(r.orderNumber, paidAt);
    }),
  );

  // Série diária contínua desde o arranque da automação até hoje (hora PT).
  const dayMap = new Map<string, DailyPoint>();
  const startMs = Date.parse(AUTOMATION_START);
  for (let ms = startMs; lisbonDay(ms) <= lisbonDay(Date.now()); ms += 86_400_000) {
    const d = lisbonDay(ms);
    dayMap.set(d, { date: d, r1: 0, r2: 0, r3: 0, owner: 0, recoveredCount: 0, recoveredEur: 0 });
  }
  for (const r of reminders) {
    const p = dayMap.get(lisbonDay(r.timestamp * 1000));
    if (p) p[r.type]++;
  }
  for (const r of recovered) {
    const paidAt = paidAtByNumber.get(r.orderNumber);
    const p = paidAt ? dayMap.get(lisbonDay(Date.parse(paidAt))) : undefined;
    if (p) {
      p.recoveredCount++;
      p.recoveredEur = Math.round((p.recoveredEur + r.valueEur) * 100) / 100;
    }
  }

  // Feed de eventos: lembretes + pagamentos, mais recentes primeiro.
  const nameByNumber = new Map<string, string>();
  for (const [num, o] of byNumber) {
    const n = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ");
    if (n) nameByNumber.set(num, n);
  }
  const events: TimelineEvent[] = [
    ...reminders.map((r) => ({
      at: new Date(r.timestamp * 1000).toISOString(),
      kind: r.type as TimelineEvent["kind"],
      orderNumber: r.orderNumber,
      name: r.orderNumber ? nameByNumber.get(r.orderNumber) ?? null : null,
      valueEur: null,
    })),
    ...recovered
      .filter((r) => paidAtByNumber.has(r.orderNumber))
      .map((r) => ({
        at: new Date(paidAtByNumber.get(r.orderNumber)!).toISOString(),
        kind: "paid" as const,
        orderNumber: r.orderNumber,
        name: r.name,
        valueEur: r.valueEur,
      })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25);

  return {
    generatedAt: new Date().toISOString(),
    remindersSent: {
      ...counts,
      total: counts.r1 + counts.r2 + counts.r3 + counts.owner,
    },
    ordersReminded: perOrder.size,
    ordersRecovered: recovered.length,
    recoveredValueEur: Math.round(recoveredValue * 100) / 100,
    pendingValueEur: Math.round(pendingValue * 100) / 100,
    recoveryRate: decided > 0 ? recovered.length / decided : 0,
    recoveredOrders: recovered,
    awaitingOrders: awaiting,
    daily: [...dayMap.values()],
    events,
  };
}
