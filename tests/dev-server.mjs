// Local stand-in for Vercel: serves public/, runs api/*.js, keeps "Blob" files in memory.
// node tests/dev-server.mjs  -> http://localhost:3000   (uploads need the browser test's fake Blob API)
// STORAGE=supabase: use a pretend Supabase Storage instead (tests/fake-supabase.mjs).
import http from "node:http";
import { readFile } from "node:fs/promises";
const SUPA = process.env.STORAGE === "supabase";
if (SUPA) {
  const { startFakeSupabase } = await import("./fake-supabase.mjs");
  const fake = await startFakeSupabase({ key: "sb_secret_local" });
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.SUPABASE_URL = fake.url;
  process.env.SUPABASE_SECRET_KEY = "sb_secret_local";
  console.log("pretend Supabase at " + fake.url);
} else {
  process.env.BLOB_READ_WRITE_TOKEN ||= "vercel_blob_rw_local_secretsecretsecret";
  process.env.BLOB_ACCESS ||= "public";
}
const lib = await import("../api/_lib.js");
const blobs = new Map();
const PORT = Number(process.env.PORT || 3000);
const BASE = `http://localhost:${PORT}/_blob/`;
const nf = () => Object.assign(new Error("not found"), { name: "BlobNotFoundError" });
const rec = (p, body, type) => ({ type, pathname: p, size: body.length, body, uploadedAt: new Date(), url: BASE + p, downloadUrl: BASE + p + "?download=1" });
if (!SUPA) Object.assign(lib.store, {
  head: async (p) => { if (!blobs.has(p)) throw nf(); return blobs.get(p); },
  list: async ({ prefix }) => ({ blobs: [...blobs.values()].filter((b) => b.pathname.startsWith(prefix)), hasMore: false }),
  put: async (p, body) => { blobs.set(p, rec(p, Buffer.from(body))); },
  del: async (urls) => { for (const [k, b] of blobs) if (urls.includes(b.url)) blobs.delete(k); },
  fetchJson: async (url) => JSON.parse(blobs.get(url.slice(BASE.length)).body),
  // BLOB_ACCESS=private: files are read here and served by /api/file
  open: async (url) => { const b = blobs.get(url.slice(BASE.length)); return b ? { stream: new Blob([b.body]).stream(), contentType: b.type || "application/octet-stream", size: b.body.length } : null; },
});
const routes = {};
for (const n of ["create", "upload", "finish", "transfer", "cleanup", "share", "lookup", "health", "file"]) routes[n] = await import(`../api/${n}.js`);

// FAKE_MAIN=1: a pretend Deluxe Main where any Bearer key is "Test Person" and mail is printed.
if (process.env.FAKE_MAIN === "1") {
  process.env.MAIN_APP_KEY ||= "local";
  routes.share.main.fetch = async (path, init = {}) => {
    const reply = (status, body) => new Response(JSON.stringify(body), { status });
    if (path === "/api/auth/me") return reply(200, { user: { id: "u1", name: "Test Person", handle: "test.person" }, app: "transfer" });
    if (path.startsWith("/api/server/account")) { const h = decodeURIComponent(path.split("=")[1]); return h === "nobody" ? reply(404, {}) : reply(200, { user: { id: "u-" + h, name: h, handle: h } }); }
    if (/^\/api\/data\/(mail|transfer)\//.test(path)) { console.log("SAVE " + path.split("/")[3], init.headers["X-Deluxe-Account"], JSON.stringify(JSON.parse(init.body).value)); return reply(200, { ok: true }); }
    return reply(404, {});
  };
}

http.createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "*"); res.setHeader("access-control-allow-methods", "*");
  if (req.method === "OPTIONS") return res.end();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (url.pathname === "/_blob_put" || (url.pathname.startsWith("/_blob_api") && req.method === "PUT")) { const r = rec(url.searchParams.get("pathname"), body, req.headers["x-content-type"] || req.headers["content-type"]); blobs.set(r.pathname, r); res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ url: r.url, downloadUrl: r.downloadUrl, pathname: r.pathname, contentType: "application/octet-stream", contentDisposition: "attachment" })); }
  if (url.pathname.startsWith("/_blob/")) { const b = blobs.get(decodeURIComponent(url.pathname.slice(7))); res.statusCode = b ? 200 : 404; return res.end(b ? b.body : "gone"); }
  const api = /^\/api\/(\w+)$/.exec(url.pathname);
  if (api && routes[api[1]]?.[req.method]) {
    const r = await routes[api[1]][req.method](new Request(url, { method: req.method, headers: req.headers, body: body.length ? body : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const file = url.pathname === "/" || /^\/d\/[^/]+$/.test(url.pathname) ? "index.html" : url.pathname.slice(1);
  try {
    const data = await readFile(new URL("../public/" + file, import.meta.url));
    res.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : "text/html"); res.end(data);
  } catch { res.statusCode = 404; res.end("not found"); }
}).listen(PORT, () => console.log("http://localhost:" + PORT));
