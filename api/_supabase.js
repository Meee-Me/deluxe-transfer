// File storage in Supabase Storage, used when the project has Supabase
// connected instead of Vercel Blob. Same shape as the Vercel Blob calls used
// in _lib.js: head, list, put, del, fetchJson, plus a signed upload link.
//
// Settings (added by Vercel's Supabase integration):
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY): server only, never sent to browsers
//   SUPABASE_BUCKET: optional, default "deluxe-transfer" (made public on first use)

export const supabaseUrl = () => String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
export const supabaseKey = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
const bucket = () => String(process.env.SUPABASE_BUCKET || "deluxe-transfer").trim();
export const supabaseReady = () => !!(supabaseUrl() && supabaseKey());

// Swappable in tests.
export const net = { fetch: (url, init) => fetch(url, init) };

// Supabase only allows plain characters in names, so file names are stored
// as "_b64_" + base64url(name) and turned back here.
export const B64 = "_b64_";
export function decodeName(stored) {
  if (!String(stored).startsWith(B64)) return stored;
  try { return Buffer.from(stored.slice(B64.length), "base64url").toString("utf8") || stored; } catch { return stored; }
}

const enc = (path) => path.split("/").map(encodeURIComponent).join("/");
const notFound = () => Object.assign(new Error("Not found"), { name: "BlobNotFoundError" });

function headers(extra = {}) {
  const key = supabaseKey();
  // Legacy keys are JWTs and go in Authorization too; new secret keys go in apikey only.
  return { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: "Bearer " + key } : {}), ...extra };
}

async function call(path, init = {}) {
  const r = await net.fetch(`${supabaseUrl()}/storage/v1${path}`, { ...init, headers: headers(init.headers) });
  return r;
}

async function fail(r, what) {
  const body = await r.text().catch(() => "");
  let msg = body;
  try { const j = JSON.parse(body); msg = j.message || j.error || body; } catch {}
  throw Object.assign(new Error(`Supabase Storage could not ${what}: ${msg || r.status}`), { status: 502 });
}

// The bucket is made (public, so download links work) the first time it is needed.
let bucketReady = null;
export function ensureBucket() {
  bucketReady ||= (async () => {
    const r = await call("/bucket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: bucket(), name: bucket(), public: true }),
    });
    if (r.ok) return;
    const text = await r.text().catch(() => "");
    if (/already exists|Duplicate/i.test(text) || r.status === 409) return;
    bucketReady = null;
    throw Object.assign(new Error(`Supabase Storage could not make the "${bucket()}" bucket: ${text || r.status}`), { status: 502 });
  })();
  return bucketReady;
}

const publicUrl = (path) => `${supabaseUrl()}/storage/v1/object/public/${bucket()}/${enc(path)}`;
const pathOf = (url) => {
  const base = `${supabaseUrl()}/storage/v1/object/public/${bucket()}/`;
  return String(url).startsWith(base) ? String(url).slice(base.length).split("?")[0].split("/").map(decodeURIComponent).join("/") : String(url);
};

// One folder's entries (Supabase lists a folder at a time).
async function listFolder(folder, search) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await call(`/object/list/${bucket()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: "name", order: "asc" }, ...(search ? { search } : {}) }),
    });
    if (r.status === 404 || r.status === 400) {
      // No bucket yet: nothing stored.
      const t = await r.text().catch(() => "");
      if (/not found/i.test(t)) return out;
      throw Object.assign(new Error("Supabase Storage could not list files: " + t), { status: 502 });
    }
    if (!r.ok) await fail(r, "list files");
    const items = await r.json();
    out.push(...items);
    if (items.length < 1000) return out;
  }
}

const asBlob = (path, item, downloadName) => ({
  pathname: path,
  size: Number((item.metadata && (item.metadata.size || item.metadata.contentLength)) || 0),
  uploadedAt: new Date(item.created_at || item.updated_at || Date.now()),
  url: publicUrl(path),
  downloadUrl: publicUrl(path) + "?download=" + encodeURIComponent(downloadName || decodeName(path.split("/").pop())),
});

// Everything under a folder ("t/" or "t/CODE/"), all levels down.
async function listDeep(folder) {
  const blobs = [];
  for (const item of await listFolder(folder.replace(/\/+$/, ""))) {
    if (item.name === ".emptyFolderPlaceholder") continue;
    const path = `${folder.replace(/\/+$/, "")}/${item.name}`;
    if (item.id === null || item.id === undefined) blobs.push(...(await listDeep(path)));
    else blobs.push(asBlob(path, item));
  }
  return blobs;
}

export const supabaseStore = {
  async head(path) {
    const dir = path.split("/").slice(0, -1).join("/"), name = path.split("/").pop();
    const hit = (await listFolder(dir, name)).find((i) => i.name === name && i.id);
    if (!hit) throw notFound();
    return asBlob(path, hit);
  },
  async list({ prefix }) {
    return { blobs: await listDeep(prefix), hasMore: false };
  },
  async put(path, body, opts = {}) {
    await ensureBucket();
    const r = await call(`/object/${bucket()}/${enc(path)}`, {
      method: "POST",
      headers: { "Content-Type": opts.contentType || "application/octet-stream", "x-upsert": opts.allowOverwrite ? "true" : "false" },
      body,
    });
    if (!r.ok) await fail(r, "save " + path);
    return { url: publicUrl(path) };
  },
  async del(urls) {
    if (!urls.length) return;
    const r = await call(`/object/${bucket()}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: urls.map(pathOf) }),
    });
    if (!r.ok && r.status !== 404) await fail(r, "delete files");
  },
  async fetchJson(url) {
    const r = await call(`/object/authenticated/${bucket()}/${enc(pathOf(url))}`, { cache: "no-store" });
    if (!r.ok) await fail(r, "read " + pathOf(url));
    return r.json();
  },
  // A one-time link the browser uploads one file to (PUT).
  async signUpload(path) {
    await ensureBucket();
    const r = await call(`/object/upload/sign/${bucket()}/${enc(path)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) await fail(r, "prepare the upload");
    const { url } = await r.json();
    return `${supabaseUrl()}/storage/v1${url}`;
  },
};
