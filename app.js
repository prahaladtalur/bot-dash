// ---------------------------------------------------------------------------------------------
// DISPLAY UNIT. Every amount in dashboard.json is US dollars (fields end in _usd). This constant
// only changes the LABEL printed next to a number. Nothing is converted. "$" shows real units.
const UNIT = "$";
// ---------------------------------------------------------------------------------------------

const REFRESH_MS = 20_000;                                 // poll the data file; the bots' box publishes it every ~10 min
const $ = id => document.getElementById(id);
// Token names, labels and log text are untrusted: everything that reaches innerHTML goes through esc().
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cur = t => UNIT === "$" ? "$" + t : t + " " + UNIT;
const relabel = t => UNIT === "$" ? String(t ?? "") : String(t ?? "").replace(/\$\s?([+-]?\d[\d,.]*)/g, "$1 " + UNIT);
const fmt2 = v => Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v, sign = false) => v == null ? "--" : (v < 0 ? "-" : sign && v > 0 ? "+" : "") + cur(fmt2(v));
const pct = (v, d = 1) => v == null ? "--" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const cls = v => v == null || v === 0 ? "muted" : v > 0 ? "up" : "down";
const price = v => !v ? "--" : v >= 1 ? v.toFixed(3) : v.toPrecision(4);
const ago = s => s == null || isNaN(s) ? "--" : s < 0 ? "now" : s < 90 ? Math.round(s) + "s" : s < 5400 ? Math.round(s / 60) + "m" : s < 172800 ? (s / 3600).toFixed(1) + "h" : Math.round(s / 86400) + "d";
const secondsSince = iso => iso ? (Date.now() - Date.parse(iso)) / 1000 : null;
const localTime = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--";
const localStamp = iso => iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : "--";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Categorical series colours (never red/green: those mean profit and loss).
const SERIES = { combined: "#e7ecf6", copybot: "#4cc9f0", scanbot: "#ffb000" };
const SHADOW_COLOURS = ["#a78bfa", "#8b97b3", "#f472b6"];
const FILTERS = [["all", "All"], ["trades", "Trades"], ["signals", "Signals"], ["skips", "Skips"], ["system", "System"]];
const GROUP = { BUY: "trades", SELL: "trades", CLOSE: "trades", SKIP: "skips", SIGNAL: "signals", REFRESH: "system", PAUSE: "system", RESUME: "system",
                STREAM: "system", WATCH: "system", RPC: "system", ALERT: "system" };

let data = null, view = "combined", sortKey = "closed_at", sortDir = -1, feedFilter = "all", showRejected = false;
let firstRender = true, countUp = false, lastGenerated = null, lastFetch = 0;
const seenEvents = new Set(), prevNums = new Map(), prevText = new Map();

