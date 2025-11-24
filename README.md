#Blue vizion
blue-vizion/
├─ workers/
│  └─ index.js                 # Cloudflare Worker (API, lineage enforcement, aggregates)
├─ db/
│  └─ schema.sql               # D1 schema (intake, audit, compliance, certificates, stats)
├─ web/
│  ├─ index.html               # Dashboard root
│  ├─ app.js                   # Dashboard logic (tiles, schedule, cancellations, updates, EOD)
│  └─ styles.css               # Minimal UI
├─ manifests/
│  └─ career-trace-unified.json# Canonical manifest (for reference/validation)
└─ README.md
// workers/index.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const h = request.headers;

    // Lineage enforcement
    const lineageOk =
      h.get("X-UUID") === "UUIDALICIACLACY" &&
      h.get("X-ORCID") === "0009-0008-9127-1581" &&
      h.get("X-UEI") === "P163FZ5WD717" &&
      h.get("X-Author") === "Alicia Camille Lacy";
    if (!lineageOk) return json({ error: "Lineage missing" }, 403);

    // Health
    if (url.pathname === "/" && request.method === "GET") return json({ ok: true });

    // Intake create
    if (url.pathname === "/intake" && request.method === "POST") {
      const body = await request.json();
      const now = new Date().toISOString();

      // Persist intake
      await env.DB.prepare(
        `INSERT INTO intake
         (candidate_number, agent_id, agency_name, biometric_hash, service_code,
          ethnicity_code, remote_office_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).bind(
        body.candidate?.candidate_number,
        body.agent?.agent_id ?? "AGENT-ATL-001",
        body.agent?.agency_name ?? "Diaspora Services ATL",
        body.candidate?.biometric_hash,
        body.candidate?.service_code,
        body.ethnicity?.ethnicity_code,
        body.ethnicity?.remote_office_id,
        now
      ).run();

      // Audit
      await env.DB.prepare(
        `INSERT INTO audit_events (candidate_number, step, actor, result, timestamp)
         VALUES (?, 'intake_submitted', ?, 'accepted', ?)`
      ).bind(
        body.candidate?.candidate_number,
        body.agent_signature?.credential_hash ?? "agent_hash_missing",
        now
      ).run();

      return json({ ok: true, status: "sealed_pending" });
    }

    // Cancellations (reasoned disqualification)
    if (url.pathname === "/intake/cancel" && request.method === "POST") {
      const body = await request.json();
      const now = new Date().toISOString();

      await env.DB.prepare(
        `UPDATE intake SET status='unqualified' WHERE candidate_number=?`
      ).bind(body.candidate_number).run();

      await env.DB.prepare(
        `INSERT INTO disqualifications (candidate_number, reason_code, timestamp)
         VALUES (?, ?, ?)`
      ).bind(body.candidate_number, body.reason_code, now).run();

      await env.DB.prepare(
        `INSERT INTO audit_events (candidate_number, step, actor, result, timestamp)
         VALUES (?, 'rejection_issued', ?, ?, ?)`
      ).bind(
        body.candidate_number,
        body.agent_signature?.credential_hash ?? "agent_hash_missing",
        body.reason_code,
        now
      ).run();

      return json({ ok: true, status: "unqualified", reason: body.reason_code });
    }

    // Manual updates from customers (e.g., document uploads)
    if (url.pathname === "/intake/update" && request.method === "POST") {
      const body = await request.json();
      const now = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO manual_updates (candidate_number, update_type, agent_signature, timestamp)
         VALUES (?, ?, ?, ?)`
      ).bind(
        body.candidate_number,
        body.update_type,
        body.agent_signature?.credential_hash ?? "agent_hash_missing",
        now
      ).run();

      return json({ ok: true, update_type: body.update_type });
    }

    // Compliance window open
    if (url.pathname === "/compliance/open" && request.method === "POST") {
      const body = await request.json();
      const issued = new Date(body.issued_timestamp ?? Date.now());
      const deadline = new Date(body.deadline_timestamp ?? (Date.now() + 24 * 60 * 60 * 1000));

      await env.DB.prepare(
        `INSERT INTO compliance (candidate_number, issued_timestamp, deadline_timestamp, status)
         VALUES (?, ?, ?, 'open')`
      ).bind(
        body.candidate_number,
        issued.toISOString(),
        deadline.toISOString()
      ).run();

      await env.DB.prepare(
        `UPDATE intake SET status='awaiting_documents' WHERE candidate_number=?`
      ).bind(body.candidate_number).run();

      return json({ ok: true, candidate_number: body.candidate_number, deadline: deadline.toISOString() });
    }

    // Compliance submit -> qualify and issue certificate
    if (url.pathname === "/compliance/submit" && request.method === "POST") {
      const body = await request.json();
      const now = new Date().toISOString();
      const certId = `CH-${Date.now()}`;

      await env.DB.prepare(
        `UPDATE compliance SET status='received' WHERE candidate_number=?`
      ).bind(body.candidate_number).run();

      await env.DB.prepare(
        `UPDATE intake SET status='qualified' WHERE candidate_number=?`
      ).bind(body.candidate_number).run();

      await env.DB.prepare(
        `INSERT INTO certificates (certificate_id, candidate_number, documents_hash, watermark_hash, block_seal, notarized, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      ).bind(
        certId,
        body.candidate_number,
        body.documents_hash,
        body.verification?.watermark_hash ?? "wm_missing",
        body.verification?.block_seal ?? "seal_missing",
        now
      ).run();

      await env.DB.prepare(
        `INSERT INTO audit_events (candidate_number, step, actor, result, timestamp)
         VALUES (?, 'certificate_issued', ?, 'qualified', ?)`
      ).bind(
        body.candidate_number,
        body.agent_signature?.credential_hash ?? "agent_hash_missing",
        now
      ).run();

      return json({ ok: true, status: "qualified", certificate_id: certId });
    }

    // Aggregates for dashboard tiles (no PII)
    if (url.pathname === "/equity/aggregates" && request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT ethnicity_code,
                SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END) AS qualified,
                SUM(CASE WHEN status='awaiting_documents' THEN 1 ELSE 0 END) AS awaiting_documents,
                SUM(CASE WHEN status='unqualified' THEN 1 ELSE 0 END) AS unqualified
         FROM intake
         GROUP BY ethnicity_code`
      ).all();

      return json(rows.results);
    }

    // Schedule list for the day
    if (url.pathname === "/schedule/today" && request.method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await env.DB.prepare(
        `SELECT candidate_number, service_code, remote_office_id, status, created_at
         FROM intake
         WHERE substr(created_at, 1, 10) = ?`
      ).bind(today).all();

      return json(rows.results);
    }

    // Cancellations list for the day
    if (url.pathname === "/cancellations/today" && request.method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await env.DB.prepare(
        `SELECT candidate_number, reason_code, timestamp
         FROM disqualifications
         WHERE substr(timestamp, 1, 10) = ?`
      ).bind(today).all();

      return json(rows.results);
    }

    // Manual updates list for the day
    if (url.pathname === "/updates/today" && request.method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await env.DB.prepare(
        `SELECT candidate_number, update_type, agent_signature, timestamp
         FROM manual_updates
         WHERE substr(timestamp, 1, 10) = ?`
      ).bind(today).all();

      return json(rows.results);
    }

    // End-of-day report (summarized and sealed)
    if (url.pathname === "/report/eod" && request.method === "POST") {
      const body = await request.json();
      const date = body.report_date ?? new Date().toISOString().slice(0, 10);

      const totals = await env.DB.prepare(
        `SELECT
          COUNT(*) AS total_candidates,
          SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END) AS qualified,
          SUM(CASE WHEN status='awaiting_documents' THEN 1 ELSE 0 END) AS awaiting_documents,
          SUM(CASE WHEN status='unqualified' THEN 1 ELSE 0 END) AS unqualified
         FROM intake
         WHERE substr(created_at, 1, 10) = ?`
      ).bind(date).first();

      const report = {
        report_date: date,
        batch_id: `BR-${date.replace(/-/g, "")}`,
        total_candidates: totals?.total_candidates ?? 0,
        qualified: totals?.qualified ?? 0,
        awaiting_documents: totals?.awaiting_documents ?? 0,
        cancelled: totals?.unqualified ?? 0,
        agent: {
          agent_id: body.agent?.agent_id ?? "AGENT-ATL-001",
          credential_hash: body.agent_signature?.credential_hash ?? "agent_hash_missing",
          signature_timestamp: new Date().toISOString()
        },
        authorship: {
          uuid: "UUIDALICIACLACY",
          orcid: "0009-0008-9127-1581",
          uei: "P163FZ5WD717",
          author: "Alicia Camille Lacy"
        },
        verification: {
          watermark_hash: body.verification?.watermark_hash ?? "wm_missing",
          block_seal: body.verification?.block_seal ?? "seal_missing",
          notarized: true
        }
      };

      await env.DB.prepare(
        `INSERT INTO eod_reports (report_date, batch_id, payload, created_at)
         VALUES (?, ?, ?, ?)`
      ).bind(
        report.report_date,
        report.batch_id,
        JSON.stringify(report),
        new Date().toISOString()
      ).run();

      return json({ ok: true, report });
    }

    return json({ error: "Not found" }, 404);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
