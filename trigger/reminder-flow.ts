import { task, wait, logger } from "@trigger.dev/sdk";
import {
  getOrder,
  isUnpaid,
  getMultibanco,
  getCustomerName,
  getCustomerPhone,
  getOrderNumber,
  type ShopifyOrder,
} from "../lib/shopify.js";
import { normalizePhone, sendText } from "../lib/evolution.js";
import {
  reminder1,
  reminder2,
  reminder3,
  ownerAlert,
  type OrderMessageData,
} from "../lib/messages.js";

// ── Offsets dos marcos (a partir da criação da encomenda) ────────────────────
// Para testar o fluxo ponta-a-ponta em minutos, pôr USE_TEST_OFFSETS=true no
// ambiente. Repor para false (ou remover) antes de produção.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TEST = process.env.USE_TEST_OFFSETS === "true";

const OFFSETS = TEST
  ? { r1: 2 * MINUTE, r2: 4 * MINUTE, r3: 6 * MINUTE, owner: 8 * MINUTE }
  : { r1: 2 * HOUR, r2: 2 * DAY, r3: 4 * DAY, owner: 5 * DAY };

interface Payload {
  /** ID numérico da encomenda Shopify. */
  orderId: number | string;
  /** created_at da encomenda (ISO). Base para todos os marcos temporais. */
  createdAt: string;
}

type ReminderKind = "reminder1" | "reminder2" | "reminder3";

const RENDERERS: Record<ReminderKind, (d: OrderMessageData) => string> = {
  reminder1,
  reminder2,
  reminder3,
};

/**
 * Fluxo de lembretes Multibanco para uma encomenda.
 *
 * Cada marco espera até uma data ABSOLUTA (created_at + offset) — os waits > 5s
 * são checkpointed pelo Trigger.dev e não consomem compute. Antes de cada envio
 * re-obtemos a encomenda da Shopify: se já foi paga/cancelada, o fluxo pára.
 */
export const mbReminderFlow = task({
  id: "mb-reminder-flow",
  // Uma execução pode falhar num envio; o retry cobre falhas transitórias de rede/API.
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: Payload) => {
    const t0 = new Date(payload.createdAt).getTime();
    if (Number.isNaN(t0)) {
      throw new Error(`createdAt inválido: ${payload.createdAt}`);
    }

    // Marco 1 — 1º lembrete
    await wait.until({ date: new Date(t0 + OFFSETS.r1) });
    const afterR1 = await sendReminderIfUnpaid(payload.orderId, "reminder1");
    if (afterR1.stop) return { stopped: "após marco 1", reason: afterR1.reason };

    // Marco 2 — 2º lembrete
    await wait.until({ date: new Date(t0 + OFFSETS.r2) });
    const afterR2 = await sendReminderIfUnpaid(payload.orderId, "reminder2");
    if (afterR2.stop) return { stopped: "após marco 2", reason: afterR2.reason };

    // Marco 3 — 3º e último lembrete
    await wait.until({ date: new Date(t0 + OFFSETS.r3) });
    const afterR3 = await sendReminderIfUnpaid(payload.orderId, "reminder3");
    if (afterR3.stop) return { stopped: "após marco 3", reason: afterR3.reason };

    // Marco 4 — aviso ao dono (5º dia)
    await wait.until({ date: new Date(t0 + OFFSETS.owner) });
    const order = await getOrder(payload.orderId);
    if (!isUnpaid(order)) {
      logger.info("Encomenda paga/cancelada antes do 5º dia — sem aviso ao dono.", {
        orderId: payload.orderId,
        financial_status: order.financial_status,
      });
      return { stopped: "antes do aviso ao dono", reason: "paga_ou_cancelada" };
    }
    // Só avisa o dono se for mesmo uma encomenda Multibanco.
    const mb = await getMultibanco(order);
    if (!mb) {
      logger.info("Não é Multibanco — sem aviso ao dono.", {
        orderId: payload.orderId,
      });
      return { stopped: "antes do aviso ao dono", reason: "nao_multibanco" };
    }

    await notifyOwner(order);
    return { done: true, ownerNotified: true };
  },
});

interface StepResult {
  stop: boolean;
  reason?: string;
}

/**
 * Re-obtém a encomenda e, se ainda estiver por pagar E for Multibanco, envia o
 * lembrete indicado.
 * - Se já não estiver por pagar (paga/cancelada) → stop=true (termina o fluxo).
 * - Se não for Multibanco (cartão, MB WAY, sem dados de referência) → stop=true.
 * - Se não houver telefone válido → regista no log e continua (stop=false), para
 *   que o aviso ao dono ao 5º dia ainda aconteça.
 */
async function sendReminderIfUnpaid(
  orderId: number | string,
  kind: ReminderKind,
): Promise<StepResult> {
  const order = await getOrder(orderId);

  if (!isUnpaid(order)) {
    logger.info(`Encomenda já não está pendente — ${kind} não enviado.`, {
      orderId,
      financial_status: order.financial_status,
      cancelled_at: order.cancelled_at,
    });
    return { stop: true, reason: "paga_ou_cancelada" };
  }

  const mb = await getMultibanco(order);
  if (!mb) {
    logger.info(`Não é Multibanco (ou sem dados de referência) — ${kind} ignorado.`, {
      orderId,
    });
    return { stop: true, reason: "nao_multibanco" };
  }

  const phone = normalizePhone(getCustomerPhone(order));
  if (!phone) {
    logger.warn(`Sem telefone válido — ${kind} ignorado (fluxo continua).`, {
      orderId,
    });
    return { stop: false, reason: "sem_telefone" };
  }

  const data: OrderMessageData = {
    nome: getCustomerName(order),
    numero: getOrderNumber(order),
    entidade: mb.entidade,
    referencia: mb.referencia,
    valor: mb.valor,
  };

  const text = RENDERERS[kind](data);
  await sendText(phone, text);
  logger.info(`${kind} enviado.`, { orderId, phone });

  return { stop: false };
}

/** Envia o aviso interno ao número do dono. */
async function notifyOwner(order: ShopifyOrder): Promise<void> {
  const owner = process.env.OWNER_WHATSAPP_NUMBER;
  if (!owner) {
    logger.error("OWNER_WHATSAPP_NUMBER não definido — aviso ao dono não enviado.");
    return;
  }
  const ownerNumber = normalizePhone(owner);
  if (!ownerNumber) {
    logger.error("OWNER_WHATSAPP_NUMBER inválido.", { owner });
    return;
  }

  const rawPhone = getCustomerPhone(order);
  const text = ownerAlert({
    numero: getOrderNumber(order),
    nome: getCustomerName(order),
    telefone: normalizePhone(rawPhone) ?? rawPhone ?? "",
  });
  await sendText(ownerNumber, text);
  logger.info("Aviso ao dono enviado.", { orderId: order.id });
}
