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
    return cfg.displayBuild ? String(cfg.displayBuild) : "desk-visual-1";
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