-- db/schema.sql

CREATE TABLE IF NOT EXISTS intake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT UNIQUE NOT NULL,
  agent_id TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  biometric_hash TEXT NOT NULL,
  service_code TEXT NOT NULL,
  ethnicity_code TEXT NOT NULL,
  remote_office_id TEXT NOT NULL,
  status TEXT CHECK (status IN ('pending','awaiting_documents','qualified','unqualified')) NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  step TEXT NOT NULL,
  actor TEXT NOT NULL,
  result TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  issued_timestamp TEXT NOT NULL,
  deadline_timestamp TEXT NOT NULL,
  status TEXT CHECK (status IN ('open','received','expired')) NOT NULL
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_id TEXT UNIQUE NOT NULL,
  candidate_number TEXT NOT NULL,
  documents_hash TEXT,
  watermark_hash TEXT,
  block_seal TEXT,
  notarized INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disqualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_number TEXT NOT NULL,
  update_type TEXT NOT NULL,
  agent_signature TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eod_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
<!-- web/index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Blue Vizion</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <header>
      <h1>Blue Vizion</h1>
      <div class="authorship">
        UUIDALICIACLACY • ORCID: 0009-0008-9127-1581 • UEI: P163FZ5WD717 • Alicia Camille Lacy
      </div>
    </header>

    <main>
      <section id="welcome">
        <h2>Welcome</h2>
        <div class="actions">
          <button id="beginIntake">Begin intake</button>
          <button id="openCompliance">Open compliance window</button>
          <button id="endOfDay">Report end of day</button>
        </div>
      </section>

      <section>
        <h2>Appointments</h2>
        <div id="schedule"></div>
      </section>

      <section>
        <h2>Cancellations</h2>
        <div id="cancellations"></div>
      </section>

      <section>
        <h2>Customer updates (manual)</h2>
        <div id="updates"></div>
      </section>

      <section>
        <h2>Equity tiles</h2>
        <div id="tiles" class="tiles"></div>
      </section>
    </main>

    <script src="app.js"></script>
  </body>
