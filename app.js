(function () {
  var cfg = window.PAPER_DASHBOARD_CONFIG || { apiBase: "", pollMs: 20000, displayBuild: "desk-visual-3" };
  var page = 1;
  var lastFetchMs = null;
  var lastState = null;
  var rangeId = "all";
  var hoverBound = false;
  var STORE = "paper-desk-observed-v1";

  function base() {
    var query = new URLSearchParams(location.search).get("api");
    if (query && /^https?:\/\//.test(query)) return query.replace(/\/$/, "");
    return String(cfg.apiBase || "").replace(/\/$/, "");
  }

  function text(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function pill(id, value) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = value;
    var kind = value === "ACTIVE" || value === "reachable" ? "good" : value === "STALE" || value === "DEGRADED" ? "warn" : "bad";
    node.className = "badge " + kind;
  }

  function dash(value) {
    return value == null || value === "" ? "—" : String(value);
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
    });
  }

  function field(label, value, tone) {
    return '<div class="field"><span>' + esc(label) + '</span><b class="tone-' + esc(tone || "neutral") + '">' + esc(value) + "</b></div>";
  }

  function toneNode(id, value, tone) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = value;
    node.className = "num tone-" + tone;
  }

  function pageFreshness(state) {
    if (!base()) return "unconfigured";
    if (lastFetchMs == null) return "cached";
    var health = (state && state.health) || {};
    var presence = window.PaperDashboard.classifyPresence(Date.now(), health.heartbeat_ms, health.status, lastFetchMs);
    if (presence === "ACTIVE") return "live";
    if (presence === "STALE") return "stale";
    return String(presence || "not-live").toLowerCase();
  }

  function table(headers, rows) {
    var head = "<tr>" + headers.map(function (item) { return "<th>" + item + "</th>"; }).join("") + "</tr>";
    var body = rows.map(function (row) {
      return "<tr>" + row.map(function (cell) { return "<td>" + cell + "</td>"; }).join("") + "</tr>";
    }).join("");
    return "<table>" + head + body + "</table>";
  }

  function accountId(state) {
    return (state && state.account && state.account.account_id) || "unknown";
  }

  function loadObserved(id) {
    try {
      var raw = localStorage.getItem(STORE + ":" + id);
      if (!raw) return { since: null, points: [] };
      var parsed = JSON.parse(raw);
      return {
        since: parsed && parsed.since ? parsed.since : null,
        points: parsed && Array.isArray(parsed.points) ? parsed.points : []
      };
    } catch (error) {
      return { since: null, points: [] };
    }
  }

  function remember(state) {
    var equity = state && state.account && state.account.equity;
    var heartbeat = state && state.health && state.health.heartbeat_ms;
    if (equity == null || equity === "" || !isFinite(Number(equity))) return loadObserved(accountId(state));
    var t = heartbeat == null ? Date.now() : Number(heartbeat);
    if (!isFinite(t)) return loadObserved(accountId(state));
    var id = accountId(state);
    var bag = loadObserved(id);
    if (!bag.since) bag.since = t;
    var next = bag.points.filter(function (point) { return Number(point.t) !== t; });
    next.push({ t: t, equity: String(equity) });
    next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    if (next.length > 500) next = next.slice(-500);
    bag.points = next;
    try {
      localStorage.setItem(STORE + ":" + id, JSON.stringify(bag));
    } catch (error) {
      return bag;
    }
    return bag;
  }

  function drawCurve(points) {
    var svg = document.getElementById("curve");
    var note = document.getElementById("chart-note");
    var model = window.PaperDashboard.chartModel(points);
    if (!svg) return model;
    if (!model.drawable) {
      svg.innerHTML = "";
      if (note) note.hidden = false;
      return model;
    }
    if (note) note.hidden = true;
    var rows = model.points;
    var values = rows.map(function (point) { return point.equity; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min;
    var pad = span === 0 ? Math.max(Math.abs(max) * 0.002, 0.01) : span * 0.08;
    var y0 = min - pad;
    var y1 = max + pad;
    var t0 = rows[0].t;
    var t1 = rows[rows.length - 1].t;
    function x(t) { return t1 === t0 ? 500 : 48 + ((t - t0) / (t1 - t0)) * 920; }
    function y(value) { return 18 + (1 - ((value - y0) / (y1 - y0))) * 230; }
    var d = rows.map(function (point, index) {
      return (index === 0 ? "M" : "L") + x(point.t).toFixed(1) + " " + y(point.equity).toFixed(1);
    }).join(" ");
    var dots = rows.map(function (point) {
      return '<circle cx="' + x(point.t).toFixed(1) + '" cy="' + y(point.equity).toFixed(1) + '" r="2.4" fill="#7dffe0" data-t="' + point.t + '" data-eq="' + point.equity + '"></circle>';
    }).join("");
    svg.innerHTML =
      '<line x1="48" y1="248" x2="968" y2="248" stroke="rgba(232,238,242,0.15)"></line>' +
      '<text class="axis" x="48" y="268">' + window.PaperDashboard.formatTime(t0) + "</text>" +
      '<text class="axis" x="760" y="268">' + window.PaperDashboard.formatTime(t1) + "</text>" +
      '<text class="axis" x="8" y="24">' + window.PaperDashboard.formatUsdc(y1) + "</text>" +
      '<text class="axis" x="8" y="244">' + window.PaperDashboard.formatUsdc(y0) + "</text>" +
      '<path d="' + d + '" fill="none" stroke="#7dffe0" stroke-width="2.4"></path>' +
      dots;
    if (!hoverBound) {
      hoverBound = true;
      svg.addEventListener("mousemove", function (event) {
        var rect = svg.getBoundingClientRect();
        var px = ((event.clientX - rect.left) / rect.width) * 1000;
        var circles = svg.querySelectorAll("circle");
        var best = null;
        var bestDist = Infinity;
        circles.forEach(function (circle) {
          var dist = Math.abs(Number(circle.getAttribute("cx")) - px);
          if (dist < bestDist) { bestDist = dist; best = circle; }
        });
        var tip = document.getElementById("tip");
        if (!tip || !best) return;
        tip.hidden = false;
        tip.style.display = "block";
        tip.style.left = Math.min(rect.width - 140, Math.max(8, event.clientX - rect.left + 12)) + "px";
        tip.style.top = "12px";
        tip.textContent = window.PaperDashboard.formatUsdc(best.getAttribute("data-eq")) + " · " + window.PaperDashboard.formatTime(best.getAttribute("data-t"));
      });
      svg.addEventListener("mouseleave", function () {
        var tip = document.getElementById("tip");
        if (tip) tip.style.display = "none";
      });
    }
    return model;
  }

  function renderRanges(points, nowMs) {
    var host = document.getElementById("ranges");
    if (!host) return;
    var choices = window.PaperDashboard.availableRanges(points, nowMs);
    if (!choices.some(function (choice) { return choice.id === rangeId && choice.enabled; })) rangeId = "all";
    host.innerHTML = choices.map(function (choice) {
      return '<button type="button" data-range="' + choice.id + '" aria-pressed="' + (choice.id === rangeId) + '"' + (choice.enabled ? "" : " disabled") + ">" + choice.id.toUpperCase() + "</button>";
    }).join("");
    host.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        rangeId = button.getAttribute("data-range");
        if (lastState) render(lastState);
      });
    });
  }

  function render(state) {
    var model = window.PaperDashboard.renderModel(state, Date.now(), lastFetchMs);
    pill("presence", model.presence);
    pill("service", model.service);
    text("lifetime", model.lifetimeBaseline);
    var account = state.account || {};
    toneNode("cash", model.cash, "market");
    text("gross", window.PaperDashboard.formatUsdc(account.gross_notional) + " / " + window.PaperDashboard.formatUsdc(account.gross_notional_cap));
    text("margin", window.PaperDashboard.formatUsdc(account.margin_used));
    text("lev", account.leverage == null ? "—" : String(account.leverage) + "x ceiling");
    text("equity", model.equity);
    toneNode("realized", window.PaperDashboard.formatSignedUsdc(account.realized_pnl), window.PaperDashboard.pnlTone(account.realized_pnl));
    toneNode("unrealized", window.PaperDashboard.formatSignedUsdc(account.unrealized_pnl), window.PaperDashboard.pnlTone(account.unrealized_pnl));
    toneNode("return", window.PaperDashboard.formatSignedUsdc(account.lifetime_return_usdc) + " (" + model.lifetimeReturnPct + ")", window.PaperDashboard.pnlTone(account.lifetime_return_usdc));
    toneNode("daily-pnl", window.PaperDashboard.formatSignedUsdc((account.daily || {}).pnl_usdc), window.PaperDashboard.pnlTone((account.daily || {}).pnl_usdc));
    toneNode("funding", model.funding, "funding");
    text("daily-base", model.dailyBaseline);
    text("daily-consumed", model.dailyConsumed);
    text("daily-cap", model.dailyCap);
    text("daily-left", model.dailyRemaining);
    text("fees", model.fees);
    text("fee-used", model.feeUsed);
    text("wins", model.wins + " / " + model.losses);
    text("winrate", model.winRate);
    text("dd", model.maxDd);
    text("fee-left", model.feeRemaining + " of " + model.feeCap);
    text("no-trade", model.noTradeReason === "—" ? "—" : "No trade in 12h: " + model.noTradeReason);
    text("last-trade", model.lastTradeAge);
    text("heartbeat", model.heartbeat);
    text("latency", "decision " + model.decisionLatency + " · fill " + model.fillLatency);
    text("sha", model.engineSha);
    text("display-build", model.displayBuild);
    var ident = state.identity || {};
    text("deploy", dash(ident.deployment_id));
    text("config", dash(ident.config_hash));
    text("image", ident.image_id == null ? "external attestation" : String(ident.image_id));
    var daily = (state.account && state.account.daily) || {};
    var bar = document.getElementById("loss-bar");
    if (bar) {
      var consumed = Number(daily.consumed_usdc);
      var cap = Number(daily.loss_cap_usdc);
      var width = isFinite(consumed) && isFinite(cap) && cap > 0 ? Math.min(100, (consumed / cap) * 100) : 0;
      bar.style.width = (daily.consumed_usdc == null || daily.loss_cap_usdc == null ? 0 : width) + "%";
    }
    var observed = remember(state);
    var apiCurve = (state.account && state.account.equity_curve) || [];
    var merged = window.PaperDashboard.mergeSeries(apiCurve, observed.points);
    var nowMs = Date.now();
    renderRanges(merged, nowMs);
    var sliced = window.PaperDashboard.sliceRange(merged, rangeId, nowMs);
    var drawn = drawCurve(sliced);
    var apiCount = window.PaperDashboard.mergeSeries(apiCurve, []).length;
    var source = apiCount >= 2 ? "API equity history" : "No API history";
    if (observed.since) source += " · browser samples since " + window.PaperDashboard.formatTime(observed.since);
    if (!drawn.drawable) source += " · insufficient samples, curve not drawn";
    else source += " · " + drawn.points.length + " samples from " + window.PaperDashboard.formatTime(drawn.points[0].t) + " to " + window.PaperDashboard.formatTime(drawn.points[drawn.points.length - 1].t);
    text("chart-source", source);
    var markets = state.markets || {};
    var order = ["BTC", "ETH", "SOL", "HYPE"].filter(function (coin) { return markets[coin]; });
    Object.keys(markets).forEach(function (coin) { if (order.indexOf(coin) === -1) order.push(coin); });
    var fresh = pageFreshness(state);
    var count = window.PaperDashboard.openCount(state.positions);
    var countNode = document.getElementById("pos-count");
    if (countNode) {
      countNode.textContent = count == null ? "—" : String(count);
      countNode.className = "pos-count" + (count === 0 ? " zero" : "");
    }
    var freshCopy = {
      live: "This response is current. A card says LIVE only when its market feed is live.",
      stale: "STALE — the heartbeat or this fetch is old. These positions are not live.",
      cached: "CACHED — last response only. These positions are not a live read.",
      offline: "OFFLINE — no current response. Nothing here is live.",
      unconfigured: "API base is not set. Open positions are not invented.",
      halt: "HALT — the engine is not trading this book as live.",
      stopped: "STOPPED — the worker is not live.",
      degraded: "DEGRADED — the feed is not a clean live book."
    };
    text("pos-fresh", freshCopy[fresh] || "NOT LIVE — do not treat this book as current.");
    var views = (state.positions || []).map(function (pos) {
      return window.PaperDashboard.positionView(pos, markets[pos.coin] || {}, fresh);
    });
    document.getElementById("positions").innerHTML = views.length ? views.map(function (view) {
      var klass = view.side === "long" ? "long" : view.side === "short" ? "short" : "";
      return '<article class="pos-card ' + klass + '">' +
        '<div class="pos-head"><div class="symbol">' + esc(view.coin) + '</div>' +
        '<span class="badge ' + (view.side === "long" ? "long" : view.side === "short" ? "short" : "warn") + '">' + esc(view.sideIcon + " " + view.sideLabel) + "</span>" +
        '<span class="badge ' + (view.live ? "live" : view.freshness === "stale" || view.freshness === "cached" ? view.freshness : "bad") + '">' + esc(view.freshnessLabel) + "</span></div>" +
        '<div class="fields">' +
        field("QTY", view.qty, "neutral") +
        field("ENTRY NOTIONAL", view.notionalEntry, "market") +
        field("MARK NOTIONAL", view.notionalMark, "market") +
        field("ENTRY", view.entry, "market") +
        field("MARK", view.mark, "market") +
        field("STOP", view.stop, "risk") +
        field("TARGET", view.target, "positive") +
        field("UNREALIZED PNL", view.unrealized, view.pnlTone) +
        field("LEVERAGE", view.leverage, "neutral") +
        field("MARGIN" + (view.marginBasis ? " (" + view.marginBasis + ")" : ""), view.margin, "neutral") +
        field("SETUP", view.setup, "history") +
        "</div></article>";
    }).join("") : '<div class="empty-book"><strong>' + (count == null ? "—" : String(count)) + "</strong><p>" + (fresh === "unconfigured" ? "No account is loaded. This page does not invent an open position." : "No open paper positions.") + "</p></div>";
    document.getElementById("levels").innerHTML = views.length ? views.map(function (view) {
      return '<article class="level-card"><div class="card-head"><b>' + esc(view.coin) + " " + esc(view.sideLabel) + '</b><span class="badge ' + (view.live ? "live" : view.freshness === "stale" || view.freshness === "cached" ? view.freshness : "bad") + '">' + esc(view.freshnessLabel) + "</span></div><div class=\"fields\">" +
        field("STOP", view.stop, "risk") +
        field("TARGET", view.target, "positive") +
        field("TRAIL", view.trail, "risk") +
        field("EXIT STATUS", view.exitStatus, "neutral") +
        "</div></article>";
    }).join("") : '<div class="empty-book"><strong>' + (count == null ? "—" : String(count)) + "</strong><p>No exit levels. There is no open position.</p></div>";
    document.getElementById("markets").innerHTML = order.map(function (coin) {
      var item = markets[coin];
      var feed = item.feed || "missing";
      var kind = fresh !== "live" ? "cached" : feed === "live" ? "live" : feed === "stale" ? "stale" : "bad";
      var label = fresh !== "live" ? (fresh === "cached" ? "CACHED" : fresh === "stale" ? "STALE" : "NOT LIVE") : String(feed).toUpperCase();
      var px = item.mark_status === "known" ? window.PaperDashboard.formatPrice(item.mark) : "mark unknown";
      return '<article class="market"><div class="card-head"><h2 class="market-title">' + esc(coin) + '</h2><span class="badge ' + kind + '">' + esc(label) + '</span></div><div class="px">' + esc(px) + '</div><div class="bidask">bid ' + esc(window.PaperDashboard.formatPrice(item.bid)) + " · ask " + esc(window.PaperDashboard.formatPrice(item.ask)) + "</div></article>";
    }).join("");
    var funnel = state.funnel_12h || {};
    var reasons = funnel.reject_reasons || {};
    var reasonText = Object.keys(reasons).map(function (key) { return key + " " + reasons[key]; }).join(" · ") || "—";
    document.getElementById("funnel").innerHTML = [
      ["OBSERVED", funnel.observed],
      ["SETUP", funnel.setup],
      ["RISK / COST", funnel.risk_cost],
      ["ENTRY", funnel.entry],
      ["EXIT", funnel.exit],
      ["REJECTIONS", reasonText]
    ].map(function (pair) {
      return '<article class="stat"><span>' + esc(pair[0]) + "</span><b>" + esc(dash(pair[1])) + "</b></article>";
    }).join("");
    var activity = state.assets_activity || {};
    document.getElementById("activity").innerHTML = order.map(function (coin) {
      var row = activity[coin] || {};
      return '<article class="asset-card"><div class="card-head"><b class="tone-history">' + esc(coin) + "</b></div><div class=\"fields\">" +
        field("CLOSED", dash(row.closed_trades), "history") +
        field("WINS", dash(row.wins), "positive") +
        field("LOSSES", dash(row.losses), "negative") +
        field("NET", row.net_pnl == null ? "—" : window.PaperDashboard.formatSignedUsdc(row.net_pnl), window.PaperDashboard.pnlTone(row.net_pnl)) +
        field("FEES", row.fees == null ? "—" : window.PaperDashboard.formatUsdc(row.fees), "history") +
        field("FUNDING", row.funding_net == null ? "—" : window.PaperDashboard.formatSignedUsdc(row.funding_net), "funding") +
        "</div></article>";
    }).join("");
    var news = (state.risk_context && state.risk_context.optional_news) || {};
    text("context", [
      "market drop " + dash(state.risk_context && state.risk_context.market_wide_drop),
      "connection " + dash(state.risk_context && state.risk_context.exchange_connection_issue),
      "pause " + dash(state.risk_context && state.risk_context.pause_reason),
      "news " + dash(news.status)
    ].join(" · "));
  }

  function renderTrades(payload) {
    var items = (payload && payload.items) || [];
    document.getElementById("trades").innerHTML = items.length ? items.map(function (trade) {
      var view = window.PaperDashboard.tradeView(trade);
      return '<article class="trade-card"><div class="card-head"><b class="tone-history">' + esc(view.coin) + '</b><span class="badge ' + (view.sideLabel === "LONG" ? "long" : view.sideLabel === "SHORT" ? "short" : "warn") + '">' + esc(view.sideIcon + " " + view.sideLabel) + '</span></div><div class="fields">' +
        field("EXIT TIME", view.when, "history") +
        field("SETUP", view.setup, "history") +
        field("QTY", view.qty, "history") +
        field("ENTRY", view.entry, "market") +
        field("EXIT", view.exit, "market") +
        field("STOP", view.stop, "risk") +
        field("TARGET", view.target, "positive") +
        field("FEES", view.fees, "history") +
        field("NET PNL", view.net, view.pnlTone) +
        field("REASON", view.reason, "history") +
        "</div></article>";
    }).join("") : '<div class="empty-book"><strong>0</strong><p>No closed paper trades in this page.</p></div>';
    text("page", payload ? "page " + payload.page + " / " + Math.max(1, Math.ceil((payload.total || 0) / payload.page_size)) : "");
  }

  async function tick() {
    var root = base();
    if (!root) {
      lastFetchMs = null;
      lastState = { health: { status: "STOPPED", heartbeat_ms: null }, account: {}, identity: { status: "UNKNOWN" }, markets: {}, funnel_12h: {}, activity: { no_trade_12h_reason: "dashboard_api_unconfigured" }, risk_context: { optional_news: { status: "unavailable" } } };
      render(lastState);
      text("note", "API base is not set. This page does not invent an account.");
      return;
    }
    try {
      var response = await fetch(root + "/api/v1/state", { cache: "no-store" });
      if (!response.ok) throw new Error("state");
      lastState = await response.json();
      lastFetchMs = Date.now();
      text("note", root);
      render(lastState);
      var trades = await fetch(root + "/api/v1/trades?page=" + page, { cache: "no-store" });
      if (trades.ok) renderTrades(await trades.json());
    } catch (error) {
      lastFetchMs = null;
      if (lastState) render(lastState);
      else render({ health: {}, account: {}, markets: {}, funnel_12h: {}, activity: {}, risk_context: {} });
      text("note", "API unreachable. Cached figures are not live.");
    }
  }

  document.getElementById("prev").addEventListener("click", function () { page = Math.max(1, page - 1); tick(); });
  document.getElementById("next").addEventListener("click", function () { page += 1; tick(); });
  tick();
  setInterval(function () {
    if (lastState && lastFetchMs != null) render(lastState);
  }, 5000);
  setInterval(tick, Number(cfg.pollMs) || 20000);
})();
