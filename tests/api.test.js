import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.BLOB_ACCESS = "public";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststore_secretsecretsecret";
process.env.MAX_MB = "1";
const lib = await import("../api/_lib.js");
const { POST: create } = await import("../api/create.js");
const { POST: uploadRoute, allowUpload } = await import("../api/upload.js");
const { POST: finish } = await import("../api/finish.js");
const { GET: get, DELETE: del } = await import("../api/transfer.js");
const { GET: cleanup } = await import("../api/cleanup.js");

// in-memory Blob store
let blobs;
const notFound = () => Object.assign(new Error("not found"), { name: "BlobNotFoundError" });
Object.assign(lib.store, {
  head: async (p) => { const b = blobs.get(p); if (!b) throw notFound(); return b; },
  list: async ({ prefix }) => ({ blobs: [...blobs.values()].filter((b) => b.pathname.startsWith(prefix)), hasMore: false }),
  put: async (p, body, o) => {
    if (blobs.has(p) && !o.allowOverwrite) throw new Error("exists");
    blobs.set(p, mk(p, body.length, body));
  },
  del: async (urls) => { for (const [k, b] of blobs) if (urls.includes(b.url)) blobs.delete(k); },
  fetchJson: async (url) => JSON.parse([...blobs.values()].find((b) => b.url === url).body),
});
const mk = (p, size, body = "", uploadedAt = new Date()) =>
  ({ pathname: p, size, body, uploadedAt, url: "https://x.public.blob.vercel-storage.com/" + p, downloadUrl: "https://x.public.blob.vercel-storage.com/" + p + "?download=1" });