function dataUrl() {
  const cfg = window.DASH_CONFIG || {};
  if (cfg.DATA_URL) return cfg.DATA_URL;
  const host = location.hostname;
  if (host.endsWith(".github.io")) {                      // GitHub Pages: the data lives on a separate branch
    const owner = host.split(".")[0], repo = location.pathname.split("/").filter(Boolean)[0] || host;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${cfg.DATA_BRANCH || "data"}/dashboard.json`;
  }
  return "dashboard.json";
}

async function load() {
  lastFetch = Date.now();
  try {
    const res = await fetch(dataUrl() + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const next = await res.json();
    const changed = !data || next.generated_at !== lastGenerated;
    data = next; lastGenerated = next.generated_at;
    if (changed) render(); else tick();
  } catch (e) {
    setFresh("offline", data ? "CANNOT REFRESH" : "NO DATA YET");
    $("updated").textContent = "could not load dashboard.json (" + e.message + ")";
  }
}

function setFresh(kind, label) {
  const el = $("fresh");
  el.className = "pill " + kind;
  el.innerHTML = `<span class="dot ${kind === "live" ? "pulse" : ""}"></span>${esc(label)}`;
}

// ---- every second: relative times, freshness, countdowns, poll bar
function tick() {
  if (!data) return;
  const age = secondsSince(data.generated_at), stale = age > (data.stale_after_s || 1200);
  if (stale) setFresh("offline", "BOT OFFLINE / HOST ASLEEP");
  else if (!$("fresh").classList.contains("live")) setFresh("live", "LIVE");
  $("updated").innerHTML = `data published <b>${ago(age)}</b> ago`;
  const every = data.publish_every_s || 600, left = every - age;
  $("nextpub").innerHTML = stale ? "" : left > 0 ? `· next publish in ~<b>${ago(left)}</b>` : "· next publish due";
  document.querySelectorAll("[data-ago]").forEach(el => { el.textContent = ago(secondsSince(el.dataset.ago)); });
  const p = Math.min(1, (Date.now() - lastFetch) / REFRESH_MS);
  $("pollbar").style.width = (p * 100).toFixed(1) + "%";
}

// ---- count-up numbers: <span data-n="key" data-v="12.3" data-f="money|moneys|pct|int|pf|ratio">
const FORMATS = { money: v => money(v), moneys: v => money(v, true), pct: v => pct(v), int: v => String(Math.round(v)),
                  pf: v => v.toFixed(2), ratio: v => Math.round(v * 100) + "%", dd: v => v ? "-" + cur(fmt2(v)) : cur("0.00") };
function animateNumbers(root) {
  root.querySelectorAll("[data-n]").forEach(el => {
    const key = el.dataset.n, to = parseFloat(el.dataset.v), f = FORMATS[el.dataset.f] || FORMATS.money;
    if (isNaN(to)) return;
    const had = prevNums.has(key), from = had ? prevNums.get(key) : (firstRender || countUp ? 0 : to);
    prevNums.set(key, to);
    if (had && from !== to && !firstRender) { el.classList.remove("flash-up", "flash-down"); void el.offsetWidth; el.classList.add(to > from ? "flash-up" : "flash-down"); }
    if (reduceMotion || from === to) { el.textContent = f(to); return; }
    const t0 = performance.now(), dur = firstRender || countUp ? 1300 : 900;
    const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = f(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
const N = (key, v, f, extra = "") => v == null ? `<span class="${extra}">--</span>` : `<span class="${extra}" data-n="${esc(key)}" data-v="${v}" data-f="${f}">${esc(FORMATS[f](v))}</span>`;

// ---- text flashes for values that are not count-ups: <span data-k="key">
function flashChanged(root) {
  root.querySelectorAll("[data-k]").forEach(el => {
    const key = el.dataset.k, txt = el.textContent, before = prevText.get(key);
    prevText.set(key, txt);
    if (before != null && before !== txt) {
      const a = parseFloat(before.replace(/[^0-9.+-]/g, "")), b = parseFloat(txt.replace(/[^0-9.+-]/g, ""));
      el.classList.remove("flash-up", "flash-down"); void el.offsetWidth;
      el.classList.add(!isNaN(a) && !isNaN(b) && b < a ? "flash-down" : "flash-up");
    }
  });
}

function stat(k, html, sub, big) {
  return `<div class="${big ? "big" : ""}"><div class="k">${k}</div><div class="v">${html}</div><div class="s">${sub || ""}</div></div>`;
}

function render() {
  const bots = data.bots || {}, keys = Object.keys(bots);
  if (view !== "combined" && !bots[view]) view = "combined";
  renderTabs(bots, keys);
  const shown = view === "combined" ? keys.map(k => bots[k]) : [bots[view]];
  const head = view === "combined" ? data.combined : bots[view];
  const modes = keys.length ? [...new Set(shown.map(b => b.mode))] : ["NO BOTS"];
  $("mode").innerHTML = `<span class="dot"></span>${esc(modes.join(" + "))}`;
  $("mode").className = "pill " + (modes.every(m => m === "PAPER") ? "paper" : "offline");

  // ---- hero numbers
  const pf = head.profit_factor, pv = view;
  $("hero").innerHTML =
    stat("Equity", N(pv + "eq", head.equity_usd, "money"), `started at ${money(head.bankroll_usd)}`, true) +
    stat("All-time P&amp;L", N(pv + "pnl", head.pnl_all_usd, "moneys", cls(head.pnl_all_usd)), head.bankroll_usd ? pct(head.pnl_all_usd / head.bankroll_usd * 100) + " on bankroll" : "") +
    stat("Today (UTC)", N(pv + "today", head.pnl_today_usd, "moneys", cls(head.pnl_today_usd)), "realised") +
    stat("Win rate", N(pv + "wr", head.win_rate, "ratio"), `${head.closed_trades} closed trades`) +
    stat("Profit factor", N(pv + "pf", pf, "pf", pf == null ? "" : pf >= 1 ? "up" : "down"), "gross win / gross loss") +
    stat("Max drawdown", N(pv + "dd", head.max_drawdown_usd || 0, "dd", head.max_drawdown_usd ? "down" : ""), "peak to trough");

  ["copybot", "scanbot"].forEach(k => renderBot(k, bots[k], view === "combined" || view === k));
  renderChart(bots, keys);
  renderPositions(shown);
  renderFeed();
  renderGate(bots.copybot);
  renderRisk(shown);
  renderLeaders((bots.copybot || {}).leaders || []);
  renderTrades(shown);

  $("foot").innerHTML = `Read-only. ${keys.length ? "Paper trading unless the mode badge says otherwise. " : ""}` +
    (UNIT === "$" ? "Amounts are US dollars; nothing is converted." : `<b>Amounts are US dollars shown with the label ${esc(UNIT)}; nothing is converted (1 ${esc(UNIT)} here = $1).</b>`) +
    ` Times are in your local time zone. The page checks for new data every ${REFRESH_MS / 1000}s. Not financial advice.`;

  animateNumbers(document); flashChanged(document);
  firstRender = false; countUp = false;
  tick();
}

function renderTabs(bots, keys) {
  const tabs = [["combined", "Combined"]].concat(keys.map(k => [k, bots[k].name]));
  $("tabs").innerHTML = `<span class="glider"></span>` + tabs.map(([k, n]) => `<button role="tab" aria-selected="${k === view}" data-view="${esc(k)}">${esc(n)}</button>`).join("");
  requestAnimationFrame(() => { const b = $("tabs").querySelector('[aria-selected="true"]'), g = $("tabs").querySelector(".glider");
    if (b && g) { g.style.left = b.offsetLeft + "px"; g.style.width = b.offsetWidth + "px"; } });
}

function statusOf(b) {
  const st = b.status || {}, age = secondsSince(b.health && b.health.heartbeat_at);
  if (st.running === false) return ["down", "STOPPED"];
  if (age != null && age > (data.stale_after_s || 1200)) return ["down", "NO HEARTBEAT"];
  if (b.kill && b.kill.paused) return ["pause", "PAUSED · " + b.kill.paused.replace(/_/g, " ")];
  return ["run", "RUNNING"];
}

function renderBot(key, b, visible) {
  const el = $("bot-" + key);
  if (!b) { el.style.display = "none"; return; }
  el.style.display = visible ? "" : "none";
  const [sc, label] = statusOf(b), st = b.status || {}, h = b.health || {}, k = b.kill || {};
  const last = key === "copybot"
    ? ["Last signal", st.last_signal_at ? `<span data-ago="${esc(st.last_signal_at)}">${ago(secondsSince(st.last_signal_at))}</span> ago` : "--"]
    : ["Last cycle", st.last_cycle ? `<span data-ago="${esc(st.last_cycle.at)}">${ago(secondsSince(st.last_cycle.at))}</span> ago` : "--"];
  const third = key === "copybot"
    ? ["Leader refresh", st.last_refresh ? `<span data-ago="${esc(st.last_refresh.at)}">${ago(secondsSince(st.last_refresh.at))}</span> ago · ${st.last_refresh.kept.length} kept` : "--"]
    : ["Cycle", st.last_cycle ? esc(relabel(st.last_cycle.text.replace("cycle done: ", "").replace("day PL", "day P&L"))) : "--"];
  const lossUse = k.max_consecutive_losses ? Math.min(100, k.consecutive_losses / k.max_consecutive_losses * 100) : 0;
  el.innerHTML = `<div class="bot">
      <div><div class="name">${esc(b.name)} <span class="status ${sc}"><span class="dot ${sc === "run" ? "pulse" : ""}"></span>${esc(label)}</span></div>
        <div class="s">${esc(b.mode)} · bankroll ${money(b.bankroll_usd)} · ${esc(h.stream_source || "poll")} feed ${h.stream_ok == null ? "" : h.stream_ok ? '<span class="up">ok</span>' : '<span class="down">stale</span>'}</div></div>
      <div><div class="eq">${N(key + "beq", b.equity_usd, "money")}</div><div class="s" style="text-align:right">${N(key + "bpnl", b.pnl_all_usd, "moneys", cls(b.pnl_all_usd))} all-time</div></div>
      <div class="spark" id="spark-${key}"></div>
      <div class="facts">
        <div class="fact"><div class="k">Heartbeat</div><div class="x"><span data-ago="${esc(h.heartbeat_at || "")}">${ago(secondsSince(h.heartbeat_at))}</span> ago</div></div>
        <div class="fact"><div class="k">${last[0]}</div><div class="x">${last[1]}</div></div>
        <div class="fact"><div class="k">${third[0]}</div><div class="x" title="${st.last_refresh ? esc(st.last_refresh.kept.join(", ")) : ""}">${third[1]}</div></div>
        <div class="fact"><div class="k">Loss streak</div><div class="x"><span data-k="${key}ls">${k.consecutive_losses ?? 0} / ${k.max_consecutive_losses ?? "--"}</span></div>
          <div class="meter"><div class="${lossUse >= 66 ? "hot" : ""}" style="width:${lossUse}%"></div></div></div>
      </div></div>`;
  sparkline($("spark-" + key), b.bankroll_usd, b.equity_curve || [], SERIES[key]);
}

function sparkline(box, base, pts, color) {
  if (!box) return;
  const W = 600, H = 56, vals = [base, ...pts.map(p => p[1])];
  if (vals.length < 2) { box.innerHTML = '<div class="s" style="padding-top:18px">no closed trades yet</div>'; return; }
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const xy = vals.map((v, i) => [i / (vals.length - 1) * W, H - 4 - (v - lo) / span * (H - 8)]);
  const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const id = "sg" + Math.random().toString(36).slice(2, 7), baseY = H - 4 - (base - lo) / span * (H - 8);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="100%">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" x2="${W}" y1="${baseY}" y2="${baseY}" stroke="rgba(255,255,255,.12)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
    <path class="areafade" d="${d} L ${W} ${H} L 0 ${H} Z" fill="url(#${id})"/>
    <path class="${firstRender ? "draw" : ""}" d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" pathLength="1" style="--len:1"/>
    <circle cx="${xy[xy.length - 1][0]}" cy="${xy[xy.length - 1][1]}" r="3.5" fill="${color}"/></svg>`;
}

function renderChart(bots, keys) {
  const sets = [];
  if (view === "combined") {
    if ((data.combined.equity_curve || []).length) sets.push({ label: "combined", color: SERIES.combined, base: data.combined.bankroll_usd, pts: data.combined.equity_curve, fill: true });
    keys.forEach(k => sets.push({ label: bots[k].name, color: SERIES[k] || "#ccc", base: bots[k].bankroll_usd, pts: bots[k].equity_curve || [] }));
  } else {
    const b = bots[view];
    sets.push({ label: b.name, color: SERIES[view] || "#ccc", base: b.bankroll_usd, pts: b.equity_curve || [], fill: true });
    Object.entries(b.shadow || {}).forEach(([name, book], i) => sets.push({ label: "shadow: " + name, color: SHADOW_COLOURS[i % 3], base: b.bankroll_usd, pts: book.curve || [], dash: true }));
  }
  const usable = sets.filter(s => s.pts.length);
  $("curve-note").textContent = usable.length ? "after fees, by closed trade" + (view !== "combined" && Object.keys(bots[view].shadow || {}).length ? "; dashed = shadow books (never traded)" : "") : "starts with the first closed trade";
  $("legend").innerHTML = usable.map(s => `<span><i style="background:${s.color};${s.dash ? "opacity:.7" : ""}"></i>${esc(s.label)}</span>`).join("");
  const box = $("chart");
  if (!usable.length) { box.innerHTML = '<div class="empty">No closed trades yet.</div>'; return; }
  const W = Math.max(320, box.clientWidth || 800), H = box.clientHeight || 300, L = 52, R = 12, T = 10, B = 24;
  const all = usable.flatMap(s => s.pts.map(p => [Date.parse(p[0]), p[1]]));
  const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])) || x0 + 1;
  let y0 = Math.min(...all.map(p => p[1]), ...usable.map(s => s.base)), y1 = Math.max(...all.map(p => p[1]), ...usable.map(s => s.base));
  const pad = (y1 - y0) * .08 || 1; y0 -= pad; y1 += pad;
  const X = t => L + (t - x0) / ((x1 - x0) || 1) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  let g = "";
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v);
    g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 8}" y="${y + 3}" text-anchor="end">${esc(cur(v.toFixed(v < 100 ? 1 : 0)))}</text>`; }
  for (let i = 0; i <= 4; i++) { const t = x0 + (x1 - x0) * i / 4;
    g += `<text x="${X(t)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${esc(new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) + " " + new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</text>`; }
  let lines = "", defs = "";
  usable.forEach((s, i) => {
    const pts = s.pts.map(p => [X(Date.parse(p[0])), Y(p[1])]);
    const d = pts.map((p, j) => (j ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    if (s.fill) { defs += `<linearGradient id="cg${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
      lines += `<path class="${firstRender ? "areafade" : ""}" d="${d} L ${pts[pts.length - 1][0]} ${H - B} L ${pts[0][0]} ${H - B} Z" fill="url(#cg${i})"/>`; }
    lines += `<path class="${firstRender ? "draw" : ""}" d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.fill ? 2.4 : 1.6}" ${s.dash ? 'stroke-dasharray="5 4" opacity=".8"' : ""} pathLength="1" style="--len:1;${s.dash ? "animation:none;stroke-dashoffset:0" : ""}" stroke-linejoin="round"/>`;
    const lp = pts[pts.length - 1];
    lines += `<circle cx="${lp[0]}" cy="${lp[1]}" r="4" fill="${s.color}"><animate attributeName="r" values="3.5;6;3.5" dur="2s" repeatCount="indefinite"/></circle>`;
  });
  const baseY = Y(usable[0].base);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${defs}</defs>${g}
    <line x1="${L}" x2="${W - R}" y1="${baseY}" y2="${baseY}" stroke="rgba(255,255,255,.22)" stroke-dasharray="3 5"/>${lines}
    <line id="hair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.25)" opacity="0"/></svg><div class="tip" id="tip"></div>`;
  const svg = box.querySelector("svg"), tip = $("tip"), hair = $("hair");
  svg.addEventListener("mousemove", ev => {
    const r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) / r.width * W;
    const t = x0 + (mx - L) / (W - L - R) * (x1 - x0);
    const rows = usable.map(s => { let best = null; for (const p of s.pts) { const pt = Date.parse(p[0]); if (pt <= t + 1) best = p; } return best ? [s, best] : null; }).filter(Boolean);
    if (!rows.length) { tip.style.opacity = 0; hair.setAttribute("opacity", 0); return; }
    hair.setAttribute("x1", mx); hair.setAttribute("x2", mx); hair.setAttribute("opacity", 1);
    tip.innerHTML = `<div class="muted">${esc(localStamp(rows[0][1][0]))}</div>` + rows.map(([s, p]) => `<div><span style="color:${s.color}">●</span> ${esc(s.label)}: <b>${esc(money(p[1]))}</b></div>`).join("");
    tip.style.opacity = 1; tip.style.left = Math.min(r.width - 220, Math.max(0, ev.clientX - r.left + 14)) + "px"; tip.style.top = "8px";
  });
  svg.addEventListener("mouseleave", () => { tip.style.opacity = 0; hair.setAttribute("opacity", 0); });
}

function renderPositions(shown) {
  const pos = shown.flatMap(b => b.open_positions.map(p => ({ ...p, bot: b.name })));
  $("pos-note").textContent = pos.length + " open · live P&L at last mark";
  $("positions").innerHTML = pos.length ? `<div class="posgrid">` + pos.map(p => {
    const lo = p.stop || 0, hi = p.target || 0, span = hi - lo, where = v => span > 0 ? Math.max(0, Math.min(100, (v - lo) / span * 100)) : 50;
    const upl = p.pnl_pct != null && p.size_usd != null ? p.size_usd * (p.fraction_left ?? 1) * p.pnl_pct / 100 : null;
    const key = esc(p.bot + p.mint_short);
    return `<div class="pos ${p.pnl_pct > 0 ? "win" : p.pnl_pct < 0 ? "loss" : ""}">
      <div class="top"><span class="tk">${esc(p.ticker || p.mint_short)}</span><span class="pp ${cls(p.pnl_pct)}" data-k="pp${key}">${pct(p.pnl_pct, 2)}</span></div>
      <div class="sub"><span>${esc(p.bot)} · ${esc(p.leader)} · <span class="mono">${esc(p.mint_short)}</span></span><span class="mono ${cls(upl)}" data-k="pu${key}">${upl == null ? "" : money(upl, true)}</span></div>
      <div class="range" title="stop → target"><span class="en" style="left:${where(p.entry)}%"></span><span class="mk" style="left:${where(p.mark)}%"></span></div>
      <div class="rl"><span class="down">stop ${price(p.stop)}</span><span>mark <span data-k="pm${key}">${price(p.mark)}</span></span><span class="up">tp ${price(p.target)}</span></div>
      <div class="sub" style="margin-top:8px"><span>size ${money(p.size_usd)}${p.fraction_left != null && p.fraction_left < 1 ? ` · ${Math.round(p.fraction_left * 100)}% left` : ""}</span>
        <span>held <span data-ago="${esc(p.opened_at || "")}">${ago(secondsSince(p.opened_at))}</span></span></div></div>`; }).join("") + "</div>"
    : '<div class="empty">Flat: no open positions right now.</div>';
}

function eventKey(e) { return [e.at, e.bot, e.kind, e.text].join("|"); }

function renderFeed() {
  const events = (data.events || []).filter(e => view === "combined" || e.bot === view);
  const names = Object.fromEntries(Object.entries(data.bots || {}).map(([k, b]) => [k, b.name]));
  const counts = { all: events.length };
  events.forEach(e => { const g = GROUP[e.kind] || "system"; counts[g] = (counts[g] || 0) + 1; });
  $("filters").innerHTML = FILTERS.map(([k, n]) => `<button class="chip" data-filter="${k}" aria-pressed="${k === feedFilter}">${n} <span class="dim">${counts[k] || 0}</span></button>`).join("");
  const list = events.filter(e => feedFilter === "all" || (GROUP[e.kind] || "system") === feedFilter);
  const latest = events[0];
  $("feed-note").innerHTML = latest ? `latest <span data-ago="${esc(latest.at)}">${ago(secondsSince(latest.at))}</span> ago` : "what the bots just did";
  const hadSeen = seenEvents.size > 0;
  $("feed").innerHTML = list.length ? list.map((e, i) => {
    const k = eventKey(e), isNew = hadSeen && !seenEvents.has(k);
    const pnlCls = e.pnl_usd == null ? "" : e.pnl_usd > 0 ? "win" : e.pnl_usd < 0 ? "loss" : "";
    return `<li class="${isNew || (firstRender && i < 8) ? "new" : ""}" style="${firstRender ? `animation-delay:${i * 60}ms` : ""}">
      <div class="t"><b>${esc(localTime(e.at).replace(/:\d\d(?=\s|$)/, ""))}</b><span data-ago="${esc(e.at)}">${ago(secondsSince(e.at))}</span></div>
      <div class="m"><div class="meta"><span class="kind ${esc(e.kind)} ${pnlCls}">${esc(e.kind)}</span><span class="botchip">${esc(names[e.bot] || e.bot)}</span>
        ${e.count > 1 ? `<span class="count">×${e.count}</span>` : ""}${e.latency_s != null && e.kind === "SKIP" ? `<span class="count dim">${e.latency_s}s after leader</span>` : ""}
        ${e.pnl_usd != null && e.kind !== "SKIP" ? `<span class="count ${cls(e.pnl_usd)}">${money(e.pnl_usd, true)}</span>` : ""}</div>
        ${esc(relabel(e.text))}</div></li>`; }).join("") : '<li class="empty">Nothing in this filter yet.</li>';
  events.forEach(e => seenEvents.add(eventKey(e)));
}

function ring(value, need, label, text, color) {
  const r = 30, c = 2 * Math.PI * r, f = need ? Math.max(0, Math.min(1, value / need)) : value ? 1 : 0;
  return `<div><svg class="ring" viewBox="0 0 74 74"><circle class="bgc" cx="37" cy="37" r="${r}"/>
    <circle class="fg" cx="37" cy="37" r="${r}" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${firstRender ? c : c * (1 - f)}" data-off="${c * (1 - f)}"/>
    <text x="37" y="37">${esc(text)}</text></svg><div class="lbl">${label}</div></div>`;
}

function renderGate(cb) {
  const g = cb && cb.gate;
  if (!g) { $("gate").innerHTML = '<div class="empty">The gate applies to copybot.</div>'; return; }
  const pfOk = g.profit_factor != null && g.profit_factor > g.need_profit_factor;
  const passed = g.closed_trades >= g.need_trades && pfOk && g.walk_forward_pass && g.go_ahead_present;
  $("gate").innerHTML = `<div class="rings">
      ${ring(g.closed_trades, g.need_trades, `Closed trades<br><span class="dim">${g.closed_trades} / ${g.need_trades}</span>`, Math.round(Math.min(1, g.closed_trades / g.need_trades) * 100) + "%", g.closed_trades >= g.need_trades ? "var(--up)" : "var(--cyan)")}
      ${ring(g.profit_factor || 0, g.need_profit_factor, `Profit factor<br><span class="dim">need &gt; ${g.need_profit_factor}</span>`, g.profit_factor == null ? "--" : g.profit_factor.toFixed(2), pfOk ? "var(--up)" : "var(--down)")}
      ${ring(g.walk_forward_pass ? 1 : 0, 1, `Walk-forward<br><span class="dim">${g.oos_profit_factor == null ? "not run" : "OOS " + g.oos_profit_factor.toFixed(2)}</span>`, g.walk_forward_pass ? "✓" : "✗", g.walk_forward_pass ? "var(--up)" : "var(--down)")}
      ${ring(g.go_ahead_present ? 1 : 0, 1, `Go-ahead file<br><span class="dim">your sign-off</span>`, g.go_ahead_present ? "✓" : "✗", g.go_ahead_present ? "var(--up)" : "var(--down)")}
    </div><div class="verdict ${passed ? "yes" : "no"}">${passed ? "GATE PASSED" : "Gate not passed · paper only"}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => $("gate").querySelectorAll(".fg").forEach(c => c.setAttribute("stroke-dashoffset", c.dataset.off))));
}

