// POST /api/upload  The browser asks here for permission to upload each file straight to Vercel Blob.
import { handleUpload } from "@vercel/blob/client";
import { json, isOwner, metaHead, FILE_PATH, MAX_BYTES } from "./_lib.js";

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
    return json(await handleUpload({ body, request, onBeforeGenerateToken: allowUpload }));
  } catch (e) {
    return json({ error: e.message || "Upload refused." }, 400);
  }
}
