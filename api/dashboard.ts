/**
 * Dashboard: /dashboard?key=DASHBOARD_SECRET
 *
 * Seletor de período (24h / 48h / 7 dias / 30 dias / Sempre) que filtra, no
 * browser, os lembretes enviados, as encomendas recuperadas e o valor recuperado.
 * Os dados vêm de /api/stats (mesma key) como eventos em cru; a filtragem e o
 * cálculo dos deltas vs. período anterior são instantâneos do lado do cliente.
 *
 * Branding Sofia Tavira: papel creme, ouro #ab8c52, serifada Amiri para os
 * numerais (tratamento editorial), verde-oliva = pago, terracota = pendente.
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
<title>Sofia Tavira — Recuperação Multibanco</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #f6f3ec; --card: #fffdf9; --ink: #2a2620; --muted: #8a8272;
    --gold: #ab8c52; --gold-deep: #7d6230; --gold-soft: #ecdfc4; --line: #e7dfce;
    --olive: #4e7d3a; --terracotta: #bf6a45;
    --serif: "Amiri", Georgia, serif;
    --sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: var(--paper); color: var(--ink);
    font: 15px/1.55 var(--sans);
    padding: 40px 22px 64px; max-width: 1000px; margin: 0 auto;
    overflow-x: hidden;
  }
  .eyebrow {
    font-size: 11px; text-transform: uppercase; letter-spacing: 2.6px;
    color: var(--gold-deep); font-weight: 500;
  }
  /* ── cabeçalho ── */
  header { text-align: center; margin-bottom: 30px; }
  .wordmark { font-family: var(--serif); font-weight: 700; font-size: 38px; letter-spacing: 0.5px; }
  header .eyebrow { margin-top: 4px; }
  /* ── seletor de período ── */
  .seg-wrap { display: flex; justify-content: center; margin: 26px 0 8px; }
  .seg {
    position: relative; display: inline-flex; background: var(--card);
    border: 1px solid var(--line); border-radius: 999px; padding: 4px;
    box-shadow: 0 1px 2px rgba(125,98,48,.05);
  }
  .seg-ind {
    position: absolute; top: 4px; bottom: 4px; left: 0; width: 0;
    background: var(--gold); border-radius: 999px; z-index: 0;
    transition: transform .32s cubic-bezier(.4,.1,.2,1), width .32s cubic-bezier(.4,.1,.2,1);
  }
  .seg button {
    position: relative; z-index: 1; border: 0; background: transparent;
    font: inherit; font-size: 13.5px; color: var(--muted); cursor: pointer;
    padding: 7px 16px; border-radius: 999px; letter-spacing: .2px;
    transition: color .2s; white-space: nowrap;
  }
  .seg button[aria-selected="true"] { color: #fff; font-weight: 600; }
  .seg button:focus-visible { outline: 2px solid var(--gold-deep); outline-offset: 2px; }
  .range-note { text-align: center; color: var(--muted); font-size: 12.5px; margin-bottom: 26px; font-style: italic; }
  .range-note span { font-style: normal; }
  /* ── painel-livro (KPIs) ── */
  .ledger { display: grid; grid-template-columns: 1.35fr 1fr; gap: 0;
    background: var(--card); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .hero { padding: 30px 30px 32px; border-right: 1px solid var(--line);
    display: flex; flex-direction: column; justify-content: center; }
  .side { display: grid; grid-template-rows: 1fr 1fr; }
  .side .kpi { padding: 22px 28px; }
  .side .kpi + .kpi { border-top: 1px solid var(--line); }
  .kpi-rule { width: 30px; height: 2px; background: var(--gold); margin: 10px 0 12px; border-radius: 2px; }
  .num {
    font-family: var(--serif); font-weight: 700; line-height: .98;
    letter-spacing: -1px; font-variant-numeric: tabular-nums;
  }
  .hero .num { font-size: 68px; color: var(--gold-deep); }
  .side .num { font-size: 40px; color: var(--ink); }
  .delta { margin-top: 12px; font-size: 12.5px; color: var(--muted); }
  .delta .arrow { font-weight: 700; }
  .delta.up { color: var(--olive); } .delta.down { color: var(--terracotta); }
  .kpi-sub { margin-top: 10px; color: var(--muted); font-size: 12.5px; }
  .kpi-sub b { color: var(--ink); font-weight: 600; }
  .brk { display: inline-flex; gap: 12px; flex-wrap: wrap; }
  /* ── faixa estado atual ── */
  .snapshot {
    display: flex; align-items: baseline; gap: 8px; justify-content: center;
    flex-wrap: wrap; margin: 20px 0 8px; color: var(--muted); font-size: 13px;
  }
  .snapshot b { font-family: var(--serif); font-size: 19px; color: var(--terracotta); font-weight: 700; }
  /* ── secções ── */
  section { margin-top: 40px; }
  h2 { font-family: var(--serif); font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .h2-note { color: var(--muted); font-size: 12.5px; margin-bottom: 14px; }
  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  /* feed */
  .feed { list-style: none; padding: 6px 20px; }
  .feed li { display: grid; grid-template-columns: 92px 1fr; column-gap: 12px;
    padding: 10px 0; align-items: baseline; border-bottom: 1px solid var(--line); font-size: 14px; }
  .feed li:last-child { border-bottom: none; }
  .feed .body { display: flex; gap: 10px; align-items: baseline; min-width: 0; }
  .feed .body > span { min-width: 0; overflow-wrap: anywhere; }
  .feed .when { color: var(--muted); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .feed .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
  .feed .val { font-family: var(--serif); font-weight: 700; color: var(--olive); }
  .feed .muted { color: var(--muted); }
  /* tabelas */
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 11px 20px; font-size: 14px; }
  th { color: var(--gold-deep); font-weight: 500; font-size: 11px; text-transform: uppercase;
    letter-spacing: 1.2px; border-bottom: 1px solid var(--line); }
  td { border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: #faf7f0; }
  td.num-c, th.num-c { text-align: right; font-variant-numeric: tabular-nums; }
  td.money { font-family: var(--serif); font-weight: 700; font-size: 15px; }
  .pill { display: inline-block; min-width: 24px; text-align: center; padding: 1px 8px;
    border-radius: 999px; font-size: 12px; background: var(--gold-soft); color: var(--gold-deep); font-weight: 600; }
  .empty { color: var(--muted); padding: 22px 20px; font-size: 14px; font-style: italic; text-align: center; }
  #error { display: none; background: #f7e8e6; border: 1px solid #e0c2bd; color: #ac2828;
    padding: 12px 16px; border-radius: 4px; margin: 0 0 18px; text-align: center; }
  #updated { text-align: center; color: var(--muted); font-size: 12px; margin-top: 34px; letter-spacing: .3px; }
  footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 6px; }
  footer .h { color: var(--gold); }
  @media (max-width: 720px) {
    body { padding: 28px 15px 48px; }
    .wordmark { font-size: 28px; }
    header .eyebrow { letter-spacing: 1.6px; font-size: 10px; }
    .ledger { grid-template-columns: 1fr; }
    .hero { border-right: none; border-bottom: 1px solid var(--line); padding: 26px; }
    .hero .num { font-size: 54px; }
    .seg { padding: 3px; }
    .seg button { padding: 7px 10px; font-size: 12px; }
    .feed li { grid-template-columns: 74px 1fr; column-gap: 10px; }
    .feed { padding: 4px 14px; }
    th, td { padding: 10px 12px; }
    .hide-sm { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .seg-ind { transition: none; } }
</style>
</head>
<body>
<header>
  <div class="wordmark">Sofia Tavira</div>
  <div class="eyebrow">Recuperação de encomendas Multibanco</div>
</header>

<div id="error"></div>

<div class="seg-wrap">
  <div class="seg" id="seg" role="tablist" aria-label="Período">
    <span class="seg-ind" id="seg-ind"></span>
  </div>
</div>
<div class="range-note" id="range-note"></div>

<div class="ledger">
  <div class="hero kpi">
    <div class="eyebrow">Valor recuperado</div>
    <div class="kpi-rule"></div>
    <div class="num" id="k-value">–</div>
    <div class="delta" id="d-value"></div>
    <div class="kpi-sub" id="s-value"></div>
  </div>
  <div class="side">
    <div class="kpi">
      <div class="eyebrow">Lembretes enviados</div>
      <div class="num" id="k-sent">–</div>
      <div class="kpi-sub"><span class="brk" id="s-sent"></span></div>
    </div>
    <div class="kpi">
      <div class="eyebrow">Encomendas recuperadas</div>
      <div class="num" id="k-recovered">–</div>
      <div class="delta" id="d-recovered"></div>
    </div>
  </div>
</div>

<div class="snapshot">
  <span class="eyebrow" style="letter-spacing:2px">Agora</span>
  <span>· por pagar com lembrete ativo:</span>
  <b id="snap-pending">–</b>
  <span id="snap-n"></span>
</div>

<section>
  <h2>Atividade</h2>
  <div class="h2-note" id="feed-note"></div>
  <div class="panel">
    <ul class="feed" id="feed"></ul>
    <div class="empty" id="e-feed" style="display:none">Sem lembretes nem pagamentos neste período.</div>
  </div>
</section>

<section>
  <h2>Recuperadas</h2>
  <div class="h2-note" id="rec-note"></div>
  <div class="panel">
    <table id="t-recovered">
      <thead><tr><th>Encomenda</th><th>Cliente</th><th class="hide-sm">Telemóvel</th><th class="num-c">Lembretes</th><th class="num-c">Valor</th></tr></thead>
      <tbody></tbody>
    </table>
    <div class="empty" id="e-recovered" style="display:none">Nenhuma encomenda recuperada neste período. 💛</div>
  </div>
</section>

<section>
  <h2>À espera de pagamento</h2>
  <div class="h2-note">Estado atual — encomendas com lembrete enviado que continuam por pagar.</div>
  <div class="panel">
    <table id="t-awaiting">
      <thead><tr><th>Encomenda</th><th>Cliente</th><th class="hide-sm">Telemóvel</th><th class="num-c">Lembretes</th><th class="num-c">Valor</th></tr></thead>
      <tbody></tbody>
    </table>
    <div class="empty" id="e-awaiting" style="display:none">Nenhuma encomenda pendente com lembrete.</div>
  </div>
</section>

<div id="updated">a carregar…</div>
<footer>Sofia Tavira <span class="h">&#128155;</span> recuperação automática de encomendas Multibanco</footer>

<script>
const KEY = new URLSearchParams(location.search).get("key") || "";
const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const HOUR = 3600e3;
const eur = v => v.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const eur0 = v => Math.round(v).toLocaleString("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const WINDOWS = [
  { h: 24, label: "24 h" }, { h: 48, label: "48 h" }, { h: 168, label: "7 dias" },
  { h: 720, label: "30 dias" }, { h: null, label: "Sempre" },
];
let SEL = 24;      // horas selecionadas (null = sempre)
let DATA = null;   // último payload

// ── seletor de período ──
const seg = document.getElementById("seg");
const ind = document.getElementById("seg-ind");
WINDOWS.forEach(w => {
  const b = document.createElement("button");
  b.textContent = w.label; b.setAttribute("role", "tab");
  b.dataset.h = String(w.h);
  b.setAttribute("aria-selected", String(w.h === SEL));
  b.addEventListener("click", () => selectWindow(w.h, b));
  seg.appendChild(b);
});
function moveIndicator(btn) {
  ind.style.width = btn.offsetWidth + "px";
  ind.style.transform = "translateX(" + (btn.offsetLeft - 4) + "px)";
}
function selectWindow(h, btn) {
  SEL = h;
  [...seg.querySelectorAll("button")].forEach(b => b.setAttribute("aria-selected", String(b === btn)));
  moveIndicator(btn);
  if (DATA) render();
}

// ── animação count-up ──
function countUp(el, to, fmt) {
  const from = el._val || 0; el._val = to;
  if (RM || from === to) { el.textContent = fmt(to); return; }
  const start = performance.now(), dur = 520;
  function frame(t) {
    const p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ── janelas ──
function within(iso, hours, end) {
  const t = Date.parse(iso);
  if (t > end) return false;
  return hours == null || t > end - hours * HOUR;
}
function aggregate(hours, end) {
  const rem = DATA.reminderEvents.filter(r => r.type !== "owner" && within(r.at, hours, end));
  const rec = DATA.recoveryEvents.filter(r => within(r.at, hours, end));
  const by = { r1: 0, r2: 0, r3: 0 };
  rem.forEach(r => { if (by[r.type] != null) by[r.type]++; });
  return {
    sent: rem.length, by,
    recovered: rec.length,
    value: rec.reduce((s, r) => s + r.valueEur, 0),
    recList: rec,
  };
}
function deltaHtml(cur, prev, hours) {
  if (hours == null || prev == null) return "";
  if (prev === 0) return cur > 0 ? '<span class="arrow">↑</span> novo neste período' : "sem alterações";
  const pct = Math.round((cur - prev) / prev * 100);
  if (pct === 0) return "igual ao período anterior";
  const up = pct > 0;
  return '<span class="arrow">' + (up ? "↑" : "↓") + "</span> " + Math.abs(pct) + "% vs. período anterior";
}
function setDelta(elId, cur, prev, hours, goodUp) {
  const el = document.getElementById(elId);
  el.innerHTML = deltaHtml(cur, prev, hours);
  el.className = "delta";
  if (hours == null || prev == null || prev === 0) return;
  const up = cur > prev, down = cur < prev;
  if (goodUp && up) el.classList.add("up");
  else if (goodUp && down) el.classList.add("down");
}

const KINDS = {
  r1: { c: "#b8862b", label: "1º lembrete" }, r2: { c: "#1f6f9e", label: "2º lembrete" },
  r3: { c: "#b0562e", label: "3º lembrete" }, owner: { c: "#8a8272", label: "aviso interno" },
  paid: { c: "#4e7d3a", label: "pago" },
};

function fillTable(id, emptyId, rows) {
  const tbody = document.querySelector("#" + id + " tbody");
  tbody.innerHTML = "";
  const show = rows.length > 0;
  document.getElementById(emptyId).style.display = show ? "none" : "block";
  document.querySelector("#" + id).style.display = show ? "table" : "none";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>#" + r.orderNumber + "</td><td>" + (r.name || "—") + "</td>" +
      '<td class="hide-sm">' + (r.phone ? "+" + r.phone : "—") + "</td>" +
      '<td class="num-c"><span class="pill">' + r.remindersReceived + "</span></td>" +
      '<td class="num-c money">' + eur(r.valueEur) + "</td>";
    tbody.appendChild(tr);
  }
}

function render() {
  const end = Date.now();
  const cur = aggregate(SEL, end);
  const prev = SEL == null ? null : aggregate(SEL, end - SEL * HOUR);
  const wl = (WINDOWS.find(w => w.h === SEL) || {}).label;
  document.getElementById("range-note").innerHTML =
    SEL == null ? "Desde o início da automação" : "Últimas <span>" + wl + "</span>";

  countUp(document.getElementById("k-value"), cur.value, eur);
  countUp(document.getElementById("k-sent"), cur.sent, v => String(Math.round(v)));
  countUp(document.getElementById("k-recovered"), cur.recovered, v => String(Math.round(v)));

  setDelta("d-value", cur.value, prev && prev.value, SEL, true);
  setDelta("d-recovered", cur.recovered, prev && prev.recovered, SEL, true);

  document.getElementById("s-value").innerHTML = cur.recovered
    ? "de <b>" + cur.recovered + "</b> encomenda" + (cur.recovered > 1 ? "s" : "") + " paga" + (cur.recovered > 1 ? "s" : "") + " após lembrete"
    : "ainda nenhuma paga neste período";
  document.getElementById("s-sent").innerHTML =
    "<span>1º <b>" + cur.by.r1 + "</b></span><span>2º <b>" + cur.by.r2 + "</b></span><span>3º <b>" + cur.by.r3 + "</b></span>";

  // snapshot (estado atual — não temporal)
  const pend = DATA.awaitingOrders.reduce((s, o) => s + o.valueEur, 0);
  document.getElementById("snap-pending").textContent = eur(pend);
  document.getElementById("snap-n").textContent = "· " + DATA.awaitingOrders.length + " encomendas";

  // feed (período)
  const feedEvents = [
    ...DATA.reminderEvents.filter(r => within(r.at, SEL, end)).map(r => ({ at: r.at, kind: r.type, orderNumber: r.orderNumber, name: r.name, valueEur: null })),
    ...cur.recList.map(r => ({ at: r.at, kind: "paid", orderNumber: r.orderNumber, name: r.name, valueEur: r.valueEur })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  const ul = document.getElementById("feed"); ul.innerHTML = "";
  document.getElementById("e-feed").style.display = feedEvents.length ? "none" : "block";
  document.getElementById("feed-note").textContent =
    feedEvents.length ? feedEvents.length + " eventos" : "";
  for (const e of feedEvents) {
    const k = KINDS[e.kind] || KINDS.owner;
    const when = new Date(e.at).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    let text;
    if (e.kind === "paid") text = "<b>Encomenda #" + e.orderNumber + " paga</b> · <span class='val'>" + eur(e.valueEur) + "</span>" + (e.name ? " · " + e.name : "");
    else if (e.kind === "owner") text = "<span class='muted'>Aviso interno · encomenda #" + e.orderNumber + " sem pagamento</span>";
    else text = k.label + " &rarr; <b>#" + (e.orderNumber || "?") + "</b>" + (e.name ? " · " + e.name : "");
    const li = document.createElement("li");
    li.innerHTML = '<span class="when">' + when + '</span>' +
      '<span class="body"><span class="dot" style="background:' + k.c + '"></span><span>' + text + "</span></span>";
    ul.appendChild(li);
  }

  // tabela recuperadas (período) + à espera (atual)
  document.getElementById("rec-note").textContent =
    SEL == null ? "Pagas após lembrete." : "Pagas após lembrete nas últimas " + wl + ".";
  fillTable("t-recovered", "e-recovered", cur.recList.slice().sort((a, b) => b.at.localeCompare(a.at)));
  fillTable("t-awaiting", "e-awaiting", DATA.awaitingOrders);
}

async function refresh() {
  try {
    const res = await fetch("/api/stats?key=" + encodeURIComponent(KEY));
    if (!res.ok) throw new Error(res.status === 401 ? "Chave de acesso inválida — confirma o link." : "Erro " + res.status + " ao obter dados.");
    DATA = await res.json();
    render();
    document.getElementById("updated").textContent = "atualizado às " +
      new Date(DATA.generatedAt).toLocaleTimeString("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      " · atualiza automaticamente";
    document.getElementById("error").style.display = "none";
  } catch (err) {
    const el = document.getElementById("error");
    el.textContent = String(err.message || err); el.style.display = "block";
  }
}

// posicionar indicador no arranque + em resize
window.addEventListener("load", () => {
  const active = seg.querySelector('button[aria-selected="true"]');
  if (active) moveIndicator(active);
});
window.addEventListener("resize", () => {
  const active = seg.querySelector('button[aria-selected="true"]');
  if (active) moveIndicator(active);
});
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
      "<!DOCTYPE html><meta charset='utf-8'><body style=\"font-family:Georgia,serif;background:#f6f3ec;color:#2a2620;display:grid;place-items:center;height:100vh;text-align:center\"><div><h2 style='letter-spacing:1px'>Sofia Tavira</h2><p style='color:#7d6230'>🔒 Acesso restrito — pede o link correto do dashboard.</p></div>",
    );
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200);
  res.send(PAGE);
}
