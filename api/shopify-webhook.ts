import crypto from "node:crypto";
import { tasks } from "@trigger.dev/sdk";
import type { mbReminderFlow } from "../trigger/reminder-flow.js";

/**
 * Endpoint webhook da Shopify (orders/create), alojado como função serverless na Vercel.
 *
 * Fluxo:
 *  1. Lê o body RAW e valida o HMAC (X-Shopify-Hmac-Sha256) → 401 se inválido.
 *  2. Filtra por encomendas PENDENTES (financial_status === "pending").
 *  3. Dispara a tarefa mb-reminder-flow no Trigger.dev com idempotencyKey por encomenda.
 *  4. Responde 200 rápido (a Shopify exige resposta em < 5s).
 *
 * Nota: a confirmação de que é mesmo Multibanco (vs cartão/MB WAY) é feita DENTRO
 * da tarefa, que consulta as transactions da encomenda. Não dá para distinguir aqui
 * porque cartão e Multibanco partilham a gateway "shopify_payments", e o payload do
 * webhook orders/create não traz os detalhes da transação de forma fiável.
 *
 * IMPORTANTE: o bodyParser é desligado para conseguirmos o corpo cru exato que a
 * Shopify assinou. Sem isto o HMAC nunca bate certo.
 */
export const config = {
  api: {
    bodyParser: false,
  },
};

// Tipos leves para não depender de @vercel/node (mas é compatível com ele).
interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: string, cb: (chunk?: unknown) => void): void;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  send(body: string): void;
}

function readRawBody(req: Req): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk as Buffer)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (err) => reject(err));
  });
}

function header(req: Req, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/** Verificação HMAC-SHA256 (base64) com comparação em tempo constante. */
function verifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).json({ error: "SHOPIFY_WEBHOOK_SECRET não configurado" });
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch {
    res.status(400).json({ error: "Falha a ler o corpo" });
    return;
  }

  // 1. Validação HMAC.
  if (!verifyHmac(rawBody, header(req, "x-shopify-hmac-sha256"), secret)) {
    res.status(401).json({ error: "HMAC inválido" });
    return;
  }

  let order: {
    id?: number;
    financial_status?: string | null;
    created_at?: string;
  };
  try {
    order = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "JSON inválido" });
    return;
  }

  // 2. Filtro: só encomendas pendentes. (A confirmação de Multibanco é feita na tarefa.)
  if (!order.id) {
    res.status(200).json({ ignored: true, reason: "sem id" });
    return;
  }
  if (order.financial_status !== "pending") {
    res.status(200).json({ ignored: true, reason: "não pendente" });
    return;
  }

  // 3. Dispara a tarefa (idempotente por encomenda).
  try {
    await tasks.trigger<typeof mbReminderFlow>(
      "mb-reminder-flow",
      {
        orderId: order.id,
        createdAt: order.created_at ?? new Date().toISOString(),
      },
      { idempotencyKey: `mb-order-${order.id}` },
    );
  } catch (err) {
    // Falha a disparar: 500 para a Shopify voltar a tentar mais tarde.
    res.status(500).json({ error: "Falha a disparar a tarefa", detail: String(err) });
    return;
  }

  // 4. OK.
  res.status(200).json({ scheduled: true, orderId: order.id });
}
