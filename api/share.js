// POST /api/share {code, owner, to: [..] or "..", note}   Authorization: Bearer <Deluxe Main key>
// Sends the transfer to people: a Deluxe Mail message from the signed-in
// sender (with a copy in their Sent), and an entry in each person's Deluxe
// Transfer history. Everything is saved in Deluxe Main.
import { json, guarded, cleanCode, isOwner, loadMeta } from "./_lib.js";
import { signedIn, parseRecipient, findAccount, deliverMail, saveHistory, DOMAIN } from "./_people.js";
export { main } from "./_people.js";

const MAX_PEOPLE = 20;
const size = (b) => (b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB");

export const POST = guarded(async function POST(request) {
  const me = await signedIn(request);
  if (!me) return json({ error: "Sign in with Deluxe Main to send to people.", code: "signin" }, 401);
  const b = await request.json().catch(() => ({}));
  const code = cleanCode(b.code);
  if (!code || !isOwner(code, b.owner)) return json({ error: "Only the sender can share this transfer." }, 403);
  const meta = await loadMeta(code);
  if (!meta) return json({ error: "This transfer has expired." }, 404);

  const list = (Array.isArray(b.to) ? b.to : String(b.to || "").split(/[,;\n]+/)).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return json({ error: "Type a username or a Deluxe Mail address." }, 400);
  if (list.length > MAX_PEOPLE) return json({ error: `Up to ${MAX_PEOPLE} people at a time.` }, 400);

  const link = new URL("/d/" + code, request.url).href;
  const until = new Date(meta.expires).toUTCString().replace(" GMT", " UTC");
  const note = String(b.note || "").trim().slice(0, 2000);
  const n = meta.files.length;
  const what = n === 1 ? meta.files[0].name : n + " files";
  const files = meta.files.map((f) => `  • ${f.name} (${size(f.size)})`).join("\n");
  const from = `${me.handle}@${DOMAIN}`;
  const body =
    (note ? note + "\n\n" : "") +
    `${me.name} sent you ${n === 1 ? "a file" : n + " files"} with Deluxe Transfer:\n\n${files}\n\n` +
    `Download: ${link}\nCode: ${code}\n\nAvailable until ${until}.`;

  const results = [];
  const done = new Set();
  for (const input of list) {
    const parsed = parseRecipient(input);
    if (parsed.error) { results.push({ input, ok: false, error: parsed.error }); continue; }
    if (done.has(parsed.handle)) continue;
    done.add(parsed.handle);
    const person = await findAccount(parsed.handle);
    if (!person) { results.push({ input, ok: false, error: `Nobody is called ${parsed.handle}.` }); continue; }
    const to = `${person.handle}@${DOMAIN}`;
    const msg = { to, subject: `${me.name} sent you ${what}`.slice(0, 300), body };
    await deliverMail(person.id, "inbox", { ...msg, from: `${me.name} <${from}>` });
    await deliverMail(me.id, "sent", { ...msg, from });
    await saveHistory(person.id, "received/" + code, {
      code, link, expires: meta.expires, at: Date.now(), note,
      from: { name: me.name, handle: me.handle },
      files: meta.files.map((f) => ({ name: f.name, size: f.size })),
    });
    results.push({ input, ok: true, to, name: person.name });
  }
  const sent = results.filter((r) => r.ok).length;
  return json({ results, sent }, sent || !results.length ? 200 : 400);
});
