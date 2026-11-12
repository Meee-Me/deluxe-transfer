import { test } from "node:test";
import assert from "node:assert/strict";

test("without storage, the reason is given", async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.TRANSFER_SECRET;
  const { POST } = await import("../api/create.js?nostore");
  const r = await POST(new Request("https://x.test/api/create", { method: "POST" }));
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /Storage isn't connected/);
  const { GET } = await import("../api/health.js");
  assert.deepEqual(await (await GET(new Request("https://x.test/api/health"))).json(), { ok: true, storage: false, backend: null, deluxeMail: false });
});
