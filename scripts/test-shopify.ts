/**
 * Inspeciona uma encomenda real: mostra estado, se é Multibanco, telefone e os
 * dados MB (Entidade/Referência/Valor) lidos das transactions.
 *
 * Correr com:  TEST_ORDER_ID=1234567890 npm run test:shopify
 *
 * Requer no ambiente: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN.
 */
import {
  getOrder,
  isUnpaid,
  getMultibanco,
  getCustomerName,
  getCustomerPhone,
  getOrderNumber,
} from "../lib/shopify.js";
import { normalizePhone } from "../lib/evolution.js";

const id = process.env.TEST_ORDER_ID;
if (!id) {
  console.error("Define TEST_ORDER_ID com o ID de uma encomenda MB pendente.");
  process.exit(1);
}

const order = await getOrder(id);
const mb = await getMultibanco(order);

console.log("Encomenda:", getOrderNumber(order), "(id", order.id + ")");
console.log("Estado financeiro:", order.financial_status, "| cancelada:", order.cancelled_at);
console.log("Pendente?", isUnpaid(order));
console.log("É Multibanco?", mb !== null);
console.log("Cliente:", getCustomerName(order));
console.log("Telefone (raw):", getCustomerPhone(order), "→", normalizePhone(getCustomerPhone(order)));
console.log("Dados MB:", mb);
