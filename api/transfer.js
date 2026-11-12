// GET    /api/transfer?code=ABC123   -> the files
// DELETE /api/transfer?code=ABC123   (header X-Owner) -> deletes it
import { json, cleanCode, loadMeta, isOwner, deleteTransfer, publicMeta, guarded } from "./_lib.js";

const codeOf = (request) => cleanCode(new URL(request.url).searchParams.get("code"));
const missing = () => json({ error: "No transfer with that code, or it has expired." }, 404);

export const GET = guarded(async function GET(request) {
  const code = codeOf(request);
  const meta = code && (await loadMeta(code));
  return meta ? json(publicMeta(meta)) : missing();
});

export const DELETE = guarded(async function DELETE(request) {
  const code = codeOf(request);
  if (!code) return missing();
  if (!isOwner(code, request.headers.get("x-owner"))) return json({ error: "Only the sender can delete this." }, 403);
  await deleteTransfer(code);
  return json({ ok: true });
});
