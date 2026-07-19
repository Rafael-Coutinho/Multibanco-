import { task, wait, logger } from "@trigger.dev/sdk";
import {
  getOrder,
  isUnpaid,
  getMultibanco,
  getCustomerName,
  getCustomerPhone,
  getOrderNumber,
  type ShopifyOrder,
  type MultibancoData,
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
 * Resiliência (importante):
 * - A tarefa NÃO faz retry a nível de execução (maxAttempts: 1). Assim uma falha
 *   nunca reinicia o fluxo do início, o que evita reenviar lembretes já enviados
 *   (duplicados). Todas as operações que podem falhar (ler a Shopify, enviar o
 *   WhatsApp) têm o seu próprio retry INTERNO e nunca deixam a execução rebentar.
 * - Se um envio falhar mesmo após as re-tentativas (ex: WhatsApp desligado nesse
 *   momento), salta-se APENAS esse lembrete e o fluxo continua para os seguintes
 *   e para o aviso ao dono.
 *
 * Cada marco espera até uma data ABSOLUTA (created_at + offset) — os waits > 5s
 * são checkpointed pelo Trigger.dev e não consomem compute. Antes de cada envio
 * re-obtém-se a encomenda: se já foi paga/cancelada, o fluxo pára.
 */
export const mbReminderFlow = task({
  id: "mb-reminder-flow",
  // Sem retry a nível de execução — os erros são tratados internamente para
  // garantir que nada é reenviado (ver nota acima).
  retry: { maxAttempts: 1 },
  run: async (payload: Payload) => {
    const t0 = new Date(payload.createdAt).getTime();
    if (Number.isNaN(t0)) {
      logger.error(`createdAt inválido: ${payload.createdAt}`, { payload });
      return { stopped: "createdAt inválido" };
    }
    const orderId = payload.orderId;

    // Marco 1 — 1º lembrete
    await wait.until({ date: new Date(t0 + OFFSETS.r1) });
    if ((await processReminder(orderId, "reminder1")).stop) {
      return { stopped: "após marco 1" };
    }

    // Marco 2 — 2º lembrete
    await wait.until({ date: new Date(t0 + OFFSETS.r2) });
    if ((await processReminder(orderId, "reminder2")).stop) {
      return { stopped: "após marco 2" };
    }

    // Marco 3 — 3º e último lembrete
    await wait.until({ date: new Date(t0 + OFFSETS.r3) });
    if ((await processReminder(orderId, "reminder3")).stop) {
      return { stopped: "após marco 3" };
    }

    // Marco 4 — aviso ao dono (5º dia)
    await wait.until({ date: new Date(t0 + OFFSETS.owner) });
    const order = await safeGetOrder(orderId);
    if (!order) {
      logger.warn("Não obtive a encomenda no 5º dia — aviso ao dono ignorado.", {
        orderId,
      });
      return { stopped: "5º dia: encomenda indisponível" };
    }
    if (!isUnpaid(order)) {
      logger.info("Encomenda paga/cancelada antes do 5º dia — sem aviso ao dono.", {
        orderId,
        financial_status: order.financial_status,
      });
      return { stopped: "antes do aviso ao dono", reason: "paga_ou_cancelada" };
    }
    const mb = await safeGetMultibanco(order);
    if (mb.ok && mb.data === null) {
      logger.info("Não é Multibanco — sem aviso ao dono.", { orderId });
      return { stopped: "antes do aviso ao dono", reason: "nao_multibanco" };
    }
    // Mesmo que não tenhamos conseguido reconfirmar os dados MB (mb.ok === false),
    // a encomenda está pendente — avisamos o dono na mesma.

    await notifyOwner(order);
    return { done: true, ownerNotified: true };
  },
});

interface StepResult {
  stop: boolean;
}

/**
 * Trata um marco de lembrete. Nunca lança — devolve apenas se o fluxo deve parar.
 * - Encomenda paga/cancelada → stop=true.
 * - Não é Multibanco (confirmado) → stop=true.
 * - Erro a ler a Shopify → salta este marco (stop=false) e tenta no marco seguinte.
 * - Sem telefone válido → salta o envio ao cliente mas continua (aviso ao dono no fim).
 * - Envio falhado após re-tentativas → regista e continua (não pára a sequência).
 */
async function processReminder(
  orderId: number | string,
  kind: ReminderKind,
): Promise<StepResult> {
  const order = await safeGetOrder(orderId);
  if (!order) {
    logger.warn(`Não obtive a encomenda — ${kind} saltado (fluxo continua).`, {
      orderId,
    });
    return { stop: false };
  }

  if (!isUnpaid(order)) {
    logger.info(`Encomenda já não está pendente — ${kind} não enviado.`, {
      orderId,
      financial_status: order.financial_status,
      cancelled_at: order.cancelled_at,
    });
    return { stop: true };
  }

  const mb = await safeGetMultibanco(order);
  if (!mb.ok) {
    logger.warn(`Erro a ler transações — ${kind} saltado (fluxo continua).`, {
      orderId,
    });
    return { stop: false };
  }
  if (mb.data === null) {
    logger.info(`Não é Multibanco (ou sem dados de referência) — ${kind} ignorado.`, {
      orderId,
    });
    return { stop: true };
  }

  const phone = normalizePhone(getCustomerPhone(order));
  if (!phone) {
    logger.warn(`Sem telefone válido — ${kind} ignorado (fluxo continua).`, {
      orderId,
    });
    return { stop: false };
  }

  const data: OrderMessageData = {
    nome: getCustomerName(order),
    numero: getOrderNumber(order),
    entidade: mb.data.entidade,
    referencia: mb.data.referencia,
    valor: mb.data.valor,
  };

  await safeSend(phone, RENDERERS[kind](data), kind, orderId);
  return { stop: false };
}

/** Envia o aviso interno ao número do dono. Nunca lança. */
async function notifyOwner(order: ShopifyOrder): Promise<void> {
  const ownerNumber = normalizePhone(process.env.OWNER_WHATSAPP_NUMBER);
  if (!ownerNumber) {
    logger.error("OWNER_WHATSAPP_NUMBER em falta ou inválido — aviso não enviado.", {
      value: process.env.OWNER_WHATSAPP_NUMBER,
    });
    return;
  }

  const rawPhone = getCustomerPhone(order);
  const text = ownerAlert({
    numero: getOrderNumber(order),
    nome: getCustomerName(order),
    telefone: normalizePhone(rawPhone) ?? rawPhone ?? "",
  });
  await safeSend(ownerNumber, text, "aviso ao dono", order.id);
}

// ── Helpers resilientes (nunca lançam) ────────────────────────────────────────

/** Pausa curta (não-checkpointed) para re-tentativas rápidas de leitura. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Obtém a encomenda com 3 tentativas rápidas. Devolve null se falhar todas. */
async function safeGetOrder(
  orderId: number | string,
): Promise<ShopifyOrder | null> {
  for (let i = 1; i <= 3; i++) {
    try {
      return await getOrder(orderId);
    } catch (err) {
      logger.warn(`getOrder falhou (tentativa ${i}/3)`, { orderId, error: String(err) });
      if (i < 3) await sleep(2000);
    }
  }
  return null;
}

/**
 * Lê os dados MB. Distingue "erro a ler" de "genuinamente não é Multibanco":
 * - { ok: true, data: MultibancoData } → é Multibanco, com dados.
 * - { ok: true, data: null }           → confirmado que NÃO é Multibanco.
 * - { ok: false, data: null }          → erro a ler (não confirmámos nada).
 */
async function safeGetMultibanco(
  order: ShopifyOrder,
): Promise<{ ok: boolean; data: MultibancoData | null }> {
  for (let i = 1; i <= 3; i++) {
    try {
      return { ok: true, data: await getMultibanco(order) };
    } catch (err) {
      logger.warn(`getMultibanco falhou (tentativa ${i}/3)`, {
        orderId: order.id,
        error: String(err),
      });
      if (i < 3) await sleep(2000);
    }
  }
  return { ok: false, data: null };
}

/**
 * Envia uma mensagem com re-tentativas espaçadas. Nunca lança.
 * Tenta 3 vezes (esperando 30s e depois 120s entre tentativas — checkpointed),
 * o suficiente para absorver quedas momentâneas do WhatsApp. Se falhar todas,
 * regista e devolve false, mas o fluxo continua para o marco seguinte.
 */
async function safeSend(
  number: string,
  text: string,
  label: string,
  orderId: number | string,
): Promise<boolean> {
  const backoff = [30, 120]; // segundos entre tentativas
  for (let i = 1; i <= 3; i++) {
    try {
      await sendText(number, text);
      logger.info(`${label} enviado.`, { orderId, number, attempt: i });
      return true;
    } catch (err) {
      logger.warn(`Falha ao enviar ${label} (tentativa ${i}/3).`, {
        orderId,
        error: String(err),
      });
      if (i < 3) await wait.for({ seconds: backoff[i - 1] });
    }
  }
  logger.error(
    `${label} NÃO enviado após 3 tentativas — WhatsApp indisponível? (fluxo continua)`,
    { orderId, number },
  );
  return false;
}
