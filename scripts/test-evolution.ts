/**
 * Teste pontual do envio via EvolutionAPI.
 * Correr com:  TEST_TO=351912345678 npm run test:evolution
 *
 * Requer no ambiente: EVOLUTION_BASE_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY.
 */
import { normalizePhone, sendText } from "../lib/evolution.js";

const raw = process.env.TEST_TO;
if (!raw) {
  console.error("Define TEST_TO com o número de destino. Ex: TEST_TO=351912345678");
  process.exit(1);
}

const number = normalizePhone(raw);
if (!number) {
  console.error(`Número inválido: ${raw}`);
  process.exit(1);
}

const result = await sendText(
  number,
  "✅ Teste da automação de lembretes Multibanco. Se recebeste isto, a EvolutionAPI está bem configurada.",
);
console.log("Enviado:", result);