function renderRisk(shown) {
  $("risk").innerHTML = shown.map(b => { const k = b.kill, h = b.health, a = b.actions, l = b.limits || {};
    const used = k.daily_limit_usd ? Math.min(100, Math.max(0, k.daily_pnl_usd / k.daily_limit_usd * 100)) : 0;
    return `<div class="row"><b>${esc(b.name)}</b><span class="${k.paused ? "warn" : "up"}">${k.paused ? "PAUSED: " + esc(k.paused.replace(/_/g, " ")) + " · resumes " + esc(k.resumes) : "kill switch armed, not tripped"}</span></div>
      <div class="row"><span class="muted">today vs daily loss limit</span><span class="mono" data-k="${esc(b.name)}dl">${money(k.daily_pnl_usd, true)} / ${money(k.daily_limit_usd)}</span></div>
      <div class="meter"><div class="${used >= 75 ? "hot" : ""}" style="width:${used}%"></div></div>
      <div class="row"><span class="muted">stream</span><span class="mono">${esc(h.stream_source || "--")} ${h.stream_ok == null ? "" : h.stream_ok ? '<span class="up">ok</span>' : '<span class="down">stale</span>'}${h.p95_detection_ms != null ? ` · detection p95 ${(h.p95_detection_ms / 1000).toFixed(1)}s` : ""}${h.rpc_429_share != null ? ` · 429s ${(h.rpc_429_share * 100).toFixed(1)}%` : ""}</span></div>
      <div class="row"><span class="muted">limits</span><span class="mono">stop ${l.stop_pct ?? "--"}% · tp ${l.first_target_pct ?? "--"}%${l.trail_pct ? ` · trail ${l.trail_pct}%` : ""} · max ${l.max_positions ?? "--"} pos · ${l.max_hold_h ?? "--"}h hold</span></div>
      ${a ? `<div class="row"><span class="muted">actions / fills reported</span><span class="mono">${Object.entries(a.by_status).map(([s, v]) => esc(s) + " " + v).join(", ") || "none"} / ${a.fills_reported}</span></div>` : ""}`; }).join('<div style="height:14px"></div>') || '<div class="empty">no bot data</div>';
}

