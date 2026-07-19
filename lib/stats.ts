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
  status?: string;
  MessageUpdate?: Array<{ status?: string }>;
}

/** Estado de entrega real da mensagem no WhatsApp. */
export type Delivery = "delivered" | "pending" | "failed";

function deliveryOf(rec: EvoRecord): Delivery {
  const upd = rec.MessageUpdate ?? [];
  const last = (upd.length ? upd[upd.length - 1]?.status : rec.status) ?? "";
  const s = last.toUpperCase();
  if (s === "DELIVERY_ACK" || s === "READ" || s === "PLAYED") return "delivered";
  if (s === "ERROR") return "failed";
  return "pending"; // SERVER_ACK, PENDING ou sem confirmação
}

const DELIVERY_RANK: Record<Delivery, number> = { delivered: 2, pending: 1, failed: 0 };
function bestDelivery(a: Delivery, b: Delivery): Delivery {
  return DELIVERY_RANK[a] >= DELIVERY_RANK[b] ? a : b;
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
  delivery: Delivery; // entregue / pendente / falhada (estado real no WhatsApp)
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

    const delivery = deliveryOf(rec);
    const dedupKey = orderNumber ? `${orderNumber}:${hit.type}` : `anon:${anon++}`;
    const existing = byKey.get(dedupKey);
    if (existing) {
      // Mantém o registo mais completo (com telefone real), o ts mais antigo e o
      // melhor estado de entrega entre as cópias (@lid / @s.whatsapp.net).
      existing.phone = existing.phone ?? phone;
      existing.timestamp = Math.min(existing.timestamp, ts);
      existing.delivery = bestDelivery(existing.delivery, delivery);
    } else {
      byKey.set(dedupKey, { type: hit.type, orderNumber, phone, timestamp: ts, delivery });
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

/** Um lembrete, com o momento exato e o estado de entrega real no WhatsApp. */
export interface ReminderEvent {
  at: string; // ISO
  type: ReminderType;
  orderNumber: string | null;
  name: string | null;
  delivery: Delivery; // "delivered" | "pending" | "failed"
}

/** Uma encomenda recuperada, datada pelo momento do pagamento. */
export interface RecoveryEvent {
  at: string; // ISO — momento do pagamento
  orderNumber: string;
  name: string;
  phone: string | null;
  valueEur: number;
  remindersReceived: number;
}

/** Uma encomenda com lembrete ainda por pagar (estado atual, não temporal). */
export interface AwaitingOrder {
  orderNumber: string;
  name: string;
  phone: string | null;
  valueEur: number;
  remindersReceived: number;
  lastReminderAt: string;
}

export interface DashboardStats {
  generatedAt: string;
  automationStart: string;
  /** Todos os lembretes (1º/2º/3º/aviso) com data — para filtrar por período no cliente. */
  reminderEvents: ReminderEvent[];
  /** Todas as encomendas recuperadas, datadas pelo pagamento. */
  recoveryEvents: RecoveryEvent[];
  /** Encomendas com lembrete ainda por pagar (estado atual). */
  awaitingOrders: AwaitingOrder[];
}

/** map com limite de concorrência (para não rebentar limites da Shopify). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function computeStats(): Promise<DashboardStats> {
  const [records, orders] = await Promise.all([
    fetchSentMessages(),
    fetchOrdersSinceStart(),
  ]);
  const reminders = extractReminders(records);

  // Índice de encomendas por número visível + nomes
  const byNumber = new Map<string, StatsOrder>();
  const nameByNumber = new Map<string, string>();
  for (const o of orders) {
    const num = o.order_number != null ? String(o.order_number) : o.name?.replace(/^#/, "");
    if (!num) continue;
    byNumber.set(num, o);
    const n = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ");
    if (n) nameByNumber.set(num, n);
  }

  // Agrupar lembretes de cliente (r1/r2/r3) por encomenda — SÓ os ENTREGUES.
  // Um lembrete que falhou a entrega não conta como "recebido": a cliente não o
  // viu, por isso não entra nas recuperadas nem na taxa de recuperação.
  const perOrder = new Map<
    string,
    { count: number; phone: string | null; lastTs: number }
  >();
  for (const r of reminders) {
    if (r.type === "owner" || !r.orderNumber) continue;
    if (r.delivery !== "delivered") continue;
    const cur = perOrder.get(r.orderNumber) ?? { count: 0, phone: null, lastTs: 0 };
    cur.count++;
    cur.phone = cur.phone ?? r.phone;
    cur.lastTs = Math.max(cur.lastTs, r.timestamp);
    perOrder.set(r.orderNumber, cur);
  }

  // Classificar cada encomenda com lembrete: recuperada (paga) vs à espera.
  const recoveredNumbers: string[] = [];
  const awaiting: AwaitingOrder[] = [];
  for (const [orderNumber, info] of perOrder) {
    const order = byNumber.get(orderNumber);
    if (!order) continue;
    const value = parseFloat(order.total_price ?? "0") || 0;
    const name = nameByNumber.get(orderNumber) || "—";
    const shopifyPhone = (order.customer?.phone || order.shipping_address?.phone || "")
      .replace(/[^\d]/g, "") || null;
    const phone = info.phone ?? shopifyPhone;
    const paid =
      order.financial_status === "paid" || order.financial_status === "partially_paid";
    const cancelled = Boolean(order.cancelled_at) ||
      ["voided", "refunded"].includes(order.financial_status ?? "");

    if (paid) {
      recoveredNumbers.push(orderNumber);
    } else if (!cancelled) {
      awaiting.push({
        orderNumber, name, phone, valueEur: value,
        remindersReceived: info.count,
        lastReminderAt: new Date(info.lastTs * 1000).toISOString(),
      });
    }
  }

  // Momento do pagamento de cada recuperada (para datar corretamente por período).
  const recoveryEvents = await mapLimit(recoveredNumbers, 8, async (orderNumber) => {
    const order = byNumber.get(orderNumber)!;
    const info = perOrder.get(orderNumber)!;
    const paidAt = (await fetchPaidAt(order)) ?? new Date().toISOString();
    const shopifyPhone = (order.customer?.phone || order.shipping_address?.phone || "")
      .replace(/[^\d]/g, "") || null;
    return {
      at: paidAt,
      orderNumber,
      name: nameByNumber.get(orderNumber) || "—",
      phone: info.phone ?? shopifyPhone,
      valueEur: parseFloat(order.total_price ?? "0") || 0,
      remindersReceived: info.count,
    } satisfies RecoveryEvent;
  });

  const reminderEvents: ReminderEvent[] = reminders.map((r) => ({
    at: new Date(r.timestamp * 1000).toISOString(),
    type: r.type,
    orderNumber: r.orderNumber,
    name: r.orderNumber ? nameByNumber.get(r.orderNumber) ?? null : null,
    delivery: r.delivery,
  }));

  reminderEvents.sort((a, b) => b.at.localeCompare(a.at));
  recoveryEvents.sort((a, b) => b.at.localeCompare(a.at));
  awaiting.sort((a, b) => b.valueEur - a.valueEur);

  return {
    generatedAt: new Date().toISOString(),
    automationStart: AUTOMATION_START,
    reminderEvents,
    recoveryEvents,
    awaitingOrders: awaiting,
  };
}
