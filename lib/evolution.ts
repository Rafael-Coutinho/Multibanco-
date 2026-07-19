/**
 * Cliente mínimo da EvolutionAPI para enviar mensagens de texto no WhatsApp.
 */

const DEFAULT_COUNTRY_CODE = "351"; // Portugal

/**
 * Normaliza um número para o formato que a EvolutionAPI espera: só dígitos, com
 * indicativo de país (ex: "351912345678"). Devolve `null` se não for plausível.
 *
 * - Remove espaços, "+", parênteses, hífens, etc.
 * - Converte prefixo "00" internacional em dígitos.
 * - Se ficar com 9 dígitos (número nacional PT), antepõe o indicativo 351.
 */
export function normalizePhone(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string | null {
  if (!raw) return null;

  let digits = raw.trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else digits = digits.replace(/\D/g, "");

  digits = digits.replace(/\D/g, "");
  if (!digits) return null;

  // Número nacional PT (9 dígitos, começa por 9/2/3) → antepõe indicativo.
  if (digits.length === 9) {
    digits = `${countryCode}${digits}`;
  }

  // Validação básica de comprimento (indicativo + número).
  if (digits.length < 11 || digits.length > 15) return null;

  return digits;
}

export interface SendResult {
  ok: boolean;
  status: number;
  body: string;
}

function config() {
  const baseUrl = process.env.EVOLUTION_BASE_URL;
  const instance = process.env.EVOLUTION_INSTANCE;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!baseUrl || !instance || !apiKey) {
    throw new Error(
      "Faltam EVOLUTION_BASE_URL, EVOLUTION_INSTANCE e/ou EVOLUTION_API_KEY.",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), instance, apiKey };
}

/**
 * Verifica no histórico do WhatsApp se já foi enviada, para este número, uma
 * mensagem que contém `#<orderNumber>` E a `marker` (frase distintiva do
 * lembrete). Serve para NUNCA duplicar um lembrete já enviado.
 *
 * Em caso de erro/dúvida devolve `false` (não bloqueia o envio) — a garantia
 * anti-duplicado é "best effort": se não conseguirmos confirmar, preferimos
 * enviar a arriscar não avisar a cliente.
 */
export async function reminderAlreadySent(
  number: string,
  orderNumber: string,
  marker: string,
): Promise<boolean> {
  try {
    const { baseUrl, instance, apiKey } = config();
    const res = await fetch(`${baseUrl}/chat/findMessages/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        where: { key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: true } },
      }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as {
      messages?: { records?: Array<{ message?: Record<string, unknown> }> };
    };
    const records = json.messages?.records ?? [];
    const needle = `#${orderNumber}`;
    return records.some((r) => {
      const m = (r.message ?? {}) as {
        conversation?: string;
        extendedTextMessage?: { text?: string };
      };
      const t = m.conversation ?? m.extendedTextMessage?.text ?? "";
      return t.includes(needle) && t.includes(marker);
    });
  } catch {
    return false;
  }
}

/**
 * Envia uma mensagem de texto. `number` deve já estar normalizado (só dígitos
 * com indicativo). Lança erro se a EvolutionAPI responder com estado != 2xx.
 */
export async function sendText(
  number: string,
  text: string,
): Promise<SendResult> {
  const { baseUrl, instance, apiKey } = config();
  const url = `${baseUrl}/message/sendText/${instance}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({ number, text }),
  });

  const body = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `EvolutionAPI sendText falhou para ${number}: ${res.status} ${body}`,
    );
  }
  return { ok: true, status: res.status, body };
}
