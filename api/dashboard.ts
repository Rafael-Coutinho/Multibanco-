/**
 * Página do dashboard: /dashboard?key=DASHBOARD_SECRET
 * Serve o HTML; os dados vêm de /api/stats (mesma key) e atualizam a cada 30s.
 *
 * Branding: adotado do site sofiatavira.pt (tema Shopify) —
 * dourado #ab8c52 / #806430, fundos creme #f5f2ec/#f0ebe2, texto #212121,
 * títulos na serifada Amiri (a fonte de headings do site), terracota #e1a382.
 */

interface Req {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

const PAGE = `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sofia Tavira — Lembretes Multibanco</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --cream: #f5f2ec; --cream-2: #f0ebe2; --card: #ffffff; --line: #e5ddcf;
    --text: #212121; --muted: #857f72;
    --gold: #ab8c52; --gold-dark: #806430; --gold-light: #e8d4ae;
    --green: #1c911f; --terracotta: #c0714e; --red: #ac2828;
    --serif: "Amiri", Georgia, serif;
    --sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--cream); color: var(--text);
    font: 15px/1.55 var(--sans);
    padding: 28px 24px 48px; max-width: 1080px; margin: 0 auto;
  }
  header { text-align: center; margin-bottom: 26px; }
  .brand {
    font-family: var(--serif); font-weight: 700; font-size: 34px;
    letter-spacing: 0.5px; color: var(--text);
  }
  .brand .amp { color: var(--gold); }
  .tagline {
    color: var(--gold-dark); font-size: 12.5px; text-transform: uppercase;
    letter-spacing: 2.5px; margin-top: 2px;
  }
  .rule {
    width: 64px; height: 2px; background: var(--gold);
    margin: 14px auto 10px; border-radius: 2px;
  }
  #updated { color: var(--muted); font-size: 13px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 4px; padding: 20px 22px;
    box-shadow: 0 1px 3px rgba(128, 100, 48, 0.06);
  }
  .kpi { border-top: 3px solid var(--gold); }
  .kpi .label {
    color: var(--muted); font-size: 12px; text-transform: uppercase;
    letter-spacing: 1.4px; margin-bottom: 8px;
  }
  .kpi .value {
    font-family: var(--serif); font-size: 38px; font-weight: 700;
    line-height: 1.1; letter-spacing: -0.5px;
  }
  .kpi .sub { color: var(--muted); font-size: 12.5px; margin-top: 6px; }
  .green { color: var(--green); } .gold { color: var(--gold-dark); }
  .terracotta { color: var(--terracotta); }
  section { margin-top: 30px; }
  h2 {
    font-family: var(--serif); font-size: 20px; font-weight: 700;
    margin-bottom: 12px; color: var(--text);
  }
  h2 .dot { color: var(--gold); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 14px; font-size: 14px; }
  th {
    color: var(--gold-dark); font-weight: 500; font-size: 11.5px;
    text-transform: uppercase; letter-spacing: 1.2px;
    border-bottom: 2px solid var(--gold-light); background: var(--cream-2);
  }
  td { border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #faf8f3; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.val { font-family: var(--serif); font-weight: 700; font-size: 15.5px; }
  .pill {
    display: inline-block; min-width: 26px; text-align: center;
    padding: 1px 9px; border-radius: 99px; font-size: 12px;
    background: var(--gold-light); color: var(--gold-dark); font-weight: 600;
  }
  .empty { color: var(--muted); padding: 16px 6px; font-size: 14px; font-style: italic; }
  #error {
    display: none; background: #f7e8e6; border: 1px solid #e0c2bd;
    color: var(--red); padding: 12px 16px; border-radius: 4px; margin-bottom: 16px;
  }
  .breakdown { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px;
    color: var(--muted); font-size: 12.5px; }
  .breakdown b { color: var(--text); }
  footer {
    margin-top: 40px; text-align: center; color: var(--muted);
    font-size: 12px; letter-spacing: 0.4px;
  }
  footer .h { color: var(--gold); }
</style>
</head>
<body>
<header>
  <div class="brand">Sofia Tavira</div>
  <div class="tagline">Lembretes Multibanco · WhatsApp</div>
  <div class="rule"></div>
  <div id="updated">a carregar…</div>
</header>
<div id="error"></div>

<div class="grid">
  <div class="card kpi">
    <div class="label">Lembretes enviados</div>
    <div class="value" id="k-sent">–</div>
    <div class="breakdown" id="k-breakdown"></div>
  </div>
  <div class="card kpi">
    <div class="label">Encomendas recuperadas</div>
    <div class="value green" id="k-recovered">–</div>
    <div class="sub" id="k-rate"></div>
  </div>
  <div class="card kpi">
    <div class="label">Valor recuperado</div>
    <div class="value gold" id="k-value">–</div>
    <div class="sub">encomendas pagas após lembrete</div>
  </div>
  <div class="card kpi">
    <div class="label">Ainda por pagar</div>
    <div class="value terracotta" id="k-pending">–</div>
    <div class="sub" id="k-pending-n"></div>
  </div>
</div>

<section>
  <h2><span class="dot">●</span> Encomendas recuperadas</h2>
  <div class="card" style="padding:0; overflow:hidden">
    <table id="t-recovered">
      <thead><tr>
        <th>Encomenda</th><th>Cliente</th><th>Telemóvel</th>
        <th class="num">Lembretes</th><th class="num">Valor</th>
      </tr></thead>
      <tbody></tbody>
    </table>
    <div class="empty" id="e-recovered" style="display:none; padding:16px">
      Ainda nenhuma encomenda recuperada — os lembretes começaram há pouco. 💛
    </div>
  </div>
</section>

<section>
  <h2><span class="dot">●</span> Com lembrete, à espera de pagamento</h2>
  <div class="card" style="padding:0; overflow:hidden">
    <table id="t-awaiting">
      <thead><tr>
        <th>Encomenda</th><th>Cliente</th><th>Telemóvel</th>
        <th class="num">Lembretes</th><th class="num">Valor</th>
      </tr></thead>
      <tbody></tbody>
    </table>
    <div class="empty" id="e-awaiting" style="display:none; padding:16px">Nenhuma encomenda pendente com lembrete.</div>
  </div>
</section>

<footer>Sofia Tavira <span class="h">💛</span> recuperação automática de encomendas Multibanco</footer>

<script>
const KEY = new URLSearchParams(location.search).get("key") || "";
const eur = v => v.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

function fillTable(id, emptyId, rows) {
  const tbody = document.querySelector("#" + id + " tbody");
  tbody.innerHTML = "";
  document.getElementById(emptyId).style.display = rows.length ? "none" : "block";
  document.querySelector("#" + id).style.display = rows.length ? "table" : "none";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>#" + r.orderNumber + "</td><td>" + r.name + "</td>" +
      "<td>" + (r.phone ? "+" + r.phone : "—") + "</td>" +
      '<td class="num"><span class="pill">' + r.remindersReceived + "</span></td>" +
      '<td class="num val">' + eur(r.valueEur) + "</td>";
    tbody.appendChild(tr);
  }
}

async function refresh() {
  try {
    const res = await fetch("/api/stats?key=" + encodeURIComponent(KEY));
    if (!res.ok) throw new Error(res.status === 401
      ? "Chave de acesso inválida — confirma o link."
      : "Erro " + res.status + " ao obter dados.");
    const s = await res.json();

    document.getElementById("k-sent").textContent = s.remindersSent.total;
    document.getElementById("k-breakdown").innerHTML =
      "<span>1º: <b>" + s.remindersSent.r1 + "</b></span>" +
      "<span>2º: <b>" + s.remindersSent.r2 + "</b></span>" +
      "<span>3º: <b>" + s.remindersSent.r3 + "</b></span>" +
      "<span>avisos: <b>" + s.remindersSent.owner + "</b></span>";
    document.getElementById("k-recovered").textContent = s.ordersRecovered;
    document.getElementById("k-rate").textContent =
      "taxa de recuperação: " + Math.round(s.recoveryRate * 100) + "% · " +
      s.ordersReminded + " encomendas com lembrete";
    document.getElementById("k-value").textContent = eur(s.recoveredValueEur);
    document.getElementById("k-pending").textContent = eur(s.pendingValueEur);
    document.getElementById("k-pending-n").textContent =
      s.awaitingOrders.length + " encomendas pendentes";

    fillTable("t-recovered", "e-recovered", s.recoveredOrders);
    fillTable("t-awaiting", "e-awaiting", s.awaitingOrders);

    document.getElementById("updated").textContent =
      "atualizado às " + new Date(s.generatedAt).toLocaleTimeString("pt-PT",
        { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    document.getElementById("error").style.display = "none";
  } catch (err) {
    const el = document.getElementById("error");
    el.textContent = String(err.message || err);
    el.style.display = "block";
  }
}
refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;

export default function handler(req: Req, res: Res): void {
  const secret = process.env.DASHBOARD_SECRET;
  const url = new URL(req.url ?? "/", "http://x");
  if (!secret || url.searchParams.get("key") !== secret) {
    res.status(401);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      "<!DOCTYPE html><meta charset='utf-8'><body style=\"font-family:Georgia,serif;background:#f5f2ec;color:#212121;display:grid;place-items:center;height:100vh;text-align:center\"><div><h2 style='letter-spacing:1px'>Sofia Tavira</h2><p style='color:#806430'>🔒 Acesso restrito — pede o link correto do dashboard.</p></div>",
    );
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200);
  res.send(PAGE);
}
