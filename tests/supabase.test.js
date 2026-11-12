import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startFakeSupabase } from "./fake-supabase.mjs";

const fake = await startFakeSupabase({ key: "sb_secret_test" });
after(() => fake.close());
delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

const { POST: create } = await import("../api/create.js");
const { POST: uploadRoute } = await import("../api/upload.js");
const { POST: finish } = await import("../api/finish.js");
const { GET: get, DELETE: del } = await import("../api/transfer.js");
const { GET: health } = await import("../api/health.js");
const { GET: cleanup } = await import("../api/cleanup.js");

const req = (method, path, body, headers = {}) =>
  new Request("https://transfer.example" + path, { method, body: body && JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const b64 = (s) => "_b64_" + Buffer.from(s).toString("base64url");
const DIR = "abcdefghijklmnopqrstuvwx";

test("works on Supabase Storage", async () => {
  assert.deepEqual(await (await health(req("GET", "/api/health"))).json(), { ok: true, storage: true, backend: "supabase", deluxeMail: false });

  const { code, owner } = await (await create(req("POST", "/api/create"))).json();
  const name = "Café notes – 1.pdf";
  const pathname = `t/${code}/${DIR}/${b64(name)}`;

  // a stranger can't get an upload link
  assert.equal((await uploadRoute(req("POST", "/api/upload", { mode: "sign", code, owner: "x", pathname }))).status, 400);
  const { uploadUrl } = await (await uploadRoute(req("POST", "/api/upload", { mode: "sign", code, owner, pathname, size: 5 }))).json();
  assert.ok(uploadUrl.startsWith(fake.url + "/storage/v1/object/upload/sign/deluxe-transfer/"));
  // the browser's upload
  const up = await fetch(uploadUrl, { method: "PUT", body: "hello", headers: { "content-type": "application/pdf", "x-upsert": "false" } });
  assert.equal(up.status, 200);
  assert.ok(fake.buckets.get("deluxe-transfer").public, "bucket made public");

  const done = await (await finish(req("POST", "/api/finish", { code, owner, hours: 1 }))).json();
  assert.deepEqual(done.files.map((f) => [f.name, f.size]), [[name, 5]]);
  // can't add files after it's finished
  assert.equal((await uploadRoute(req("POST", "/api/upload", { mode: "sign", code, owner, pathname: `t/${code}/${DIR}x/${b64("late.txt")}` }))).status, 400);

  const got = await (await get(req("GET", "/api/transfer?code=" + code))).json();
  const dl = await fetch(got.files[0].url);
  assert.equal(await dl.text(), "hello");
  assert.match(decodeURIComponent(dl.headers.get("content-disposition")), /Café notes – 1\.pdf/);

  assert.equal((await del(req("DELETE", "/api/transfer?code=" + code, null, { "x-owner": owner }))).status, 200);
  assert.equal([...fake.objects.keys()].filter((k) => k.includes(code)).length, 0);
  assert.equal((await get(req("GET", "/api/transfer?code=" + code))).status, 404);
});

test("cleanup removes expired transfers on Supabase", async () => {
  const { code, owner } = await (await create(req("POST", "/api/create"))).json();
  const { uploadUrl } = await (await uploadRoute(req("POST", "/api/upload", { mode: "sign", code, owner, pathname: `t/${code}/${DIR}/${b64("a.txt")}` }))).json();
  await fetch(uploadUrl, { method: "PUT", body: "x" });
  await finish(req("POST", "/api/finish", { code, owner }));
  const k = `deluxe-transfer/t/${code}/meta.json`;
  const meta = JSON.parse(fake.objects.get(k).body); meta.expires = Date.now() - 1;
  fake.objects.get(k).body = Buffer.from(JSON.stringify(meta));
  const r = await (await cleanup(req("GET", "/api/cleanup"))).json();
  assert.equal(r.deleted, 2);
  assert.equal([...fake.objects.keys()].filter((x) => x.includes(code)).length, 0);
});
