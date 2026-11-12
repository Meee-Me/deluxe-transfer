// POST /api/share {code, owner, to, note}   Authorization: Bearer <Deluxe Main key>
// Sends the transfer's link to a Deluxe Mail inbox, from the signed-in person,
// with a copy in their Sent folder. Messages are saved in Deluxe Main, where
// Deluxe Mail keeps its mail.
import { randomUUID } from "node:crypto";
import { json, cleanCode, isOwner, loadMeta } from "./_lib.js";

const MAIN = String(process.env.MAIN_URL || "https://deluxe-drive.deluxelordd.workers.dev/main").replace(/\/+$/, "");
const DOMAIN = String(process.env.MAIL_DOMAIN || "deluxemail.com").toLowerCase().replace(/^@/, "");

// Swappable in tests.
export const main = { fetch: (path, init) => fetch(MAIN + path, init) };

const appHeaders = (accountId, extra = {}) => {
  if (!process.env.MAIN_APP_KEY) throw Object.assign(new Error("Deluxe Transfer is not connected to Deluxe Main yet (MAIN_APP_KEY is missing)."), { status: 503 });
  return { Authorization: "App " + process.env.MAIN_APP_KEY, "X-Deluxe-App": "transfer", ...(accountId ? { "X-Deluxe-Account": accountId } : {}), ...extra };
};

async function signedIn(request) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(header)) return null;
  const r = await main.fetch("/api/auth/me", { headers: { Authorization: header } });
  if (r.status >= 500) throw Object.assign(new Error("Deluxe Main could not be reached. Try again in a moment."), { status: 502 });
  if (!r.ok) return null;
  const d = await r.json();
  return d.user && (d.app === "transfer" || d.app === "main") ? d.user : null;
}

async function findAccount(handle) {
  const r = await main.fetch("/api/server/account?handle=" + encodeURIComponent(handle), { headers: appHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error("Deluxe Main could not look that address up."), { status: 502 });
  return (await r.json()).user;
}

async function deliver(accountId, folder, msg) {
  const key = `${folder}/${String(9999999999999 - Date.now()).padStart(13, "0")}-${randomUUID()}`;
  const value = { id: key.split("-").slice(1).join("-"), key, folder, date: Date.now(), read: folder !== "inbox", starred: false, ...msg };
  const r = await main.fetch("/api/data/mail/" + key, {
    method: "PUT",
    headers: appHeaders(accountId, { "Content-Type": "application/json" }),
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw Object.assign(new Error("Deluxe Mail could not take that message (" + r.status + ")."), { status: 502 });
}

const size = (b) => (b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB");

export async function POST(request) {
  try {
    const me = await signedIn(request);
    if (!me) return json({ error: "Sign in with Deluxe Main to send by Deluxe Mail.", code: "signin" }, 401);
    const b = await request.json().catch(() => ({}));
    const code = cleanCode(b.code);
    if (!code || !isOwner(code, b.owner)) return json({ error: "Only the sender can share this transfer." }, 403);
    const meta = await loadMeta(code);
    if (!meta) return json({ error: "This transfer has expired." }, 404);

    const to = String(b.to || "").trim().toLowerCase();
    const handle = to.includes("@") ? to.split("@")[0] : to;
    if (to.includes("@") && to.split("@")[1] !== DOMAIN) return json({ error: `Only Deluxe Mail addresses (@${DOMAIN}) can be sent to.` }, 400);
    if (!/^[a-z0-9._-]{1,30}$/.test(handle)) return json({ error: "Enter a Deluxe Mail address or name." }, 400);
    const rcpt = await findAccount(handle);
    if (!rcpt) return json({ error: `Nobody has the address ${handle}@${DOMAIN}.` }, 404);

    const link = new URL("/d/" + code, request.url).href;
    const until = new Date(meta.expires).toUTCString().replace(" GMT", " UTC");
    const note = String(b.note || "").trim().slice(0, 2000);
    const files = meta.files.map((f) => `  • ${f.name} (${size(f.size)})`).join("\n");
    const n = meta.files.length;
    const from = `${me.handle}@${DOMAIN}`;
    const msg = {
      to: `${rcpt.handle}@${DOMAIN}`,
      subject: `${me.name} sent you ${n === 1 ? meta.files[0].name : n + " files"}`.slice(0, 300),
      body:
        (note ? note + "\n\n" : "") +
        `${me.name} sent you ${n === 1 ? "a file" : n + " files"} with Deluxe Transfer:\n\n${files}\n\n` +
        `Download: ${link}\nCode: ${code}\n\nAvailable until ${until}.`,
    };
    await deliver(rcpt.id, "inbox", { ...msg, from: `${me.name} <${from}>` });
    await deliver(me.id, "sent", { ...msg, from });
    return json({ ok: true, to: msg.to });
  } catch (e) {
    return json({ error: e.status ? e.message : "Could not send that. Try again." }, e.status || 500);
  }
}
