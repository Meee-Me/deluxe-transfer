// POST /api/share {code, owner, to: [..] or "..", note}   Authorization: Bearer <Deluxe Main key>
// Sends the transfer to people's Deluxe Transfer inbox: an unread entry in
// their Transfer data, saved in Deluxe Main. Nothing is sent by mail.
import { json, guarded, cleanCode, isOwner, loadMeta } from "./_lib.js";
import { signedIn, parseRecipient, findAccount, saveHistory } from "./_people.js";
export { main } from "./_people.js";

const MAX_PEOPLE = 20;

export const POST = guarded(async function POST(request) {
  const me = await signedIn(request);
  if (!me) return json({ error: "Sign in with Deluxe Main to send to people.", code: "signin" }, 401);
  const b = await request.json().catch(() => ({}));
  const code = cleanCode(b.code);
  if (!code || !isOwner(code, b.owner)) return json({ error: "Only the sender can share this transfer." }, 403);
  const meta = await loadMeta(code);
  if (!meta) return json({ error: "This transfer has expired." }, 404);

  const list = (Array.isArray(b.to) ? b.to : String(b.to || "").split(/[,;\n]+/)).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return json({ error: "Type a username." }, 400);
  if (list.length > MAX_PEOPLE) return json({ error: `Up to ${MAX_PEOPLE} people at a time.` }, 400);

  const link = new URL("/d/" + code, request.url).href;
  const note = String(b.note || "").trim().slice(0, 2000);
  const results = [];
  const done = new Set();
  for (const input of list) {
    const parsed = parseRecipient(input);
    if (parsed.error) { results.push({ input, ok: false, error: parsed.error }); continue; }
    if (done.has(parsed.handle)) continue;
    done.add(parsed.handle);
    const person = await findAccount(parsed.handle);
    if (!person) { results.push({ input, ok: false, error: `Nobody is called ${parsed.handle}.` }); continue; }
    await saveHistory(person.id, "received/" + code, {
      code, link, expires: meta.expires, at: Date.now(), note, unread: true,
      from: { name: me.name, handle: me.handle },
      files: meta.files.map((f) => ({ name: f.name, size: f.size })),
    });
    results.push({ input, ok: true, handle: person.handle, name: person.name });
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ results, sent }, sent || !results.length ? 200 : 400);
});
