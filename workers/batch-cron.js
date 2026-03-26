export default {
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    const batchId = `BR-${Date.now()}`;

    // Process pending candidates
    const pending = await env.DB.prepare(
      `SELECT candidate_number FROM intake WHERE status='pending'`
    ).all();

    for (const row of pending.results) {
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
  }
};
