// A small stand-in for Supabase Storage's HTTP API, for tests.
//   const fake = await startFakeSupabase({ key: "sb_secret_x" });  fake.url, fake.objects, fake.close()
import http from "node:http";
import { randomUUID } from "node:crypto";

export async function startFakeSupabase({ key = "sb_secret_test", port = 0 } = {}) {
  const buckets = new Map(); // name -> { public }
  const objects = new Map(); // "bucket/path" -> { body, type, created_at, id }
  const tokens = new Map(); // token -> "bucket/path"
  const SAFE = /^[\w\/!\-.*'() &$@=;:+,?]*$/; // Supabase's allowed key characters

  const server = http.createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-allow-methods", "*");
    if (req.method === "OPTIONS") return res.end();
    const url = new URL(req.url, "http://x");
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    const p = decodeURIComponent(url.pathname).replace(/^\/storage\/v1/, "");
    const authed = req.headers.apikey === key;
    let m;

    // public downloads and signed uploads need no key
    if ((m = /^\/object\/public\/([^/]+)\/(.+)$/.exec(p)) && req.method === "GET") {
      const o = objects.get(m[1] + "/" + m[2]);
      if (!o || !buckets.get(m[1])?.public) return send(400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const dl = url.searchParams.get("download");
      res.writeHead(200, { "content-type": o.type, ...(dl !== null ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(dl)}` } : {}) });
      return res.end(o.body);
    }
    if ((m = /^\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(p)) && req.method === "PUT") {
      const t = url.searchParams.get("token");
      if (tokens.get(t) !== m[1] + "/" + m[2]) return send(400, { message: "Invalid signature" });
      tokens.delete(t);
      if (objects.has(m[1] + "/" + m[2])) return send(400, { statusCode: "409", message: "The resource already exists" });
      objects.set(m[1] + "/" + m[2], { body, type: req.headers["content-type"] || "application/octet-stream", created_at: new Date().toISOString(), id: randomUUID() });
      return send(200, { Key: m[1] + "/" + m[2] });
    }
    if (!authed) return send(400, { statusCode: "403", message: "Invalid Compact JWS" });

    if (p === "/bucket" && req.method === "POST") {
      const { id, public: pub } = JSON.parse(body);
      if (buckets.has(id)) return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      buckets.set(id, { public: !!pub });
      return send(200, { name: id });
    }
    if ((m = /^\/object\/list\/([^/]+)$/.exec(p)) && req.method === "POST") {
      if (!buckets.has(m[1])) return send(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
      const { prefix = "", search = "", limit = 100, offset = 0 } = JSON.parse(body);
      const base = prefix ? prefix.replace(/\/+$/, "") + "/" : "";
      const seen = new Map();
      for (const [k, o] of objects) {
        if (!k.startsWith(m[1] + "/" + base)) continue;
        const rest = k.slice(m[1].length + 1 + base.length);
        const [first, ...more] = rest.split("/");
        if (search && !first.startsWith(search)) continue;
        if (more.length) seen.set(first, { name: first, id: null, metadata: null });
        else seen.set(first, { name: first, id: o.id, created_at: o.created_at, updated_at: o.created_at, metadata: { size: o.body.length, mimetype: o.type } });
      }
      return send(200, [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit));
    }
    if ((m = /^\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(p)) && req.method === "POST") {
      if (!SAFE.test(m[2])) return send(400, { message: "Invalid key: " + m[2] });
      const t = randomUUID();
      tokens.set(t, m[1] + "/" + m[2]);
      return send(200, { url: `/object/upload/sign/${m[1]}/${m[2].split("/").map(encodeURIComponent).join("/")}?token=${t}` });
    }
    if ((m = /^\/object\/authenticated\/([^/]+)\/(.+)$/.exec(p)) && req.method === "GET") {
      const o = objects.get(m[1] + "/" + m[2]);
      if (!o) return send(400, { statusCode: "404", message: "Object not found" });
      res.writeHead(200, { "content-type": o.type }); return res.end(o.body);
    }
    if ((m = /^\/object\/([^/]+)$/.exec(p)) && req.method === "DELETE") {
      const { prefixes } = JSON.parse(body);
      const gone = prefixes.filter((k) => objects.delete(m[1] + "/" + k));
      return send(200, gone.map((name) => ({ name })));
    }
    if ((m = /^\/object\/([^/]+)\/(.+)$/.exec(p)) && req.method === "POST") {
      if (!SAFE.test(m[2])) return send(400, { message: "Invalid key: " + m[2] });
      const k = m[1] + "/" + m[2];
      if (objects.has(k) && req.headers["x-upsert"] !== "true") return send(400, { statusCode: "409", message: "The resource already exists" });
      objects.set(k, { body, type: req.headers["content-type"], created_at: new Date().toISOString(), id: randomUUID() });
      return send(200, { Key: k });
    }
    send(404, { message: "no route " + req.method + " " + p });
  });
  await new Promise((ok) => server.listen(port, ok));
  return { url: `http://localhost:${server.address().port}`, objects, buckets, close: () => { server.closeAllConnections(); server.close(); } };
}