</html>
/* web/styles.css */
body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f7f8fa; color: #111; }
header { background: #0f62fe; color: #fff; padding: 16px; }
h1 { margin: 0; }
.authorship { font-size: 12px; opacity: 0.9; margin-top: 6px; }
main { padding: 16px; }
section { margin-bottom: 24px; }
.actions button { margin-right: 8px; }
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.tile { background: #fff; padding: 12px; border: 1px solid #e2e6ea; border-radius: 8px; }
.list { background: #fff; padding: 12px; border: 1px solid #e2e6ea; border-radius: 8px; }
.item { padding: 8px 0; border-bottom: 1px dashed #e2e6ea; }
.item:last-child { border-bottom: none; }
// web/app.js
const EDGE = "https://your-edge.example.com";
const LINEAGE = {
  "X-UUID": "UUIDALICIACLACY",
  "X-ORCID": "0009-0008-9127-1581",
  "X-UEI": "P163FZ5WD717",
  "X-Author": "Alicia Camille Lacy"
};

async function api(path, method = "GET", body) {
  const res = await fetch(`${EDGE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...LINEAGE },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function renderTiles() {
  const data = await api("/equity/aggregates");
  const tiles = document.getElementById("tiles");
  tiles.innerHTML = "";
  data.forEach(row => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `
      <div><strong>Ethnicity:</strong> ${row.ethnicity_code}</div>
      <div><strong>Qualified:</strong> ${row.qualified}</div>
      <div><strong>Awaiting documents:</strong> ${row.awaiting_documents}</div>
      <div><strong>Unqualified:</strong> ${row.unqualified}</div>
    `;
    tiles.appendChild(el);
  });
}

async function renderSchedule() {
  const data = await api("/schedule/today");
  const container = document.getElementById("schedule");
  container.className = "list";
  container.innerHTML = data.map(d => `
    <div class="item">
      <strong>${d.candidate_number}</strong> • ${d.service_code} • ${d.remote_office_id} • <em>${d.status}</em>
      <div><small>${d.created_at}</small></div>
    </div>
  `).join("");
}

async function renderCancellations() {
  const data = await api("/cancellations/today");
  const container = document.getElementById("cancellations");
  container.className = "list";
  container.innerHTML = data.map(d => `
    <div class="item">
      <strong>${d.candidate_number}</strong> • Reason: <em>${d.reason_code}</em>
      <div><small>${d.timestamp}</small></div>
    </div>
  `).join("");
}

async function renderUpdates() {
  const data = await api("/updates/today");
  const container = document.getElementById("updates");
  container.className = "list";
  container.innerHTML = data.map(d => `
    <div class="item">
      <strong>${d.candidate_number}</strong> • Update: <em>${d.update_type}</em>
      <div><small>Agent: ${d.agent_signature}</small></div>
      <div><small>${d.timestamp}</small></div>
    </div>
  `).join("");
}

// Actions: Begin intake, open compliance, EOD report
document.getElementById("beginIntake").addEventListener("click", async () => {
  const candidate_number = prompt("Candidate number:");
  const service_code = prompt("Service code:");
  const ethnicity_code = prompt("Ethnicity code:");
  const remote_office_id = prompt("Remote office id:");

  const payload = {
    candidate: {
      candidate_number,
      biometric_hash: "sha256:templateHash", // replace with real template hash
      service_code,
      status: "pending"
    },
    agent: { agent_id: "AGENT-ATL-001", agency_name: "Diaspora Services ATL" },
    agent_signature: { credential_hash: "sha256:agentCredHash", signature_timestamp: new Date().toISOString() },
    ethnicity: { ethnicity_code, remote_office_id },
    verification: { watermark_hash: "sha256:wmHashABC", block_seal: "ledger-entry-xyz789", notarized: true }
  };

  await api("/intake", "POST", payload);
  await Promise.all([renderSchedule(), renderTiles()]);
});

document.getElementById("openCompliance").addEventListener("click", async () => {
  const candidate_number = prompt("Candidate number:");
  const now = new Date();
  const issued = now.toISOString();
  const deadline = new Date(now.getTime() + 24*60*60*1000).toISOString();
  await api("/compliance/open", "POST", { candidate_number, issued_timestamp: issued, deadline_timestamp: deadline });
  await renderSchedule();
});

document.getElementById("endOfDay").addEventListener("click", async () => {
  const report_date = new Date().toISOString().slice(0, 10);
  const payload = {
    report_date,
    agent: { agent_id: "AGENT-ATL-001" },
    agent_signature: { credential_hash: "sha256:agentCredHash" },
    verification: { watermark_hash: "sha256:wmHashABC", block_seal: "ledger-entry-xyz789" }
  };
  const res = await api("/report/eod", "POST", payload);
  alert(`EOD report sealed for ${res.report.report_date} • Batch ${res.report.batch_id}`);
});

async function boot() {
  await Promise.all([renderTiles(), renderSchedule(), renderCancellations(), renderUpdates()]);
}
boot();
{
  "$id": "https://careertrace/manifest/unified.json",
  "title": "Career Trace Unified Manifest",
  "type": "object",
  "required": ["authorship", "agent", "candidate", "checks", "verification", "ledger", "audit", "compliance", "hr", "ethnicity", "quality"],
  "properties": {
    "authorship": {
      "type": "object",
      "required": ["uuid","orcid","uei","author"],
      "properties": {
        "uuid": { "type": "string", "const": "UUIDALICIACLACY" },
        "orcid": { "type": "string", "const": "0009-0008-9127-1581" },
        "uei": { "type": "string", "const": "P163FZ5WD717" },
        "author": { "type": "string", "const": "Alicia Camille Lacy" }
      }
    }
  }
}
wrangler d1 create blue-vizion-db
wrangler d1 execute blue-vizion-db --file=db/schema.sql
wrangler r2 bucket create blue-vizion-certs
[[d1_databases]]
binding = "DB"
database_name = "blue-vizion-db"

[[r2_buckets]]
binding = "CERTS"
bucket_name = "blue-vizion-certs"
// GET /certificate/:candidate_number
if (url.pathname.startsWith("/certificate/") && request.method === "GET") {
  const candidate_number = url.pathname.split("/").pop();
  const row = await env.DB.prepare(
    `SELECT certificate_id, watermark_hash, block_seal, notarized, created_at
     FROM certificates WHERE candidate_number=?`
  ).bind(candidate_number).first();

  if (!row) return json({ error: "not_found" }, 404);

  // Fetch sealed PDF from R2
  const object = await env.CERTS.get(row.certificate_id + ".pdf");
  if (!object) return json({ error: "file_missing" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "X-UUID": "UUIDALICIACLACY",
      "X-ORCID": "0009-0008-9127-1581",
      "X-UEI": "P163FZ5WD717",
      "X-Author": "Alicia Camille Lacy",
      "X-Watermark": row.watermark_hash,
      "X-Block-Seal": row.block_seal,
      "X-Notarized": row.notarized.toString()
    }
  });
}
async function fetchCertificate(candidate_number) {
  const res = await fetch(`${EDGE}/certificate/${candidate_number}`, {
    headers: LINEAGE
  });
  if (!res.ok) {
    alert("Certificate not found");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${candidate_number}-certificate.pdf`;
  link.click();
}
container.innerHTML = data.map(d => `
  <div class="item">
    <strong>${d.candidate_number}</strong> • ${d.service_code} • ${d.remote_office_id} • <em>${d.status}</em>
    <div><small>${d.created_at}</small></div>
    ${d.status === "qualified" ? `<button onclick="fetchCertificate('${d.candidate_number}')">Download Certificate</button>` : ""}
  </div>
`).join("");
// workers/batch-cron.js
export default {
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    const batchId = `BR-${Date.now()}`;

    // Process pending candidates
    const pending = await env.DB.prepare(
      `SELECT candidate_number FROM intake WHERE status='pending'`
    ).all();

    for (const row of pending.results) {
      // Example: mark as awaiting_documents
      await env.DB.prepare(
        `UPDATE intake SET status='awaiting_documents' WHERE candidate_number=?`
      ).bind(row.candidate_number).run();

      await env.DB.prepare(
        `INSERT INTO audit_events (candidate_number, step, actor, result, timestamp)
         VALUES (?, 'batch_processed', 'system', 'awaiting_documents', ?)`
      ).bind(row.candidate_number, now).run();
    }

    // Record batch run
    await env.DB.prepare(
      `INSERT INTO batch_runs (batch_id, run_window, processed, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(batchId, "24-48hrs", pending.results.length, now).run();

    console.log(`Batch run ${batchId} processed ${pending.results.length} candidates`);
    {
  "fork_id": "ATL-REMOTE-001",
  "batch_id": "BR-2025-1120",
  "qualified": 12,
  "awaiting_documents": 5,
  "unqualified": 3,
  "reason_codes": ["DOC-MISSING", "IMM-UNVERIFIED"],
  "authorship": {
    "uuid": "UUIDALICIACLACY",
    "orcid": "0009-0008-9127-1581",
    "uei": "P163FZ5WD717",
    "author": "Alicia Camille Lacy"
  },
  "verification": {
    "watermark_hash": "sha256:wmHashATL",
    "block_seal": "ledger-entry-atl1120",
    "notarized": true
  }
}

  }
};
