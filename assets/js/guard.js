// Simplified in-browser version of the NL-to-SQL agent's SQL guard.
// The real guard (github.com/vipati/nl-to-sql-agent) parses a full sqlglot AST; this version
// masks string literals and comments first, so "; DROP" inside a string is not a false positive.
(() => {
  "use strict";

  const TABLES = new Set(["customers", "orders", "order_items", "products"]);
  const FORBIDDEN = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "COPY", "ATTACH", "DETACH",
    "PRAGMA", "SET", "INSTALL", "LOAD", "EXPORT", "IMPORT", "CALL", "TRUNCATE", "GRANT", "VACUUM"];
  const DENIED_FUNCTIONS = /\b(read_\w+|getenv|query|query_table|glob|current_setting|duckdb_\w+)\s*\(/i;
  const CATALOGS = /\b(information_schema|pg_catalog|sqlite_master)\b/i;
  const MAX_ROWS = 1000;

  // Replace the contents of strings, quoted identifiers, and comments with spaces.
  function mask(sql) {
    return sql
      .replace(/--[^\n]*/g, (m) => " ".repeat(m.length))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
      .replace(/'(?:[^']|'')*'/g, (m) => "'" + " ".repeat(Math.max(m.length - 2, 0)) + "'")
      .replace(/"(?:[^"]|"")*"/g, (m) => '"' + " ".repeat(Math.max(m.length - 2, 0)) + '"');
  }

  function check(sql) {
    const masked = mask(sql);
    const statements = masked.split(";").filter((s) => s.trim());
    if (!statements.length) return { verdict: "invalid", reasons: ["Empty query."] };

    const reasons = [];
    if (statements.length > 1) reasons.push(`Found ${statements.length} statements. Exactly one is allowed.`);
    const first = statements[0].trim().split(/\s+/)[0].toUpperCase();
    if (!["SELECT", "WITH"].includes(first)) reasons.push(`Statement starts with <code>${first}</code>. Only queries (SELECT / WITH) are allowed.`);
    const found = FORBIDDEN.filter((k) => new RegExp(`\\b${k}\\b`, "i").test(masked));
    if (found.length) reasons.push(`Disallowed operation: <code>${found.join("</code>, <code>")}</code>.`);
    const fn = masked.match(DENIED_FUNCTIONS);
    if (fn) reasons.push(`Function <code>${fn[1]}()</code> can read files, the environment, or settings.`);
    const cat = masked.match(CATALOGS);
    if (cat) reasons.push(`System catalog <code>${cat[1]}</code> is off-limits. Only application tables can be queried.`);
    if (reasons.length) return { verdict: "blocked", reasons };

    const unknown = [];
    for (const m of masked.matchAll(/\b(?:from|join)\s+([a-z_][\w.]*)/gi)) {
      const name = m[1].toLowerCase();
      if (!TABLES.has(name)) unknown.push(name);
    }
    if (unknown.length) {
      return {
        verdict: "invalid",
        reasons: [`Table <code>${unknown[0]}</code> does not exist. Known tables: ${[...TABLES].join(", ")}. The agent would send this error back to the model to repair.`],
      };
    }
    const hasLimit = /\blimit\s+\d+/i.test(masked);
    const rendered = sql.trim().replace(/;\s*$/, "") + (hasLimit ? "" : ` LIMIT ${MAX_ROWS}`);
    return { verdict: "allowed", reasons: [], rendered };
  }

  const root = document.getElementById("guard-demo");
  if (!root) return;
  const input = document.getElementById("guard-input");
  const out = document.getElementById("guard-result");
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render() {
    const result = check(input.value);
    if (result.verdict === "allowed") {
      out.innerHTML = `<span class="badge hit">Allowed</span>
        <p class="muted">Runs on a read-only connection with external access disabled, a timeout, and a row cap:</p>
        <p><code>${escapeHtml(result.rendered)}</code></p>`;
    } else {
      const label = result.verdict === "blocked" ? "Blocked · fail closed" : "Invalid · sent back for repair";
      out.innerHTML = `<span class="badge ${result.verdict === "blocked" ? "block" : "miss"}">${label}</span>
        <ul>${result.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>`;
    }
  }

  let timer;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 150); });
  root.querySelectorAll("[data-sql]").forEach((btn) =>
    btn.addEventListener("click", () => { input.value = btn.dataset.sql; render(); }));
  render();
})();