const req = (method, path, body, headers = {}) =>
  new Request("https://transfer.example" + path, { method, body: body && JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const DIR = "abcdefghijklmnopqrstuvwx";

beforeEach(() => { blobs = new Map(); });

test("send and receive", async () => {
  const { code, owner } = await (await create(req("POST", "/api/create"))).json();
  assert.match(code, /^[A-Z2-9]{6}$/);
  const path = `t/${code}/${DIR}/hello world.txt`;
  const opts = await allowUpload(path, JSON.stringify({ code, owner }));
  assert.equal(opts.maximumSizeInBytes, 1024 * 1024);
  blobs.set(path, mk(path, 5));
  blobs.set(`t/${code}/${DIR}x/two.pdf`, mk(`t/${code}/${DIR}x/two.pdf`, 7, "", new Date(Date.now() + 1000)));

  assert.equal((await finish(req("POST", "/api/finish", { code, owner: "nope" }))).status, 403);
  const r = await finish(req("POST", "/api/finish", { code: code.toLowerCase(), owner }));
  assert.equal(r.status, 200);
  const sent = await r.json();
  assert.equal(sent.link, "https://transfer.example/d/" + code);
  assert.deepEqual(sent.files.map((f) => f.name), ["hello world.txt", "two.pdf"]);
  assert.equal((await finish(req("POST", "/api/finish", { code, owner }))).status, 409);
  await assert.rejects(allowUpload(`t/${code}/${DIR}/late.txt`, JSON.stringify({ code, owner })), /already finished/);

  const got = await (await get(req("GET", "/api/transfer?code=" + code))).json();
  assert.equal(got.files[0].url, blobs.get(path).downloadUrl);
  assert.equal(got.owner, undefined);

  assert.equal((await del(req("DELETE", "/api/transfer?code=" + code))).status, 403);
  assert.equal((await del(req("DELETE", "/api/transfer?code=" + code, null, { "x-owner": owner }))).status, 200);
  assert.equal(blobs.size, 0);
  assert.equal((await get(req("GET", "/api/transfer?code=" + code))).status, 404);
});

test("upload permission is checked", async () => {
  const { code, owner } = await (await create(req("POST", "/api/create"))).json();
  const p = JSON.stringify({ code, owner });
  await assert.rejects(allowUpload(`t/${code}/${DIR}/a.txt`, JSON.stringify({ code, owner: "x" })));
  await assert.rejects(allowUpload(`t/${code}/short/a.txt`, p));
  await assert.rejects(allowUpload(`t/OTHER2/${DIR}/a.txt`, p));
  await assert.rejects(allowUpload(`t/${code}/${DIR}/meta.json/x`, p));
  await assert.rejects(allowUpload(`t/${code}/meta.json`, p));
});

test("upload route hands out a client token", async () => {
  const { code, owner } = await (await create(req("POST", "/api/create"))).json();
  const body = { type: "blob.generate-client-token", payload: { pathname: `t/${code}/${DIR}/a.txt`, clientPayload: JSON.stringify({ code, owner }), multipart: false } };
  const ok = await (await uploadRoute(req("POST", "/api/upload", body))).json();
  assert.match(ok.clientToken, /^vercel_blob_client_/);
  body.payload.clientPayload = "{}";
  assert.equal((await uploadRoute(req("POST", "/api/upload", body))).status, 400);
});

test("the sender picks how long files stay", async () => {
  const keep = async (hours) => {
    const { code, owner } = await (await create(req("POST", "/api/create"))).json();
    blobs.set(`t/${code}/${DIR}/a.txt`, mk(`t/${code}/${DIR}/a.txt`, 1));
    const d = await (await finish(req("POST", "/api/finish", { code, owner, hours }))).json();
    return Math.round((d.expires - Date.now()) / 3600000);
  };
  assert.equal(await keep(1), 1);
  assert.equal(await keep(168), 168);
  assert.equal(await keep(undefined), 24);
  assert.equal(await keep(9999), 24, "only the offered choices");
});

test("too big is refused and removed", async () => {
  const { code, owner } = await (await create(req("POST", "/api/create"))).json();
  blobs.set(`t/${code}/${DIR}/big.bin`, mk(`t/${code}/${DIR}/big.bin`, 2 * 1024 * 1024));
  assert.equal((await finish(req("POST", "/api/finish", { code, owner }))).status, 413);
  assert.equal(blobs.size, 0);
});

test("expired and abandoned transfers are cleaned up", async () => {
  const old = new Date(Date.now() - 2 * 86400000);
  blobs.set(`t/AAAAAA/${DIR}/a`, mk(`t/AAAAAA/${DIR}/a`, 1));
  blobs.set("t/AAAAAA/meta.json", mk("t/AAAAAA/meta.json", 1, JSON.stringify({ expires: Date.now() - 1 })));
  blobs.set(`t/BBBBBB/${DIR}/b`, mk(`t/BBBBBB/${DIR}/b`, 1));
  blobs.set("t/BBBBBB/meta.json", mk("t/BBBBBB/meta.json", 1, JSON.stringify({ expires: Date.now() + 9e6 })));
  blobs.set(`t/CCCCCC/${DIR}/c`, mk(`t/CCCCCC/${DIR}/c`, 1, "", old));
  blobs.set(`t/DDDDDD/${DIR}/d`, mk(`t/DDDDDD/${DIR}/d`, 1));
  assert.equal((await get(req("GET", "/api/transfer?code=AAAAAA"))).status, 404);
  process.env.CRON_SECRET = "s";
  assert.equal((await cleanup(req("GET", "/api/cleanup"))).status, 401);
  const r = await (await cleanup(req("GET", "/api/cleanup", null, { authorization: "Bearer s" }))).json();
  delete process.env.CRON_SECRET;
  assert.equal(r.deleted, 3);
  assert.deepEqual([...blobs.keys()].sort(), [`t/BBBBBB/${DIR}/b`, "t/BBBBBB/meta.json", `t/DDDDDD/${DIR}/d`]);
});

test("a private store: files are served through the site, safely", async () => {
  const { GET: file } = await import("../api/file.js");
  const { code, owner } = await (await create(req("POST", "/api/create"))).json();
  blobs.set(`t/${code}/${DIR}/photo.png`, mk(`t/${code}/${DIR}/photo.png`, 3));
  blobs.set(`t/${code}/${DIR}x/page.html`, mk(`t/${code}/${DIR}x/page.html`, 5, "", new Date(Date.now() + 1000)));
  const types = { "photo.png": "image/png", "page.html": "text/html" };
  const saved = { privateFiles: lib.store.privateFiles, open: lib.store.open };
  lib.store.privateFiles = async () => true;
  lib.store.open = async (url) => ({ stream: new Blob(["data"]).stream(), contentType: types[url.split("/").pop()], size: 4 });
  try {
    await finish(req("POST", "/api/finish", { code, owner }));
    const got = await (await get(req("GET", "/api/transfer?code=" + code))).json();
    assert.equal(got.files[0].url, `https://transfer.example/api/file?code=${code}&n=0&download=1`);
    const view = await file(req("GET", `/api/file?code=${code}&n=0`));
    assert.equal(view.headers.get("content-type"), "image/png");
    assert.match(view.headers.get("content-disposition"), /^inline; .*photo\.png/);
    assert.equal(await view.text(), "data");
    const page = await file(req("GET", `/api/file?code=${code}&n=1`));
    assert.match(page.headers.get("content-disposition"), /^attachment/, "web pages are never shown on the site");
    assert.equal(page.headers.get("content-type"), "application/octet-stream");
    assert.match(page.headers.get("content-security-policy"), /sandbox/);
    assert.equal((await file(req("GET", `/api/file?code=${code}&n=7`))).status, 404);
    assert.equal((await file(req("GET", `/api/file?code=ZZZZZZ&n=0`))).status, 404);
  } finally { Object.assign(lib.store, saved); }
});

test("forever: only when signed in, never expires, never cleaned up", async () => {
  const { main } = await import("../api/_people.js");
  const saved = main.fetch;
  main.fetch = async (path, init = {}) => path === "/api/auth/me" && init.headers.Authorization === "Bearer good"
    ? new Response(JSON.stringify({ user: { id: "u1", name: "A", handle: "a" }, app: "transfer" }))
    : new Response("{}", { status: 401 });
  try {
    const { code, owner } = await (await create(req("POST", "/api/create"))).json();
    blobs.set(`t/${code}/${DIR}/a.txt`, mk(`t/${code}/${DIR}/a.txt`, 1));
    assert.equal((await finish(req("POST", "/api/finish", { code, owner, hours: "forever" }))).status, 401, "guests can't");
    const r = await finish(req("POST", "/api/finish", { code, owner, hours: "forever" }, { authorization: "Bearer good" }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).expires, null);
    assert.equal((await get(req("GET", "/api/transfer?code=" + code))).status, 200);
    const c = await (await cleanup(req("GET", "/api/cleanup"))).json();
    assert.ok(blobs.has(`t/${code}/meta.json`), "cleanup keeps it");
    assert.equal(typeof c.deleted, "number");
  } finally { main.fetch = saved; }
});
