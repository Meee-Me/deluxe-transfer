// POST /api/finish {code, owner}  Seals a transfer once its files are uploaded.
import { json, cleanCode, isOwner, listAll, prefix, metaPath, metaHead, deleteTransfer,
  publicMeta, store, FILE_PATH, MAX_BYTES, MAX_MB, MAX_FILES, keepHours, guarded, decodeName, foreverAllowed } from "./_lib.js";
import { signedIn } from "./_people.js";

export const POST = guarded(async function POST(request) {
  const { code: raw, owner, hours } = await request.json().catch(() => ({}));
  const code = cleanCode(raw);
  if (!code || !isOwner(code, owner)) return json({ error: "Not allowed." }, 403);
  if (await metaHead(code)) return json({ error: "Already finished." }, 409);
  const forever = hours === "forever";
  if (forever) {
    if (!foreverAllowed()) return json({ error: "Keeping files forever is switched off." }, 400);
    if (!(await signedIn(request))) return json({ error: "Sign in with Deluxe Main to keep files forever.", code: "signin" }, 401);
  }
  const files = (await listAll(prefix(code)))
    .filter((b) => FILE_PATH.test(b.pathname))
    .sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
  if (!files.length) return json({ error: "No files arrived. Try again." }, 400);
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES || files.length > MAX_FILES) {
    await deleteTransfer(code);
    return json({ error: `Too big: the limit is ${MAX_MB} MB and ${MAX_FILES} files.` }, 413);
  }
  const meta = {
    code,
    created: Date.now(),
    expires: forever ? null : Date.now() + keepHours(hours) * 3600 * 1000,
    files: files.map((f) => ({
      name: decodeName(FILE_PATH.exec(f.pathname)[3]).slice(0, 200),
      size: f.size,
      url: f.url,
      downloadUrl: f.downloadUrl,
    })),
  };
  await store.put(metaPath(code), JSON.stringify(meta), {
    access: "public", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json",
  });
  const link = new URL("/d/" + code, request.url).href;
  return json({ ...publicMeta(meta, new URL(request.url).origin, await store.privateFiles()), link });
});
