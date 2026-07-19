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
  .side { display: grid; grid-template-rows: repeat(3, 1fr); }
  .side .kpi { padding: 18px 28px; }
  .side .kpi + .kpi { border-top: 1px solid var(--line); }
  .kpi-rule { width: 30px; height: 2px; background: var(--gold); margin: 10px 0 12px; border-radius: 2px; }
  .num {
    font-family: var(--serif); font-weight: 700; line-height: .98;
    letter-spacing: -1px; font-variant-numeric: tabular-nums;
  }
  .hero .num { font-size: 68px; color: var(--gold-deep); }
  .side .num { font-size: 38px; color: var(--ink); }
  .side .num.rate { color: var(--olive); }
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
  /* ── login ── */
  #gate { position: fixed; inset: 0; background: var(--paper); display: grid; place-items: center; z-index: 100; padding: 24px; }
  #gate-form { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    padding: 36px 30px 30px; width: 100%; max-width: 350px; text-align: center; box-shadow: 0 8px 34px rgba(125,98,48,.09); }
  .gate-brand { font-family: var(--serif); font-weight: 700; font-size: 32px; }
  .gate-sub { color: var(--gold-deep); font-size: 11px; text-transform: uppercase; letter-spacing: 2.2px; margin: 5px 0 26px; }
  .gate-rule { width: 34px; height: 2px; background: var(--gold); margin: 0 auto 24px; border-radius: 2px; }
  #gate-form label { display: block; text-align: left; font-size: 11px; color: var(--muted);
    margin-bottom: 7px; text-transform: uppercase; letter-spacing: 1.2px; }
  #gate-pass { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 6px;
    font: inherit; font-size: 15px; background: #fff; color: var(--ink); }
  #gate-pass:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(171,140,82,.16); }
  #gate-form button { width: 100%; margin-top: 16px; padding: 12px; border: 0; border-radius: 6px;
    background: var(--gold-deep); color: #fff; font: inherit; font-size: 14.5px; font-weight: 600;
    letter-spacing: .4px; cursor: pointer; transition: background .2s; }
  #gate-form button:hover { background: #6a5228; }
  #gate-error { color: var(--terracotta); font-size: 13px; margin-top: 14px; min-height: 18px; }
  .logout { background: none; border: 0; color: var(--muted); font: inherit; font-size: 12px;
    cursor: pointer; text-decoration: underline; letter-spacing: .3px; margin-left: 10px; }
  .logout:hover { color: var(--gold-deep); }
</style>
</head>
<body>
<div id="gate">
  <form id="gate-form" autocomplete="on">
    <div class="gate-brand">Sofia Tavira</div>
    <div class="gate-sub">Painel de recuperação Multibanco</div>
    <div class="gate-rule"></div>
    <label for="gate-pass">Palavra-passe</label>
    <input id="gate-pass" type="password" autocomplete="current-password" autofocus>
    <button type="submit">Entrar</button>
    <div id="gate-error"></div>
  </form>
</div>

<div id="app" style="display:none">
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
    <div class="kpi">
      <div class="eyebrow">Taxa de recuperação</div>
      <div class="num rate" id="k-rate">–</div>
      <div class="kpi-sub" id="s-rate"></div>
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
<footer>Sofia Tavira <span class="h">&#128155;</span> recuperação automática de encomendas Multibanco<button class="logout" id="logout" type="button">sair</button></footer>
</div>