function renderLeaders(leaders) {
  const order = { copy: 0, active: 0, watch: 1, paused: 2, decayed: 3, untracked: 4, rejected: 5 };
  const sorted = [...leaders].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4) || (b.skill_score ?? 0) - (a.skill_score ?? 0));
  const live = sorted.filter(l => l.status !== "rejected"), hidden = sorted.length - live.length;
  const rows = showRejected ? sorted : live;
  $("leaders").innerHTML = rows.length || hidden ? `<table><thead><tr><th>Leader</th><th class="l">Wallet</th><th class="l">Status</th><th>Skill</th><th>Copyability</th><th>Copied</th><th>Our P&amp;L</th><th class="l">Note</th></tr></thead><tbody>` +
    rows.map(l => `<tr><td class="t"><b>${esc(l.label)}</b></td><td class="l muted">${esc(l.wallet_short)}</td><td class="l"><span class="tag ${esc(l.status)}">${esc(l.status)}</span></td>
      <td>${bar(l.skill_score)}</td><td>${bar(l.copyability_score)}</td><td>${l.copier_trades}</td>
      <td class="${cls(l.copier_pnl_usd)}">${money(l.copier_pnl_usd, true)}</td><td class="l t muted" style="white-space:normal;min-width:220px">${esc(relabel(l.note))}</td></tr>`).join("") +
    `</tbody></table>` + (hidden ? `<div style="padding:10px"><button class="toggle" id="toggle-rejected">${showRejected ? "Hide" : "Show"} ${hidden} rejected</button></div>` : "")
    : '<div class="empty">No leaders tracked yet.</div>';
}
const bar = v => v == null ? "--" : `<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:54px;height:5px;border-radius:9px;background:rgba(255,255,255,.07);overflow:hidden;display:inline-block"><span style="display:block;height:100%;width:${Math.max(0, Math.min(100, v))}%;background:linear-gradient(90deg,var(--cyan),var(--violet))"></span></span>${v}</span>`;

