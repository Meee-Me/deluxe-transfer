// GET /api/file?code=ABC234&n=0[&download=1]
// Serves one file of a transfer from a private Blob store to anyone with the
// code (public stores and Supabase link to the files directly instead).
import { json, guarded, cleanCode, loadMeta, store } from "./_lib.js";

const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-disposition, content-length" };

export const GET = guarded(async function GET(request) {
  const url = new URL(request.url);
  const code = cleanCode(url.searchParams.get("code"));
  const meta = code && (await loadMeta(code));
  const f = meta && meta.files[Number(url.searchParams.get("n"))];
  if (!f) return json({ error: "No such file, or it has expired." }, 404);
  const got = await store.open(f.url);
  if (!got) return json({ error: "That file is no longer stored." }, 404);
  // Only plain media and PDFs may open in the browser; anything else (a web
  // page, an SVG, a script) is always downloaded, never shown on this site.
  const type = String(got.contentType || "").toLowerCase();
  const viewable = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/|audio\/|application\/pdf$)/.test(type);
  const kind = url.searchParams.get("download") === "1" || !viewable ? "attachment" : "inline";
  const ascii = f.name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(got.stream, {
    headers: {
      ...cors,
      "content-type": viewable ? type : "application/octet-stream",
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
      ...(got.size ? { "content-length": String(got.size) } : {}),
      "content-disposition": `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});