<script>
// palavra-passe: guardada no dispositivo (ou vinda do link ?key= por compatibilidade)
let PASS = localStorage.getItem("st_pass") || new URLSearchParams(location.search).get("key") || "";
let started = false;
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
  return withinMs(Date.parse(iso), hours, end);
}
function withinMs(t, hours, end) {
  if (t > end) return false;
  return hours == null || t > end - hours * HOUR;
}
/** 1º lembrete (ms) por encomenda + conjunto de recuperadas — base da taxa. */
function cohortIndex() {
  const first = {};
  for (const r of DATA.reminderEvents) {
    if (r.type === "owner" || !r.orderNumber) continue;
    const t = Date.parse(r.at);
    if (first[r.orderNumber] == null || t < first[r.orderNumber]) first[r.orderNumber] = t;
  }
  const recSet = new Set(DATA.recoveryEvents.map(r => r.orderNumber));
  return { first, recSet };
}
function aggregate(hours, end, coh) {
  const rem = DATA.reminderEvents.filter(r => r.type !== "owner" && within(r.at, hours, end));
  const rec = DATA.recoveryEvents.filter(r => within(r.at, hours, end));
  const by = { r1: 0, r2: 0, r3: 0 };
  rem.forEach(r => { if (by[r.type] != null) by[r.type]++; });
  // Taxa de recuperação: das encomendas cujo 1º lembrete caiu neste período,
  // quantas já foram pagas. (coorte por 1º lembrete = atribuição justa.)
  let cohort = 0, cohortRec = 0;
  for (const num in coh.first) {
    if (!withinMs(coh.first[num], hours, end)) continue;
    cohort++;
    if (coh.recSet.has(num)) cohortRec++;
  }
  return {
    sent: rem.length, by,
    recovered: rec.length,
    value: rec.reduce((s, r) => s + r.valueEur, 0),
    recList: rec,
    cohort, cohortRec,
    rate: cohort ? cohortRec / cohort : null,
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
  const coh = cohortIndex();
  const cur = aggregate(SEL, end, coh);
  const prev = SEL == null ? null : aggregate(SEL, end - SEL * HOUR, coh);
  const wl = (WINDOWS.find(w => w.h === SEL) || {}).label;
  document.getElementById("range-note").innerHTML =
    SEL == null ? "Desde o início da automação" : "Últimas <span>" + wl + "</span>";

  countUp(document.getElementById("k-value"), cur.value, eur);
  countUp(document.getElementById("k-sent"), cur.sent, v => String(Math.round(v)));
  countUp(document.getElementById("k-recovered"), cur.recovered, v => String(Math.round(v)));
  countUp(document.getElementById("k-rate"), cur.rate == null ? 0 : cur.rate * 100, v => Math.round(v) + "%");

  setDelta("d-value", cur.value, prev && prev.value, SEL, true);
  setDelta("d-recovered", cur.recovered, prev && prev.recovered, SEL, true);

  const rateEl = document.getElementById("s-rate");
  rateEl.innerHTML = cur.cohort
    ? "<b>" + cur.cohortRec + "</b> de <b>" + cur.cohort + "</b> encomendas com lembrete " +
      (SEL == null ? "" : "neste período ") + "já foram pagas"
    : "sem encomendas com lembrete neste período";

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

function markUpdated() {
  document.getElementById("updated").textContent = "atualizado às " +
    new Date(DATA.generatedAt).toLocaleTimeString("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    " · atualiza automaticamente";
}

// atualização periódica (já autenticado)
async function refresh() {
  try {
    const res = await fetch("/api/stats?key=" + encodeURIComponent(PASS));
    if (res.status === 401) { logout(); return; }        // palavra-passe revogada
    if (!res.ok) throw new Error("Erro " + res.status + " ao obter dados.");
    DATA = await res.json(); render(); markUpdated();
    document.getElementById("error").style.display = "none";
  } catch (err) {
    const el = document.getElementById("error");
    el.textContent = String(err.message || err); el.style.display = "block";
  }
}

// ── login ──
const gate = document.getElementById("gate");
const app = document.getElementById("app");
const gateForm = document.getElementById("gate-form");
const gatePass = document.getElementById("gate-pass");
const gateError = document.getElementById("gate-error");

function positionIndicator() {
  const active = seg.querySelector('button[aria-selected="true"]');
  if (active) moveIndicator(active);
}
function showApp() {
  gate.style.display = "none"; app.style.display = "";
  positionIndicator();
  if (!started) { started = true; setInterval(refresh, 30000); }
}
function showGate(msg) {
  app.style.display = "none"; gate.style.display = "grid";
  gateError.textContent = msg || "";
  gatePass.value = ""; gatePass.focus();
}
function logout() {
  localStorage.removeItem("st_pass"); PASS = ""; started = false;
  showGate("");
}

async function tryAuth(pass, fromForm) {
  try {
    const res = await fetch("/api/stats?key=" + encodeURIComponent(pass));
    if (res.status === 401) { showGate(fromForm ? "Palavra-passe incorreta." : ""); return; }
    if (!res.ok) { if (fromForm) gateError.textContent = "Erro " + res.status + ". Tenta novamente."; return; }
    PASS = pass; localStorage.setItem("st_pass", pass);
    DATA = await res.json(); showApp(); render(); markUpdated();
  } catch (e) {
    if (fromForm) gateError.textContent = "Sem ligação. Tenta novamente.";
    else showGate("");
  }
}

gateForm.addEventListener("submit", e => {
  e.preventDefault();
  const v = gatePass.value.trim();
  if (v) { gateError.textContent = "a entrar…"; tryAuth(v, true); }
});
document.getElementById("logout").addEventListener("click", logout);
window.addEventListener("resize", positionIndicator);

// arranque: se já houver palavra-passe guardada, entra direto; senão mostra o login.
if (PASS) tryAuth(PASS, false); else showGate("");
</script>
</body>
</html>`;

export default function handler(_req: Req, res: Res): void {
  // A página (só o formulário de login + UI) é pública; os DADOS ficam
  // protegidos em /api/stats, que exige a palavra-passe. Sem palavra-passe
  // correta, o dashboard nunca chega a receber números.
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200);
  res.send(PAGE);
}
