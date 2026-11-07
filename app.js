(function () {
  var cfg = window.PAPER_DASHBOARD_CONFIG || { apiBase: "", pollMs: 20000, displayBuild: "desk-visual-1" };
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
    text("cash", model.cash);
    text("equity", model.equity);
    text("realized", model.realized);
    text("unrealized", model.unrealized);
    text("return", model.lifetimeReturn + " (" + model.lifetimeReturnPct + ")");
    text("daily-pnl", model.dailyPnl);
    text("daily-base", model.dailyBaseline);
    text("daily-consumed", model.dailyConsumed);
    text("daily-cap", model.dailyCap);
    text("daily-left", model.dailyRemaining);
    text("fees", model.fees);
    text("fee-used", model.feeUsed);
    text("funding", model.funding);
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
    document.getElementById("markets").innerHTML = order.map(function (coin) {
      var item = markets[coin];
      var feed = item.feed || "missing";
      var kind = feed === "live" ? "good" : feed === "stale" ? "warn" : "bad";
      var px = item.mark_status === "known" ? window.PaperDashboard.formatUsdc(item.mark) : "mark unknown";
      return '<article class="panel market"><div class="section-title"><h2>' + coin + '</h2><span class="badge ' + kind + '">' + dash(feed) + '</span></div><div class="px">' + px + '</div><div class="bidask">bid ' + dash(item.bid) + " · ask " + dash(item.ask) + "</div></article>";
    }).join("");
    var positions = state.positions || [];
    document.getElementById("positions").innerHTML = positions.length ? table(
      ["Asset", "Side", "Setup", "Qty", "Entry", "Stop", "Target", "Unrealized", "Mark"],
      positions.map(function (pos) {
        return [pos.coin, pos.side, pos.setup, dash(pos.qty), dash(pos.entry_px), dash(pos.stop_px), dash(pos.target_px), pos.unrealized_pnl == null ? "—" : window.PaperDashboard.formatUsdc(pos.unrealized_pnl), dash(pos.mark_status)];
      })
    ) : '<p class="sub">No open paper positions.</p>';
    var funnel = state.funnel_12h || {};
    var reasons = funnel.reject_reasons || {};
    document.getElementById("funnel").innerHTML = table(
      ["Observed", "Setup", "Risk/cost", "Entry", "Exit", "Rejections"],
      [[dash(funnel.observed), dash(funnel.setup), dash(funnel.risk_cost), dash(funnel.entry), dash(funnel.exit), Object.keys(reasons).map(function (key) { return key + " " + reasons[key]; }).join(" · ") || "—"]]
    );
    var activity = state.assets_activity || {};
    document.getElementById("activity").innerHTML = table(
      ["Asset", "Closed", "Wins", "Losses", "Net", "Fees", "Funding"],
      order.map(function (coin) {
        var row = activity[coin] || {};
        return [coin, dash(row.closed_trades), dash(row.wins), dash(row.losses), row.net_pnl == null ? "—" : window.PaperDashboard.formatUsdc(row.net_pnl), row.fees == null ? "—" : window.PaperDashboard.formatUsdc(row.fees), row.funding_net == null ? "—" : window.PaperDashboard.formatUsdc(row.funding_net)];
      })
    );
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
    document.getElementById("trades").innerHTML = items.length ? table(
      ["Exit", "Asset", "Setup", "Side", "Qty", "Entry", "Exit px", "Stop", "Target", "Fees", "Net", "Reason"],
      items.map(function (trade) {
        var fees = trade.entry_fee == null || trade.exit_fee == null ? "—" : window.PaperDashboard.formatUsdc(Number(trade.entry_fee) + Number(trade.exit_fee));
        return [window.PaperDashboard.formatTime(trade.exit_ts), trade.coin, trade.setup, trade.side, dash(trade.qty), dash(trade.entry_px), dash(trade.exit_px), dash(trade.stop_px), dash(trade.target_px), fees, trade.net_pnl == null ? "—" : window.PaperDashboard.formatUsdc(trade.net_pnl), dash(trade.exit_reason)];
      })
    ) : '<p class="sub">No closed paper trades.</p>';
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
