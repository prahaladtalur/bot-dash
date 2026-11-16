// ---------------------------------------------------------------------------------------------
// DISPLAY UNIT. Every amount in dashboard.json is US dollars (fields end in _usd). This constant
// only changes the LABEL printed next to a number. Nothing is converted: 1 displayed ETH = $1.
// Set it to "$" to show real units.
const UNIT = "ETH";
// ---------------------------------------------------------------------------------------------

const REFRESH_MS = 60_000;
const $ = id => document.getElementById(id);
// Token names and labels are untrusted text: everything that reaches innerHTML goes through esc().
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cur = t => UNIT === "$" ? "$" + t : t + " " + UNIT;
// The same relabel for free text written by the bot (e.g. a leader note saying "net $-1.16").
const relabel = t => UNIT === "$" ? String(t ?? "") : String(t ?? "").replace(/\$\s?([+-]?\d[\d,.]*)/g, "$1 " + UNIT);
const money = (v, sign = false) => v == null ? "--" : (v < 0 ? "-" : sign ? "+" : "") + cur(Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (v, d = 1) => v == null ? "--" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
const cls = v => v == null || v === 0 ? "muted" : v > 0 ? "up" : "down";
const price = v => !v ? "--" : v >= 1 ? v.toFixed(3) : v.toPrecision(4);
const ago = s => s == null ? "--" : s < 90 ? Math.round(s) + "s" : s < 5400 ? Math.round(s / 60) + " min" : s < 172800 ? (s / 3600).toFixed(1) + " h" : Math.round(s / 86400) + " d";
const secondsSince = iso => iso ? (Date.now() - Date.parse(iso)) / 1000 : null;
// Categorical series colours (never red/green: those mean profit and loss).
const SERIES = { combined: "#d2dbe8", copybot: "#4cc9f0", scanbot: "#ffb000" };
const SHADOW_COLOURS = ["#c084fc", "#9aa7bd", "#f472b6"];

let data = null, view = "combined", chart = null, sortKey = "closed_at", sortDir = -1;

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
  try {
    const res = await fetch(dataUrl() + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
    render();
  } catch (e) {
    $("fresh").className = "badge offline";
    $("fresh").textContent = data ? "CANNOT REFRESH" : "NO DATA YET";
    $("updated").textContent = "could not load dashboard.json (" + e.message + ")";
  }
}

function freshness() {
  if (!data) return;
  const age = secondsSince(data.generated_at), stale = age > (data.stale_after_s || 1200);
  $("fresh").className = "badge " + (stale ? "offline" : "live");
  $("fresh").textContent = stale ? "BOT OFFLINE / HOST ASLEEP" : "LIVE DATA";
  $("updated").textContent = "last updated " + ago(age) + " ago";
}

function stat(k, v, c, sub, big) {
  return `<div class="${big ? "big" : ""}"><div class="k">${k}</div><div class="v num ${c || ""}">${v}</div><div class="s">${sub || ""}</div></div>`;
}

function render() {
  const bots = data.bots || {}, keys = Object.keys(bots);
  if (view !== "combined" && !bots[view]) view = "combined";
  const tabs = [["combined", "Combined"]].concat(keys.map(k => [k, bots[k].name]));
  $("tabs").innerHTML = tabs.map(([k, n]) => `<button role="tab" aria-selected="${k === view}" data-view="${esc(k)}">${esc(n)}</button>`).join("");
  const shown = view === "combined" ? keys.map(k => bots[k]) : [bots[view]];
  const head = view === "combined" ? data.combined : bots[view];

  $("mode").textContent = keys.length ? [...new Set(shown.map(b => b.mode))].join(" + ") : "NO BOTS";
  freshness();

  // ---- header numbers
  const pf = head.profit_factor;
  $("hero").innerHTML =
    stat("EQUITY", money(head.equity_usd), "", `started at ${money(head.bankroll_usd)}`, true) +
    stat("ALL-TIME P&L", money(head.pnl_all_usd, true), cls(head.pnl_all_usd), head.bankroll_usd ? pct(head.pnl_all_usd / head.bankroll_usd * 100) + " on bankroll" : "") +
    stat("TODAY (UTC)", money(head.pnl_today_usd, true), cls(head.pnl_today_usd), "realised") +
    stat("WIN RATE", head.win_rate == null ? "--" : Math.round(head.win_rate * 100) + "%", "", `${head.closed_trades} closed trades`) +
    stat("PROFIT FACTOR", pf == null ? "--" : pf.toFixed(2), pf == null ? "" : pf >= 1 ? "up" : "down", "gross win / gross loss") +
    stat("MAX DRAWDOWN", head.max_drawdown_usd ? "-" + cur(head.max_drawdown_usd.toFixed(2)) : cur("0.00"), head.max_drawdown_usd ? "down" : "", "peak to trough");

  // ---- kill switch
  $("kill").innerHTML = shown.map(b => { const k = b.kill, used = k.daily_limit_usd ? Math.min(100, Math.max(0, k.daily_pnl_usd / k.daily_limit_usd * 100)) : 0;
    return `<div class="row"><b>${esc(b.name)}</b><span class="${k.paused ? "down" : "up"}">${k.paused ? "PAUSED: " + esc(k.paused) : "armed, not tripped"}</span></div>
      ${k.paused ? `<div class="row"><span class="muted">resumes</span><span>${esc(k.resumes)}</span></div>` : ""}
      <div class="row"><span class="muted">today vs daily limit</span><span class="num">${money(k.daily_pnl_usd, true)} / ${money(k.daily_limit_usd)}</span></div>
      <div class="meter"><div class="${used >= 75 ? "hot" : ""}" style="width:${used}%"></div></div>
      <div class="row"><span class="muted">losses in a row</span><span class="num">${k.consecutive_losses} / ${k.max_consecutive_losses}</span></div>`; }).join("<br>") || '<div class="empty">no bot data</div>';

  // ---- open positions
  const pos = shown.flatMap(b => b.open_positions.map(p => ({ ...p, bot: b.name })));
  $("pos-note").textContent = pos.length + " open";
  $("positions").innerHTML = pos.length ? `<table><thead><tr><th>TOKEN</th><th class="l">MINT</th><th>ENTRY</th><th>MARK</th><th>P&amp;L</th><th>STOP</th><th>TARGET</th><th>HELD</th><th class="l">LEADER</th><th class="l">BOT</th></tr></thead><tbody>` +
    pos.map(p => `<tr><td><b>${esc(p.ticker)}</b></td><td class="l muted">${esc(p.mint_short)}</td><td class="num">${price(p.entry)}</td><td class="num">${price(p.mark)}</td>
      <td class="num ${cls(p.pnl_pct)}">${pct(p.pnl_pct)}</td><td class="num">${price(p.stop)}</td><td class="num">${price(p.target)}</td>
      <td class="num">${ago(secondsSince(p.opened_at))}</td><td class="l">${esc(p.leader)}</td><td class="l muted">${esc(p.bot)}</td></tr>`).join("") + "</tbody></table>"
    : '<div class="empty">Flat: no open positions.</div>';

  // ---- gate (copybot only)
  const g = (bots.copybot || {}).gate;
  const tick = ok => ok ? '<span class="up">yes</span>' : '<span class="down">no</span>';
  $("gate").innerHTML = g ? `
    <div class="row"><span>Closed trades</span><span class="num">${g.closed_trades} / ${g.need_trades}</span></div>
    <div class="meter"><div class="${g.closed_trades >= g.need_trades ? "done" : ""}" style="width:${Math.min(100, g.closed_trades / g.need_trades * 100)}%"></div></div>
    <div class="row"><span>Profit factor</span><span class="num ${g.profit_factor != null && g.profit_factor > g.need_profit_factor ? "up" : "down"}">${g.profit_factor == null ? "--" : g.profit_factor.toFixed(2)} / ${g.need_profit_factor}</span></div>
    <div class="row"><span>Walk-forward pass</span><span>${tick(g.walk_forward_pass)} <span class="muted num">${g.oos_profit_factor == null ? "not run" : "OOS " + g.oos_profit_factor.toFixed(2) + " over " + g.oos_trades}</span></span></div>
    <div class="row"><span>Go-ahead file present</span><span>${tick(g.go_ahead_present)}</span></div>
    <div class="row"><b>Gate</b><b class="${g.closed_trades >= g.need_trades && g.profit_factor > g.need_profit_factor && g.walk_forward_pass && g.go_ahead_present ? "up" : "warn"}">${g.closed_trades >= g.need_trades && g.profit_factor > g.need_profit_factor && g.walk_forward_pass && g.go_ahead_present ? "PASSED" : "NOT PASSED: paper only"}</b></div>`
    : '<div class="empty">The gate applies to copybot.</div>';

  // ---- leaders
  const leaders = (bots.copybot || {}).leaders || [];
  $("leaders").innerHTML = leaders.length ? `<table><thead><tr><th>LEADER</th><th class="l">WALLET</th><th class="l">STATUS</th><th>SKILL</th><th>COPYABILITY</th><th>COPIED TRADES</th><th>OUR P&amp;L</th><th class="l">NOTE</th></tr></thead><tbody>` +
    leaders.map(l => `<tr><td><b>${esc(l.label)}</b></td><td class="l muted">${esc(l.wallet_short)}</td><td class="l"><span class="tag ${esc(l.status)}">${esc(l.status)}</span></td>
      <td class="num">${l.skill_score ?? "--"}</td><td class="num">${l.copyability_score ?? "--"}</td><td class="num">${l.copier_trades}</td>
      <td class="num ${cls(l.copier_pnl_usd)}">${money(l.copier_pnl_usd, true)}</td><td class="l muted">${esc(relabel(l.note))}</td></tr>`).join("") + "</tbody></table>"
    : '<div class="empty">No leaders tracked yet.</div>';

  // ---- health
  $("health").innerHTML = shown.map(b => { const h = b.health, age = secondsSince(h.heartbeat_at), a = b.actions;
    return `<div class="row"><b>${esc(b.name)}</b><span class="${age != null && age < 300 ? "up" : "warn"}">heartbeat ${ago(age)} ago</span></div>
      <div class="row"><span class="muted">stream</span><span>${esc(h.stream_source || "--")} ${h.stream_ok == null ? "" : h.stream_ok ? '<span class="up">ok</span>' : '<span class="down">stale</span>'}</span></div>
      <div class="row"><span class="muted">failed hints</span><span class="num ${h.failed_hints ? "down" : ""}">${h.failed_hints}</span></div>
      ${h.p95_detection_ms != null ? `<div class="row"><span class="muted">detection p95</span><span class="num">${(h.p95_detection_ms / 1000).toFixed(1)}s</span></div>` : ""}
      ${a ? `<div class="row"><span class="muted">actions</span><span class="num">${Object.entries(a.by_status).map(([k, v]) => esc(k) + " " + v).join(", ") || "none"}</span></div>
             <div class="row"><span class="muted">fills reported</span><span class="num">${a.fills_reported}</span></div>` : ""}`; }).join("<br>") || '<div class="empty">no bot data</div>';

  renderTrades(shown);
  renderChart(bots, keys);
  $("foot").innerHTML = `Read-only. ${keys.length ? "Paper trading unless the mode badge says otherwise. " : ""}` +
    (UNIT === "$" ? "Amounts are US dollars." : `<b>Amounts are US dollars shown with the label ${esc(UNIT)}; nothing is converted (1 ${esc(UNIT)} here = $1).</b>`) +
    " Not financial advice.";
}

function renderTrades(shown) {
  const rows = shown.flatMap(b => b.trades.map(t => ({ ...t, bot: b.name })));
  rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey];
    return (x == null) - (y == null) || (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir; });
  const cols = [["closed_at", "CLOSED UTC", 1], ["ticker", "TOKEN", 1], ["leader", "LEADER", 1], ["reason", "EXIT", 1], ["entry", "ENTRY"], ["exit", "EXIT PX"],
                ["size_usd", "SIZE"], ["fees_usd", "FEES"], ["slippage_pct", "SLIP"], ["pnl_usd", "P&amp;L"], ["pnl_pct", "%"], ["bot", "BOT", 1]];
  $("trades").innerHTML = rows.length ? "<table><thead><tr>" + cols.map(([k, n, left]) =>
      `<th data-sort="${k}" class="${left ? "l" : ""}" ${k === sortKey ? `aria-sort="${sortDir > 0 ? "ascending" : "descending"}"` : ""}>${n}${k === sortKey ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr></thead><tbody>" +
    rows.slice(0, 50).map(t => `<tr><td class="num">${esc((t.closed_at || "").replace("T", " ").replace("Z", ""))}</td><td class="l"><b>${esc(t.ticker)}</b> <span class="muted">${esc(t.mint_short)}</span></td>
      <td class="l">${esc(t.leader)}</td><td class="l">${esc(t.reason)}</td><td class="num">${price(t.entry)}</td><td class="num">${price(t.exit)}</td>
      <td class="num">${money(t.size_usd)}</td><td class="num">${money(t.fees_usd)}</td><td class="num">${t.slippage_pct == null ? "--" : t.slippage_pct.toFixed(2) + "%"}</td>
      <td class="num ${cls(t.pnl_usd)}">${money(t.pnl_usd, true)}</td><td class="num ${cls(t.pnl_pct)}">${pct(t.pnl_pct)}</td><td class="l muted">${esc(t.bot)}</td></tr>`).join("") + "</tbody></table>"
    : '<div class="empty">No closed trades yet.</div>';
}

function renderChart(bots, keys) {
  const line = (label, pts, color, dash) => ({ label, data: pts.map(([t, v]) => ({ x: Date.parse(t), y: v })), borderColor: color, backgroundColor: color,
    borderWidth: 2, borderDash: dash || [], pointRadius: 0, pointHoverRadius: 4, tension: 0, stepped: false });
  const sets = [];
  for (const k of keys) {
    sets.push(line(bots[k].name, bots[k].equity_curve, SERIES[k] || "#d2dbe8"));
    Object.entries(bots[k].shadow || {}).forEach(([name, book], i) => sets.push(line("shadow: " + name, book.curve, SHADOW_COLOURS[i % 3], [5, 4])));
  }
  const usable = sets.filter(s => s.data.length);
  $("curve-note").textContent = usable.length ? "after fees, by closed trade; dashed = shadow books (never traded)" : "starts with the first closed trade";
  if (typeof Chart === "undefined") return;                // chart library blocked: the tables still work
  if (chart) chart.destroy();
  const grid = { color: "#18263b" }, ticks = { color: "#6b7c95", font: { family: "ui-monospace, Menlo, monospace", size: 10 } };
  chart = new Chart($("chart"), { type: "line", data: { datasets: usable },
    options: { animation: false, maintainAspectRatio: false, interaction: { mode: "nearest", intersect: false, axis: "x" },
      scales: { x: { type: "linear", grid, ticks: { ...ticks, maxTicksLimit: 6, callback: v => new Date(v).toISOString().slice(5, 16).replace("T", " ") } },
                y: { grid, ticks: { ...ticks, maxTicksLimit: 6, callback: v => cur(Number(v).toFixed(0)) } } },
      plugins: { legend: { labels: { color: "#d2dbe8", boxWidth: 14, boxHeight: 2, font: { family: "ui-monospace, Menlo, monospace", size: 11 } } },
        tooltip: { callbacks: { title: items => new Date(items[0].parsed.x).toISOString().slice(0, 16).replace("T", " ") + " UTC",
                                label: c => c.dataset.label + ": " + cur(c.parsed.y.toFixed(2)) } } } } });
}

$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (b && data) { view = b.dataset.view; render(); } });
$("trades").addEventListener("click", e => { const th = e.target.closest("th[data-sort]"); if (!th || !data) return;
  sortDir = th.dataset.sort === sortKey ? -sortDir : -1; sortKey = th.dataset.sort; render(); });
load();
setInterval(load, REFRESH_MS);
setInterval(freshness, 15_000);                            // keep "X min ago" and the offline badge honest between fetches
