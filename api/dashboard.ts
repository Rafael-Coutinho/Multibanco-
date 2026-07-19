/**
 * Página do dashboard: /dashboard?key=DASHBOARD_SECRET
 * Serve o HTML; os dados vêm de /api/stats (mesma key) e atualizam a cada 30s.
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
<title>Lembretes Multibanco — Sofia Tavira</title>
<style>
  :root {
    --bg: #0f1115; --card: #191c23; --line: #262a33;
    --text: #e8eaf0; --muted: #9aa1ae;
    --gold: #e8b93c; --green: #45c476; --red: #e0604f; --blue: #5aa7e8;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 24px; max-width: 1080px; margin: 0 auto;
  }
  header { display: flex; align-items: baseline; justify-content: space-between;
    flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 650; }
  h1 span { color: var(--gold); }
  #updated { color: var(--muted); font-size: 13px; }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; padding: 18px 20px;
  }
  .kpi .label { color: var(--muted); font-size: 13px; margin-bottom: 6px; }
  .kpi .value { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; }
  .kpi .sub { color: var(--muted); font-size: 12.5px; margin-top: 4px; }
  .green { color: var(--green); } .gold { color: var(--gold); }
  .blue { color: var(--blue); } .red { color: var(--red); }
  section { margin-top: 26px; }
  h2 { font-size: 15px; font-weight: 600; color: var(--muted); margin-bottom: 10px;
    text-transform: uppercase; letter-spacing: 0.6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 12px; font-size: 14px; }
  th { color: var(--muted); font-weight: 500; font-size: 12.5px; border-bottom: 1px solid var(--line); }
  td { border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 1px 9px; border-radius: 99px;
    font-size: 12px; background: #232733; color: var(--muted); }
  .empty { color: var(--muted); padding: 14px 4px; font-size: 14px; }
  #error { display: none; background: #3a1f1c; border: 1px solid #5c2f2a;
    color: #f0b7ae; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; }
  .breakdown { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 8px;
    color: var(--muted); font-size: 13px; }
  .breakdown b { color: var(--text); }
</style>
</head>
<body>
<header>
  <h1>Lembretes Multibanco — <span>Sofia Tavira</span></h1>
  <div id="updated">a carregar…</div>
</header>
<div id="error"></div>

<div class="grid">
  <div class="card kpi">
    <div class="label">Lembretes enviados</div>
    <div class="value blue" id="k-sent">–</div>
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
    <div class="value" id="k-pending">–</div>
    <div class="sub" id="k-pending-n"></div>
  </div>
</div>

<section>
  <h2>💰 Encomendas recuperadas</h2>
  <div class="card" style="padding:6px 4px">
    <table id="t-recovered">
      <thead><tr>
        <th>Encomenda</th><th>Cliente</th><th>Telemóvel</th>
        <th class="num">Lembretes</th><th class="num">Valor</th>
      </tr></thead>
      <tbody></tbody>
    </table>
    <div class="empty" id="e-recovered" style="display:none">
      Ainda nenhuma encomenda recuperada — os lembretes começaram há pouco. 🕐
    </div>
  </div>
</section>

<section>
  <h2>⏳ Com lembrete, à espera de pagamento</h2>
  <div class="card" style="padding:6px 4px">
    <table id="t-awaiting">
      <thead><tr>
        <th>Encomenda</th><th>Cliente</th><th>Telemóvel</th>
        <th class="num">Lembretes</th><th class="num">Valor</th>
      </tr></thead>
      <tbody></tbody>
    </table>
    <div class="empty" id="e-awaiting" style="display:none">Nenhuma encomenda pendente com lembrete.</div>
  </div>
</section>

<script>
const KEY = new URLSearchParams(location.search).get("key") || "";
const eur = v => v.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

function fillTable(id, emptyId, rows) {
  const tbody = document.querySelector("#" + id + " tbody");
  tbody.innerHTML = "";
  document.getElementById(emptyId).style.display = rows.length ? "none" : "block";
  for (const r of rows) {
    const tr = document.createElement("tr");
    const cells = [
      "#" + r.orderNumber, r.name, r.phone ? "+" + r.phone : "—",
    ];
    tr.innerHTML =
      "<td>" + cells[0] + "</td><td>" + cells[1] + "</td><td>" + cells[2] + "</td>" +
      '<td class="num"><span class="pill">' + r.remindersReceived + "</span></td>" +
      '<td class="num">' + eur(r.valueEur) + "</td>";
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
      "<!DOCTYPE html><meta charset='utf-8'><body style='font-family:sans-serif;background:#0f1115;color:#e8eaf0;display:grid;place-items:center;height:100vh'><div><h2>🔒 Acesso restrito</h2><p>Link inválido — pede o link correto do dashboard.</p></div>",
    );
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200);
  res.send(PAGE);
}
