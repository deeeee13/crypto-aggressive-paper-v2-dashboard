// Public, non-secret. The parent sets apiBase to the Railway HTTPS origin
// when publishing the dashboard repository. Empty means unconfigured.
// displayBuild identifies these assets only. It is not the engine source SHA.
window.PAPER_DASHBOARD_CONFIG = {
  apiBase: "https://aggressive-paper-v2-production.up.railway.app",
  pollMs: 20000,
  displayBuild: "desk-visual-1"
};
