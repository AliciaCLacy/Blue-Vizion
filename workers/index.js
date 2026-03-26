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

    // Cancellations
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

    // Manual updates
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
      ).bind(body.candidate_number, issued.toISOString(), deadline.toISOString()).run();

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

    // GET /certificate/:candidate_number
    if (url.pathname.startsWith("/certificate/") && request.method === "GET") {
      const candidate_number = url.pathname.split("/").pop();
      const row = await env.DB.prepare(
        `SELECT certificate_id, watermark_hash, block_seal, notarized, created_at
         FROM certificates WHERE candidate_number=?`
      ).bind(candidate_number).first();

      if (!row) return json({ error: "not_found" }, 404);

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

    // Aggregates for dashboard tiles
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

    // End-of-day report
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
      ).bind(report.report_date, report.batch_id, JSON.stringify(report), new Date().toISOString()).run();

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
