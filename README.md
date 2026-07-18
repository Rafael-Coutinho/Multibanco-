# Lembretes Multibanco por WhatsApp — Sofia Tavira

Automação que envia lembretes de WhatsApp para encomendas Shopify pagas por **Multibanco**
que ficam por pagar. Quando uma encomenda MB é criada e fica pendente:

| Momento | Ação |
|--------|------|
| **+2 horas** | 1º lembrete ao cliente |
| **+2 dias** | 2º lembrete ao cliente |
| **+4 dias** | 3º e último lembrete ao cliente |
| **+5 dias** | Se ainda por pagar, aviso ao número do dono (`+351 939 395 122`) |

Cada envio só acontece **se a encomenda ainda estiver por pagar** nesse momento. Assim que for
paga ou cancelada, o fluxo pára automaticamente.

## Como funciona (arquitetura)

```
Shopify (orders/create)
        │  webhook (HMAC)
        ▼
api/shopify-webhook.ts   ← função serverless na Vercel
        │  valida HMAC, filtra encomendas pendentes
        │  tasks.trigger("mb-reminder-flow", { orderId, createdAt })
        ▼
trigger/reminder-flow.ts ← Trigger.dev cloud
        │  confirma Multibanco (via transactions) — se não, pára
        │  wait.until(+2h) → verifica → envia 1º
        │  wait.until(+2d) → verifica → envia 2º
        │  wait.until(+4d) → verifica → envia 3º
        │  wait.until(+5d) → verifica → avisa o dono
        ▼
lib/evolution.ts → EvolutionAPI → WhatsApp
```

O fluxo **re-obtém a encomenda da Shopify** antes de cada envio (não confia no payload do
webhook), o que garante o estado de pagamento atualizado e resolve o caso de os dados MB só
aparecerem segundos após a criação da encomenda.

## Estrutura

- `trigger/reminder-flow.ts` — a tarefa com os 4 marcos temporais (o coração da automação).
- `lib/shopify.ts` — Admin API: obter encomenda, estado, parsing MB, telefone.
- `lib/evolution.ts` — enviar mensagens no WhatsApp + normalizar números.
- `lib/messages.ts` — os 3 templates de lembrete + o aviso ao dono.
- `api/shopify-webhook.ts` — endpoint Vercel que recebe o webhook e dispara a tarefa.
- `scripts/` — testes pontuais (mensagens, EvolutionAPI, parsing Shopify).

## Setup

### 1. Instalar
```bash
npm install
cp .env.example .env   # preencher os valores
```

### 2. (Opcional) Confirmar a leitura numa encomenda real
A deteção do Multibanco e a leitura de Entidade/Referência/Valor são automáticas: o Multibanco
entra pela Shopify Payments e os dados vêm das *transactions* da encomenda
(`payment_details.payment_method_name === "multibanco"`). Não é preciso configurar campos.

Para confirmar com uma encomenda MB pendente real:
```bash
TEST_ORDER_ID=<id_da_encomenda> npm run test:shopify
```
Deve mostrar `É Multibanco? true` e os `Dados MB` com Entidade/Referência/Valor.

### 3. Testar as mensagens e a EvolutionAPI
```bash
npm run test:messages                          # imprime as 4 mensagens
TEST_TO=3519xxxxxxxx npm run test:evolution     # envia um teste para o teu WhatsApp
```

### 4. Deploy da tarefa no Trigger.dev
```bash
npx trigger.dev@latest login
npx trigger.dev@latest deploy
```
No dashboard do Trigger.dev, em **Environment Variables**, definir:
`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_API_VERSION`,
`EVOLUTION_BASE_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY`, `OWNER_WHATSAPP_NUMBER`.
Copiar o **Project ref** (Settings) para `TRIGGER_PROJECT_REF` no `trigger.config.ts`/env.

### 5. Deploy do webhook na Vercel
```bash
vercel deploy --prod
```
Na Vercel, em **Environment Variables**, definir:
`SHOPIFY_WEBHOOK_SECRET`, `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF`.
Anotar a URL final: `https://<projeto>.vercel.app/api/shopify-webhook`.

### 6. Registar o webhook na Shopify
Em **Settings → Notifications → Webhooks** (ou via Admin API), criar um webhook:
- Evento: **Order creation** (`orders/create`)
- Formato: **JSON**
- URL: a URL da Vercel do passo 5.

A Shopify mostra a **chave de assinatura** dos webhooks — pôr esse valor em
`SHOPIFY_WEBHOOK_SECRET` na Vercel.

## Testar o fluxo completo (encurtado)

Para não esperar 5 dias, há um modo de teste que substitui os offsets por minutos
(2min / 4min / 6min / 8min):

1. No Trigger.dev, definir `USE_TEST_OFFSETS=true` e voltar a fazer `deploy`.
2. Criar uma encomenda MB de teste pendente (ou disparar a tarefa manualmente no dashboard
   com `{ "orderId": <id>, "createdAt": "<ISO agora>" }`).
3. Observar os 4 envios na timeline da execução.
4. A meio, marcar a encomenda como **paga** na Shopify → os envios seguintes **não** devem ocorrer.
5. **Repor `USE_TEST_OFFSETS=false`** (ou remover) e voltar a fazer `deploy` para produção.

## Variáveis de ambiente

Ver [.env.example](.env.example) — cada variável está documentada aí, incluindo em que
plataforma (Trigger.dev / Vercel) tem de existir.
