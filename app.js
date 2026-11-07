(function () {
  var cfg = window.PAPER_DASHBOARD_CONFIG || { apiBase: "", pollMs: 20000 };
  var page = 1;
  var lastFetchMs = null;
  var lastState = null;

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
    node.className = "pill " + (value === "ACTIVE" || value === "reachable" ? "good" : value === "STALE" || value === "DEGRADED" ? "warn" : "bad");
  }

  function drawCurve(points) {
    var svg = document.getElementById("curve");
    if (!svg) return;
    var rows = (points || []).filter(function (point) { return point && point.equity != null; });
    if (rows.length < 2) {
      svg.innerHTML = "";
      return;
    }
    var values = rows.map(function (point) { return Number(point.equity); });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var d = rows.map(function (point, index) {
      var x = (index / (rows.length - 1)) * 1000;
      var y = 150 - ((Number(point.equity) - min) / span) * 130;
      return (index === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");
    svg.innerHTML = '<path class="curve" d="' + d + '" />';
  }

  function table(headers, rows) {
    var head = "<tr>" + headers.map(function (item) { return "<th>" + item + "</th>"; }).join("") + "</tr>";
    var body = rows.map(function (row) {
      return "<tr>" + row.map(function (cell) { return "<td>" + cell + "</td>"; }).join("") + "</tr>";
    }).join("");
    return "<table>" + head + body + "</table>";
  }

  function dash(value) {
    return value == null || value === "" ? "—" : String(value);
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
    text("funding", model.funding);
    text("wins", model.wins + " / " + model.losses);
    text("winrate", model.winRate);
    text("dd", model.maxDd);
    text("fee-left", model.feeRemaining + " of " + model.feeCap);
    text("no-trade", model.noTradeReason);
    text("last-trade", model.lastTradeAge);
    text("heartbeat", model.heartbeat);
    text("latency", "decision " + model.decisionLatency + " · fill " + model.fillLatency);
    var ident = state.identity || {};
    text("sha", dash(ident.engine_source_sha));
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
    var markets = state.markets || {};
    document.getElementById("markets").innerHTML = Object.keys(markets).map(function (coin) {
      var item = markets[coin];
      return '<article class="card"><span class="label">' + coin + " · " + dash(item.feed) + '</span><div class="num">' +
        (item.mark_status === "known" ? window.PaperDashboard.formatUsdc(item.mark) : "mark unknown") +
        '</div><div class="identity">bid ' + dash(item.bid) + " · ask " + dash(item.ask) + "</div></article>";
    }).join("");
    var positions = state.positions || [];
    document.getElementById("positions").innerHTML = positions.length ? table(
      ["Asset", "Side", "Setup", "Qty", "Entry", "Stop", "Target", "Unrealized"],
      positions.map(function (pos) {
        return [pos.coin, pos.side, pos.setup, dash(pos.qty), dash(pos.entry_px), dash(pos.stop_px), dash(pos.target_px), pos.unrealized_pnl == null ? "—" : window.PaperDashboard.formatUsdc(pos.unrealized_pnl)];
      })
    ) : '<p class="empty">No open paper positions.</p>';
    var funnel = state.funnel_12h || {};
    var reasons = funnel.reject_reasons || {};
    document.getElementById("funnel").innerHTML =
      "<div class='row'><span>Observed</span><b>" + dash(funnel.observed) + "</b></div>" +
      "<div class='row'><span>Setup</span><b>" + dash(funnel.setup) + "</b></div>" +
      "<div class='row'><span>Risk and cost</span><b>" + dash(funnel.risk_cost) + "</b></div>" +
      "<div class='row'><span>Entry</span><b>" + dash(funnel.entry) + "</b></div>" +
      "<div class='row'><span>Exit</span><b>" + dash(funnel.exit) + "</b></div>" +
      "<p class='identity'>" + Object.keys(reasons).map(function (key) { return key + " " + reasons[key]; }).join(" · ") + "</p>";
    drawCurve((state.account && state.account.equity_curve) || []);
    var activity = state.assets_activity || {};
    var names = Object.keys(markets);
    document.getElementById("activity").innerHTML = table(
      ["Asset", "Closed", "Wins", "Losses", "Net", "Fees", "Funding"],
      names.map(function (coin) {
        var row = activity[coin] || {};
        return [coin, dash(row.closed_trades == null ? 0 : row.closed_trades), dash(row.wins == null ? 0 : row.wins), dash(row.losses == null ? 0 : row.losses), row.net_pnl == null ? "—" : window.PaperDashboard.formatUsdc(row.net_pnl), row.fees == null ? "—" : window.PaperDashboard.formatUsdc(row.fees), row.funding_net == null ? "—" : window.PaperDashboard.formatUsdc(row.funding_net)];
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
    ) : '<p class="empty">No closed paper trades.</p>';
    text("page", "page " + payload.page + " / " + Math.max(1, Math.ceil((payload.total || 0) / payload.page_size)));
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