function renderTrades(shown) {
  const rows = shown.flatMap(b => b.trades.map(t => ({ ...t, bot: b.name })));
  rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey];
    return (x == null) - (y == null) || (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir; });
  const cols = [["closed_at", "Closed", 1], ["ticker", "Token", 1], ["leader", "Leader", 1], ["reason", "Exit", 1], ["entry", "Entry"], ["exit", "Exit px"],
                ["size_usd", "Size"], ["fees_usd", "Fees"], ["slippage_pct", "Slip"], ["pnl_usd", "P&amp;L"], ["pnl_pct", "%"], ["bot", "Bot", 1]];
  $("trades").innerHTML = rows.length ? "<table><thead><tr>" + cols.map(([k, n, left]) =>
      `<th data-sort="${k}" class="${left ? "l" : ""}" ${k === sortKey ? `aria-sort="${sortDir > 0 ? "ascending" : "descending"}"` : ""}>${n}${k === sortKey ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr></thead><tbody>" +
    rows.slice(0, 50).map(t => `<tr><td>${esc(localStamp(t.closed_at))}</td><td class="l t"><b>${esc(t.ticker)}</b> <span class="dim mono">${esc(t.mint_short)}</span></td>
      <td class="l t">${esc(t.leader)}</td><td class="l t muted">${esc(t.reason)}</td><td>${price(t.entry)}</td><td>${price(t.exit)}</td>
      <td>${money(t.size_usd)}</td><td>${money(t.fees_usd)}</td><td>${t.slippage_pct == null ? "--" : t.slippage_pct.toFixed(2) + "%"}</td>
      <td class="${cls(t.pnl_usd)}"><b>${money(t.pnl_usd, true)}</b></td><td class="${cls(t.pnl_pct)}">${pct(t.pnl_pct)}</td><td class="l t muted">${esc(t.bot)}</td></tr>`).join("") + "</tbody></table>"
    : '<div class="empty">No closed trades yet.</div>';
}

$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (b && data) { view = b.dataset.view; prevNums.clear(); countUp = true; render(); } });
$("filters").addEventListener("click", e => { const b = e.target.closest("button[data-filter]"); if (b && data) { feedFilter = b.dataset.filter; renderFeed(); } });
$("leaders").addEventListener("click", e => { if (e.target.id === "toggle-rejected" && data) { showRejected = !showRejected; renderLeaders((data.bots.copybot || {}).leaders || []); } });
$("trades").addEventListener("click", e => { const th = e.target.closest("th[data-sort]"); if (!th || !data) return;
  sortDir = th.dataset.sort === sortKey ? -sortDir : -1; sortKey = th.dataset.sort; renderTrades(view === "combined" ? Object.values(data.bots) : [data.bots[view]]); });
let resizeT; addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => data && renderChart(data.bots, Object.keys(data.bots)), 200); });
load();
setInterval(load, REFRESH_MS);
setInterval(tick, 1000);                                   // keep "X s ago", the offline badge and countdowns honest between fetches
