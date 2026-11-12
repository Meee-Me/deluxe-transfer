// Shared code for the API. Files starting with "_" are not deployed as their own endpoints.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import * as blob from "@vercel/blob";

export const MAX_MB = Number(process.env.MAX_MB || 100);
export const MAX_BYTES = MAX_MB * 1024 * 1024;
export const EXPIRE_HOURS = Number(process.env.EXPIRE_HOURS || 24);
// How long a sender may keep files (hours): the default, or one of these.
export const KEEP_CHOICES = [1, 24, 72, 168].filter((h) => h <= Number(process.env.MAX_EXPIRE_HOURS || 168));
export const keepHours = (asked) => (KEEP_CHOICES.includes(Number(asked)) ? Number(asked) : EXPIRE_HOURS);
export const MAX_FILES = 50;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const CODE_LEN = 6;

// Swappable so tests can use an in-memory store.
export const store = {
  head: (p) => blob.head(p),
  list: (o) => blob.list(o),
  put: (p, body, o) => blob.put(p, body, o),
  del: (urls) => blob.del(urls),
  fetchJson: async (url) => (await fetch(url, { cache: "no-store" })).json(),
};

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function newCode() {
  let c = "";
  for (let i = 0; i < CODE_LEN; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return c;
}

export function cleanCode(code) {
  code = String(code || "").trim().toUpperCase();
  return code.length === CODE_LEN && [...code].every((c) => CODE_CHARS.includes(c)) ? code : null;
}

const NO_STORAGE =
  "Storage isn't connected yet. In Vercel, open this project's Storage tab, create a Blob store (Public) and connect it, then redeploy.";

function secret() {
  const s = process.env.TRANSFER_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (!s) throw Object.assign(new Error(NO_STORAGE), { status: 503 });
  return s;
}

// Wraps an API handler so every failure answers with a message people can act on.
export function guarded(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (e) {
      const msg = String((e && e.message) || "");
      console.error(request.method, request.url, e);
      if (/blob credentials|read-write token|BLOB_READ_WRITE_TOKEN/i.test(msg)) return json({ error: NO_STORAGE, code: "no-storage" }, 503);
      if (e && e.status) return json({ error: msg }, e.status);
      return json({ error: "The server had a problem: " + (msg.replace(/^Vercel Blob: /, "") || "unknown error") }, 500);
    }
  };
}

// The sender's key for a transfer: lets them upload into it and delete it.
export const ownerKey = (code) => createHmac("sha256", secret()).update("owner:" + code).digest("base64url");

export function isOwner(code, key) {
  const a = Buffer.from(ownerKey(code));
  const b = Buffer.from(String(key || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const prefix = (code) => `t/${code}/`;
export const metaPath = (code) => `t/${code}/meta.json`;
// t/CODE/<random folder>/<file name>  — the random folder keeps file addresses unguessable
export const FILE_PATH = /^t\/([A-Z0-9]{6})\/([A-Za-z0-9]{20,64})\/([^/]{1,200})$/;

export async function listAll(pfx) {
  const blobs = [];
  let cursor;
  do {
    const page = await store.list({ prefix: pfx, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function exists(path) {
  try {
    return await store.head(path);
  } catch (e) {
    if (e instanceof blob.BlobNotFoundError || e?.name === "BlobNotFoundError") return null;
    throw e;
  }
}

export const metaHead = (code) => exists(metaPath(code));

// The finished transfer, or null if missing/expired.
export async function loadMeta(code) {
  const h = await metaHead(code);
  if (!h) return null;
  const meta = await store.fetchJson(h.url);
  return meta.expires > Date.now() ? meta : null;
}

export async function deleteTransfer(code) {
  const blobs = await listAll(prefix(code));
  for (let i = 0; i < blobs.length; i += 500) await store.del(blobs.slice(i, i + 500).map((b) => b.url));
  return blobs.length;
}

export const publicMeta = (m) => ({
  code: m.code,
  expires: m.expires,
  files: m.files.map((f) => ({ name: f.name, size: f.size, url: f.downloadUrl })),
});
