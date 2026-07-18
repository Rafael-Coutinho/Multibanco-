/**
 * Cliente mínimo da Shopify Admin API + helpers de estado e leitura Multibanco.
 *
 * Nota importante sobre Multibanco (confirmado com encomendas reais da loja):
 * o Multibanco entra pela Shopify Payments (Stripe). Tanto cartão como Multibanco
 * têm gateway = "shopify_payments", por isso NÃO se distingue pela gateway. Os dados
 * (Entidade/Referência/Valor) vivem nas TRANSACTIONS da encomenda, em
 * transaction.payment_details (e também em transaction.receipt.next_action).
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2024-10";

function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) {
    throw new Error(
      "Faltam SHOPIFY_STORE_DOMAIN e/ou SHOPIFY_ADMIN_TOKEN nas variáveis de ambiente.",
    );
  }
  return { domain, token };
}

// ── Tipos parciais (só os campos que usamos) ─────────────────────────────────

export interface ShopifyAddress {
  phone?: string | null;
}

export interface ShopifyCustomer {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface ShopifyOrder {
  id: number;
  order_number?: number;
  name?: string; // ex: "#1234"
  financial_status?: string | null;
  cancelled_at?: string | null;
  created_at?: string;
  currency?: string;
  total_price?: string;
  customer?: ShopifyCustomer | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
}

interface MultibancoBuyerInfo {
  Entity?: string;
  Reference?: string;
}

interface MultibancoDisplayDetails {
  entity?: string;
  reference?: string;
}

export interface ShopifyTransaction {
  kind?: string;
  status?: string;
  amount?: string;
  currency?: string;
  payment_details?: {
    payment_method_name?: string;
    buyer_action_info?: { multibanco?: MultibancoBuyerInfo };
  } | null;
  receipt?: {
    next_action?: { multibanco_display_details?: MultibancoDisplayDetails };
  } | null;
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/** Obtém uma encomenda por ID a partir da Admin API. */
export async function getOrder(orderId: number | string): Promise<ShopifyOrder> {
  const { domain, token } = config();
  const url = `https://${domain}/admin/api/${API_VERSION}/orders/${orderId}.json`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify getOrder ${orderId} falhou: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { order: ShopifyOrder };
  return json.order;
}

/** Obtém as transações de uma encomenda. */
export async function getTransactions(
  orderId: number | string,
): Promise<ShopifyTransaction[]> {
  const { domain, token } = config();
  const url = `https://${domain}/admin/api/${API_VERSION}/orders/${orderId}/transactions.json`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify getTransactions ${orderId} falhou: ${res.status} ${body}`,
    );
  }
  const json = (await res.json()) as { transactions: ShopifyTransaction[] };
  return json.transactions ?? [];
}

// ── Estado ─────────────────────────────────────────────────────────────────

/** True se a encomenda ainda está por pagar e não foi cancelada. */
export function isUnpaid(order: ShopifyOrder): boolean {
  if (order.cancelled_at) return false;
  return order.financial_status === "pending";
}

// ── Dados do cliente ─────────────────────────────────────────────────────────

/** Primeiro nome do cliente (fallback para o nome completo, ou "Cliente"). */
export function getCustomerName(order: ShopifyOrder): string {
  const first = order.customer?.first_name?.trim();
  if (first) return first;
  const last = order.customer?.last_name?.trim();
  if (last) return last;
  return "Cliente";
}

/** Número visível da encomenda como string (sem "#"). */
export function getOrderNumber(order: ShopifyOrder): string {
  if (order.order_number != null) return String(order.order_number);
  if (order.name) return order.name.replace(/^#/, "");
  return String(order.id);
}

/** Telefone do cliente: customer → shipping → billing. */
export function getCustomerPhone(order: ShopifyOrder): string | null {
  return (
    order.customer?.phone ||
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    null
  );
}

// ── Multibanco ────────────────────────────────────────────────────────────────

export interface MultibancoData {
  entidade: string;
  referencia: string;
  valor: string;
}

/** Formata um valor monetário para o formato PT (ex: "39,95 €"). */
export function formatEuro(amount: string | number, currency = "EUR"): string {
  const n = typeof amount === "number" ? amount : parseFloat(amount);
  if (Number.isNaN(n)) return String(amount);
  const symbol = currency === "EUR" ? "€" : currency;
  return `${n.toFixed(2).replace(".", ",")} ${symbol}`;
}

/** Formata a referência MB de 9 dígitos em grupos de 3 (ex: "770 738 484"). */
export function formatReference(ref: string): string {
  const digits = ref.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return ref.trim();
}

/** Encontra a transação Multibanco de uma lista de transações. */
function findMultibancoTransaction(
  txs: ShopifyTransaction[],
): ShopifyTransaction | null {
  return (
    txs.find((t) => {
      const method = t.payment_details?.payment_method_name?.toLowerCase();
      if (method === "multibanco") return true;
      if (t.payment_details?.buyer_action_info?.multibanco) return true;
      if (t.receipt?.next_action?.multibanco_display_details) return true;
      return false;
    }) ?? null
  );
}

/**
 * Lê a Entidade / Referência / Valor do Multibanco a partir das transações da
 * encomenda. Devolve `null` se a encomenda NÃO for Multibanco (ex: cartão, MB WAY)
 * ou se ainda não houver dados de referência — em ambos os casos o fluxo deve parar.
 */
export async function getMultibanco(
  order: ShopifyOrder,
): Promise<MultibancoData | null> {
  const txs = await getTransactions(order.id);
  const tx = findMultibancoTransaction(txs);
  if (!tx) return null;

  const buyer = tx.payment_details?.buyer_action_info?.multibanco;
  const display = tx.receipt?.next_action?.multibanco_display_details;

  const entidade = buyer?.Entity ?? display?.entity ?? null;
  const referenciaRaw = buyer?.Reference ?? display?.reference ?? null;
  if (!entidade || !referenciaRaw) return null;

  const amount = tx.amount ?? order.total_price ?? "0";

  return {
    entidade: entidade.trim(),
    referencia: formatReference(referenciaRaw),
    valor: formatEuro(amount, tx.currency ?? order.currency),
  };
}

/** True se a encomenda for paga por Multibanco. */
export async function isMultibanco(order: ShopifyOrder): Promise<boolean> {
  const txs = await getTransactions(order.id);
  return findMultibancoTransaction(txs) !== null;
}
