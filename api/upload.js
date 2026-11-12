// POST /api/upload  The browser asks here for permission to upload each file
// straight to storage: a Vercel Blob client token, or (with {mode: "sign"})
// a one-time Supabase Storage upload link.
import { handleUpload } from "@vercel/blob/client";
import { json, isOwner, metaHead, FILE_PATH, MAX_BYTES, store } from "./_lib.js";

export async function allowUpload(pathname, clientPayload) {
  const m = FILE_PATH.exec(pathname);
  let payload = {};
  try { payload = JSON.parse(clientPayload || "{}"); } catch {}
  if (!m || m[1] !== payload.code || !isOwner(m[1], payload.owner)) throw new Error("Not allowed.");
  if (await metaHead(m[1])) throw new Error("This transfer is already finished.");
  return { maximumSizeInBytes: MAX_BYTES, addRandomSuffix: false, allowOverwrite: false };
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body && body.mode === "sign") {
      await allowUpload(String(body.pathname || ""), JSON.stringify({ code: body.code, owner: body.owner }));
      if (Number(body.size) > MAX_BYTES) return json({ error: "That file is too big." }, 413);
      return json({ uploadUrl: await store.signUpload(String(body.pathname)) });
    }
    return json(await handleUpload({ body, request, onBeforeGenerateToken: allowUpload }));
  } catch (e) {
    return json({ error: e.message || "Upload refused." }, 400);
  }
}
