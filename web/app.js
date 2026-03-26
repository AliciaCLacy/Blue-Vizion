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

async function fetchCertificate(candidate_number) {
  const res = await fetch(`${EDGE}/certificate/${candidate_number}`, { headers: LINEAGE });
  if (!res.ok) { alert("Certificate not found"); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${candidate_number}-certificate.pdf`;
  link.click();
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
      <div><strong>Unqualified:</strong> ${row.unqualified}</div>`;
    tiles.appendChild(el);
  });
}

async function renderSchedule() {
  const data = await api("/schedule/today");
  const container = document.getElementById("schedule");
  container.className = "list";
  container.innerHTML = data.map(d => `
    <div class="item">
      <strong>${d.candidate_number}</strong> &bull; ${d.service_code} &bull; ${d.remote_office_id} &bull; <em>${d.status}</em>
      <div><small>${d.created_at}</small></div>
      ${d.status === "qualified" ? `<button onclick="fetchCertificate('${d.candidate_number}')">Download Certificate</button>` : ""}
    </div>`).join("");
}

async function renderCancellations() {
  const data = await api("/cancellations/today");
  const container = document.getElementById("cancellations");
  container.className = "list";
  container.innerHTML = data.map(d => `
    <div class="item">
      <strong>${d.candidate_number}</strong> &bull; Reason: <em>${d.reason_code}</em>
      <div><small>${d.timestamp}</small></div>
    </div>`).join("");
}

async function renderUpdates() {
  const data = await api("/updates/today");
  const container = document.getElementById("updates");
  container.className = "list";
  container.innerHTML = data.map(d => `
    <div class="item">
      <strong>${d.candidate_number}</strong> &bull; Update: <em>${d.update_type}</em>
      <div><small>Agent: ${d.agent_signature}</small></div>
      <div><small>${d.timestamp}</small></div>
    </div>`).join("");
}

document.getElementById("beginIntake").addEventListener("click", async () => {
  const candidate_number = prompt("Candidate number:");
  const service_code = prompt("Service code:");
  const ethnicity_code = prompt("Ethnicity code:");
  const remote_office_id = prompt("Remote office id:");

  const payload = {
    candidate: { candidate_number, biometric_hash: "sha256:templateHash", service_code, status: "pending" },
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
  const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
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
  alert(`EOD report sealed for ${res.report.report_date} \u2022 Batch ${res.report.batch_id}`);
});

async function boot() {
  await Promise.all([renderTiles(), renderSchedule(), renderCancellations(), renderUpdates()]);
}
boot();
