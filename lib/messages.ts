/**
 * Templates das mensagens de WhatsApp.
 *
 * O texto é exatamente o pedido pelo cliente. Os placeholders [Nome], [Número],
 * [Entidade], [Referência] e [Valor] são substituídos pelos dados da encomenda.
 */

export interface OrderMessageData {
  /** Primeiro nome (ou nome completo) do cliente. */
  nome: string;
  /** Número da encomenda tal como aparece na loja (ex: "1234"). */
  numero: string;
  /** Entidade Multibanco. */
  entidade: string;
  /** Referência Multibanco. */
  referencia: string;
  /** Valor já formatado (ex: "12,34 €"). */
  valor: string;
}

/** 1º Lembrete — enviado ~2h após a encomenda, se ainda pendente. */
export function reminder1(d: OrderMessageData): string {
  return `Olá ${d.nome}!
Somos a Sofia Tavira 💛. Verificamos que a sua encomenda #${d.numero} ainda tem o pagamento pendente.

Deixamos os dados abaixo para finalizar quando puder:

Entidade: ${d.entidade}
Referência: ${d.referencia}
Valor: ${d.valor}

Qualquer dúvida, estamos ao seu dispor!`;
}

/** 2º Lembrete — enviado ~2 dias após a encomenda, se ainda pendente. */
export function reminder2(d: OrderMessageData): string {
  return `Olá ${d.nome}!
A sua encomenda #${d.numero} continua com o pagamento pendente há já 2 dias e, sem o pagamento, não conseguimos garantir a reserva das suas peças.

Os dados são estes:

Entidade: ${d.entidade}
Referência: ${d.referencia}
Valor: ${d.valor}

Agradecemos que regularize o quanto antes para não perder a sua encomenda.`;
}

/** 3º e último Lembrete — enviado ~4 dias após a encomenda, se ainda pendente. */
export function reminder3(d: OrderMessageData): string {
  return `⚠️ ÚLTIMO AVISO – Encomenda #${d.numero}

Olá ${d.nome}, a sua encomenda está prestes a ser cancelada por falta de pagamento e as peças serão libertadas para outras clientes que as têm nas suas listas de desejos.

Se ainda pretende garantir as suas peças, este é o momento de agir:

Entidade:${d.entidade}
Referência: ${d.referencia}
Valor: ${d.valor}

Após hoje, a encomenda será automaticamente cancelada.`;
}

/**
 * Aviso interno enviado ao próprio número do dono ao 5º dia, se a encomenda
 * continuar por pagar.
 */
export function ownerAlert(args: {
  numero: string;
  nome: string;
  telefone: string;
}): string {
  return `❌ Encomenda não paga (5 dias)

Encomenda: #${args.numero}
Cliente: ${args.nome}
Telemóvel: ${args.telefone || "—"}

A encomenda não foi paga dentro do prazo.`;
}
