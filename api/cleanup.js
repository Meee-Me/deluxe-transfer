// GET /api/cleanup  Run daily by Vercel Cron: deletes expired transfers and abandoned uploads.
import { json, listAll, store, deleteTransfer, FILE_PATH, guarded } from "./_lib.js";

export const GET = guarded(async function GET(request) {
  const want = process.env.CRON_SECRET;
  if (want && request.headers.get("authorization") !== `Bearer ${want}`) return json({ error: "Not allowed." }, 401);
  const byCode = new Map();
  for (const b of await listAll("t/")) {
    const code = b.pathname.split("/")[1];
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(b);
  }
  const now = Date.now();
  let deleted = 0;
  for (const [code, blobs] of byCode) {
    const meta = blobs.find((b) => b.pathname === `t/${code}/meta.json`);
    let expired;
    if (meta) {
      try { const e = (await store.fetchJson(meta.url)).expires; expired = e != null && e < now; } catch { expired = false; }
    } else {
      // never finished: remove once the newest piece is a day old
      expired = blobs.every((b) => now - new Date(b.uploadedAt) > 86400000) || !blobs.some((b) => FILE_PATH.test(b.pathname));
    }
    if (expired) deleted += await deleteTransfer(code);
  }
  return json({ checked: byCode.size, deleted });
});
