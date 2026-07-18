/**
 * Teste rápido dos templates: imprime as 4 mensagens com dados de exemplo.
 * Correr com:  npm run test:messages
 */
import {
  reminder1,
  reminder2,
  reminder3,
  ownerAlert,
} from "../lib/messages.js";

const data = {
  nome: "Maria",
  numero: "1234",
  entidade: "11249",
  referencia: "123 456 789",
  valor: "42,90 €",
};

console.log("── 1º LEMBRETE (2h) ──\n");
console.log(reminder1(data));
console.log("\n── 2º LEMBRETE (2 dias) ──\n");
console.log(reminder2(data));
console.log("\n── 3º LEMBRETE (4 dias) ──\n");
console.log(reminder3(data));
console.log("\n── AVISO AO DONO (5 dias) ──\n");
console.log(
  ownerAlert({ numero: "1234", nome: "Maria", telefone: "351912345678" }),
);
