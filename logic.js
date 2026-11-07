(function (root) {
  var STALE_MS = 45000;
  var OFFLINE_MS = 120000;
  var RANGES = [
    { id: "15m", ms: 15 * 60 * 1000 },
    { id: "1h", ms: 60 * 60 * 1000 },
    { id: "6h", ms: 6 * 60 * 60 * 1000 },
    { id: "all", ms: null }
  ];

  function classifyPresence(nowMs, heartbeatMs, serverStatus, lastFetchMs) {
    if (lastFetchMs == null) return "OFFLINE";
    var fetchAge = nowMs - lastFetchMs;
    var hbAge = heartbeatMs == null ? Infinity : nowMs - heartbeatMs;
    var age = Math.max(fetchAge, hbAge);
    if (!isFinite(age) || age > OFFLINE_MS) return "OFFLINE";
    if (age > STALE_MS) return "STALE";
    if (serverStatus === "HALT" || serverStatus === "STOPPED" || serverStatus === "DEGRADED") {
      return serverStatus;
    }
    if (serverStatus === "ACTIVE") return "ACTIVE";
    return "OFFLINE";
  }

  function formatUsdc(value) {
    if (value === null || value === undefined || value === "") return "—";
    var number = Number(value);
    if (!isFinite(number)) return "—";
    return number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(value) {
    if (value === null || value === undefined || value === "") return "—";
    var number = Number(value);
    if (!isFinite(number)) return "—";
    return (number * 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  }

  function formatTime(ms) {
    if (ms === null || ms === undefined || ms === "") return "—";
    var number = Number(ms);
    if (!isFinite(number)) return "—";
    return new Date(number).toISOString().replace(".000Z", "Z");
  }

  function formatAge(ms) {
    if (ms === null || ms === undefined || ms === "") return "—";
    var number = Number(ms);
    if (!isFinite(number)) return "—";
    var sign = number < 0 ? "-" : "";
    var abs = Math.abs(number);
    if (abs < 1000) return sign + Math.round(abs) + " ms";
    var seconds = Math.round(abs / 1000);
    if (seconds < 90) return sign + seconds + "s";
    var minutes = Math.floor(seconds / 60);
    return sign + minutes + "m " + (seconds % 60) + "s";
  }

  function renderModel(state, nowMs, lastFetchMs) {
    var account = (state && state.account) || {};
    var daily = account.daily || {};
    var health = (state && state.health) || {};
    var fee = account.fee_allowance || {};
    var activity = (state && state.activity) || {};
    var identity = (state && state.identity) || {};
    return {
      presence: classifyPresence(nowMs, health.heartbeat_ms, health.status, lastFetchMs),
      service: lastFetchMs == null ? "unreachable" : "reachable",
      serverStatus: health.status == null ? "—" : String(health.status),
      lifetimeBaseline: formatUsdc(account.lifetime_baseline_usdc),
      dailyConsumed: formatUsdc(daily.consumed_usdc),
      dailyCap: formatUsdc(daily.loss_cap_usdc),
      dailyBaseline: formatUsdc(daily.baseline_equity),
      dailyPnl: formatUsdc(daily.pnl_usdc),
      dailyRemaining: formatUsdc(daily.remaining_usdc),
      equity: formatUsdc(account.equity),
      cash: formatUsdc(account.cash),
      realized: formatUsdc(account.realized_pnl),
      unrealized: formatUsdc(account.unrealized_pnl),
      lifetimeReturn: formatUsdc(account.lifetime_return_usdc),
      lifetimeReturnPct: formatPct(account.lifetime_return_pct),
      fees: formatUsdc(account.fees_paid),
      funding: formatUsdc(account.funding_net),
      winRate: formatPct(account.win_rate),
      wins: account.wins == null ? "—" : String(account.wins),
      losses: account.losses == null ? "—" : String(account.losses),
      maxDd: formatUsdc(account.max_drawdown_usdc),
      feeRemaining: formatUsdc(fee.remaining_usdc),
      feeUsed: formatUsdc(fee.used_usdc),
      feeCap: formatUsdc(fee.cap_usdc),
      noTradeReason: activity.no_trade_12h_reason == null ? "—" : String(activity.no_trade_12h_reason),
      lastTradeAge: formatAge(activity.last_trade_age_ms),
      decisionLatency: formatAge(activity.decision_latency_ms),
      fillLatency: formatAge(activity.fill_latency_ms),
      heartbeat: formatTime(health.heartbeat_ms),
      engineSha: identity.engine_source_sha == null ? "—" : String(identity.engine_source_sha),
      displayBuild: displayBuild()
    };
  }

  function displayBuild() {
    var cfg = root.PAPER_DASHBOARD_CONFIG || {};
    return cfg.displayBuild ? String(cfg.displayBuild) : "desk-visual-3";
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === "") return "—";
    var text = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(text)) return "—";
    var negative = text.charAt(0) === "-";
    if (negative) text = text.slice(1);
    var dot = text.indexOf(".");
    if (dot === -1) return (negative ? "-" : "") + text;
    var frac = text.slice(dot + 1).replace(/0+$/, "");
    var body = frac ? text.slice(0, dot) + "." + frac : text.slice(0, dot);
    return (negative ? "-" : "") + body;
  }

  function formatSignedUsdc(value) {
    if (value === null || value === undefined || value === "") return "—";
    var number = Number(value);
    if (!isFinite(number)) return "—";
    var body = formatUsdc(Math.abs(number));
    if (number > 0) return "+" + body;
    if (number < 0) return "-" + body;
    return body;
  }

  function pnlTone(value) {
    if (value === null || value === undefined || value === "") return "unknown";
    var number = Number(value);
    if (!isFinite(number)) return "unknown";
    if (number > 0) return "positive";
    if (number < 0) return "negative";
    return "flat";
  }

  function toneFor(role) {
    if (role === "long" || role === "positive") return "positive";
    if (role === "short" || role === "negative") return "negative";
    if (role === "risk" || role === "warning" || role === "stale" || role === "cached") return "risk";
    if (role === "market" || role === "price") return "market";
    if (role === "funding") return "funding";
    if (role === "history") return "history";
    return "neutral";
  }

  function openCount(positions) {
    if (!Array.isArray(positions)) return null;
    return positions.length;
  }

  var FRESH_LABEL = {
    live: "LIVE",
    stale: "STALE",
    cached: "CACHED",
    offline: "OFFLINE",
    halt: "HALT",
    stopped: "STOPPED",
    degraded: "DEGRADED",
    "not-live": "NOT LIVE",
    unconfigured: "NOT LOADED"
  };

  function cardFreshness(pageFreshness, market) {
    if (pageFreshness !== "live") return pageFreshness || "not-live";
    var feed = market && market.feed;
    if (feed === "live") return "live";
    if (feed === "stale") return "stale";
    return "not-live";
  }

  function positionView(pos, market, pageFreshness) {
    pos = pos || {};
    market = market || {};
    var side = String(pos.side || "").toLowerCase();
    var sideLabel = side === "long" ? "LONG" : side === "short" ? "SHORT" : "SIDE UNKNOWN";
    var markKnown = false;
    if (pos.mark_status !== "unknown" && market.mark_status === "known" && market.mark !== null && market.mark !== undefined && market.mark !== "") {
      markKnown = true;
    }
    var freshness = cardFreshness(pageFreshness, market);
    var markNotional = "—";
    if (markKnown && pos.qty !== null && pos.qty !== undefined && pos.qty !== "") {
      var product = Number(pos.qty) * Number(market.mark);
      if (isFinite(product)) markNotional = formatUsdc(product);
    }
    return {
      coin: pos.coin == null ? "—" : String(pos.coin),
      side: side,
      sideLabel: sideLabel,
      sideTone: toneFor(side === "long" || side === "short" ? side : "warning"),
      sideIcon: side === "long" ? "▲" : side === "short" ? "▼" : "•",
      qty: formatPrice(pos.qty),
      entry: formatPrice(pos.entry_px),
      stop: formatPrice(pos.stop_px),
      target: formatPrice(pos.target_px),
      trail: pos.trail_px == null || pos.trail_px === "" ? "—" : formatPrice(pos.trail_px),
      mark: markKnown ? formatPrice(market.mark) : "mark unknown",
      markTone: toneFor("market"),
      unrealized: formatSignedUsdc(pos.unrealized_pnl),
      pnlTone: pnlTone(pos.unrealized_pnl),
      notionalEntry: formatUsdc(pos.notional_entry),
      notionalMark: markNotional,
      leverage: pos.leverage == null || pos.leverage === "" ? "—" : String(pos.leverage) + "x",
      margin: pos.initial_margin == null || pos.initial_margin === "" ? "—" : formatUsdc(pos.initial_margin),
      marginBasis: pos.margin_basis == null ? "" : String(pos.margin_basis),
      setup: pos.setup == null ? "—" : String(pos.setup),
      exitStatus: pos.exit_status == null || pos.exit_status === "" ? "—" : String(pos.exit_status),
      funding: formatSignedUsdc(pos.funding_net),
      freshness: freshness,
      freshnessLabel: FRESH_LABEL[freshness] || "NOT LIVE",
      live: freshness === "live"
    };
  }

  function tradeView(trade) {
    trade = trade || {};
    var side = String(trade.side || "").toLowerCase();
    var fees = "—";
    if (trade.entry_fee != null && trade.entry_fee !== "" && trade.exit_fee != null && trade.exit_fee !== "") {
      var total = Number(trade.entry_fee) + Number(trade.exit_fee);
      fees = isFinite(total) ? formatUsdc(total) : "—";
    }
    return {
      coin: trade.coin == null ? "—" : String(trade.coin),
      sideLabel: side === "long" ? "LONG" : side === "short" ? "SHORT" : "SIDE UNKNOWN",
      sideTone: toneFor(side === "long" || side === "short" ? side : "history"),
      sideIcon: side === "long" ? "▲" : side === "short" ? "▼" : "•",
      qty: formatPrice(trade.qty),
      entry: formatPrice(trade.entry_px),
      exit: formatPrice(trade.exit_px),
      stop: formatPrice(trade.stop_px),
      target: formatPrice(trade.target_px),
      net: formatSignedUsdc(trade.net_pnl),
      pnlTone: pnlTone(trade.net_pnl),
      reason: trade.exit_reason == null || trade.exit_reason === "" ? "—" : String(trade.exit_reason),
      setup: trade.setup == null ? "—" : String(trade.setup),
      fees: fees,
      when: formatTime(trade.exit_ts),
      tone: toneFor("history")
    };
  }

  function parsePoint(raw, source) {
    if (!raw) return null;
    var t = Number(raw.t);
    if (raw.equity === null || raw.equity === undefined || raw.equity === "") return null;
    var equity = Number(raw.equity);
    if (!isFinite(t) || !isFinite(equity)) return null;
    return { t: t, equity: equity, source: source };
  }

  function mergeSeries(apiCurve, observed) {
    var byTime = {};
    (observed || []).forEach(function (raw) {
      var point = parsePoint(raw, "observed");
      if (point) byTime[point.t] = point;
    });
    (apiCurve || []).forEach(function (raw) {
      var point = parsePoint(raw, "api");
      if (point) byTime[point.t] = point;
    });
    return Object.keys(byTime).map(function (key) { return byTime[key]; }).sort(function (a, b) { return a.t - b.t; });
  }

  function sliceRange(points, rangeId, nowMs) {
    var usable = (points || []).slice().sort(function (a, b) { return a.t - b.t; });
    var range = null;
    for (var i = 0; i < RANGES.length; i += 1) {
      if (RANGES[i].id === rangeId) range = RANGES[i];
    }
    if (!range || range.ms == null) return usable;
    var start = nowMs - range.ms;
    return usable.filter(function (point) { return point.t >= start && point.t <= nowMs; });
  }

  function availableRanges(points, nowMs) {
    return RANGES.map(function (range) {
      var sliced = sliceRange(points, range.id, nowMs);
      return { id: range.id, enabled: sliced.length >= 2, count: sliced.length };
    });
  }

  function chartModel(points) {
    var usable = (points || []).slice().sort(function (a, b) { return a.t - b.t; });
    if (usable.length < 2) {
      return { drawable: false, reason: "insufficient_samples", points: usable };
    }
    return { drawable: true, reason: null, points: usable };
  }

  root.PaperDashboard = {
    STALE_MS: STALE_MS,
    OFFLINE_MS: OFFLINE_MS,
    RANGES: RANGES,
    classifyPresence: classifyPresence,
    formatUsdc: formatUsdc,
    formatPrice: formatPrice,
    formatSignedUsdc: formatSignedUsdc,
    pnlTone: pnlTone,
    toneFor: toneFor,
    openCount: openCount,
    cardFreshness: cardFreshness,
    positionView: positionView,
    tradeView: tradeView,
    formatPct: formatPct,
    formatTime: formatTime,
    formatAge: formatAge,
    renderModel: renderModel,
    displayBuild: displayBuild,
    mergeSeries: mergeSeries,
    sliceRange: sliceRange,
    availableRanges: availableRanges,
    chartModel: chartModel
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
