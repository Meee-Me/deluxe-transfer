// Deluxe accounts and Deluxe Mail, through Deluxe Main.
import { randomUUID } from "node:crypto";

const MAIN = String(process.env.MAIN_URL || "https://deluxe-drive.deluxelordd.workers.dev/main").replace(/\/+$/, "");
export const DOMAIN = String(process.env.MAIL_DOMAIN || "deluxemail.com").toLowerCase().replace(/^@/, "");

// Swappable in tests.
export const main = { fetch: (path, init) => fetch(MAIN + path, init) };

const fail = (message, status) => Object.assign(new Error(message), { status });

function appHeaders(accountId, extra = {}) {
  if (!process.env.MAIN_APP_KEY) throw fail("Sending to people isn't switched on yet: MAIN_APP_KEY is missing on Vercel.", 503);
  return { Authorization: "App " + process.env.MAIN_APP_KEY, "X-Deluxe-App": "transfer", ...(accountId ? { "X-Deluxe-Account": accountId } : {}), ...extra };
}

// The person signed in on this page (with Deluxe Main), or null.
export async function signedIn(request) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(header)) return null;
  const r = await main.fetch("/api/auth/me", { headers: { Authorization: header } });
  if (r.status >= 500) throw fail("Deluxe Main could not be reached. Try again in a moment.", 502);
  if (!r.ok) return null;
  const d = await r.json();
  return d.user && (d.app === "transfer" || d.app === "main") ? d.user : null;
}

// The same rule Deluxe Main uses to turn a name into a handle ("Shivad Sujith" -> "shivad.sujith").
export function handleFor(name) {
  return String(name || "").toLowerCase().trim().replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "").replace(/\.{2,}/g, ".").slice(0, 30);
}

// Whatever people type for someone, as a handle, or { error }.
//   admin2 · @admin2 · admin2@deluxemail.com · Admin2 <admin2@deluxemail.com>
//   mailto:admin2@deluxemail.com · Shivad Sujith
export function parseRecipient(input) {
  let text = String(input || "").trim().replace(/^mailto:/i, "");
  const angle = /<([^>]+)>/.exec(text);
  if (angle) text = angle[1].trim();
  text = text.replace(/^["']+|["']+$/g, "").replace(/^@/, "").trim();
  if (!text) return { error: "Type a username or a Deluxe Mail address." };
  if (text.includes("@")) {
    const [local, domain] = text.toLowerCase().split("@");
    if (domain !== DOMAIN) return { error: `${text} isn't a Deluxe Mail address. Only @${DOMAIN} people can be sent to.` };
    text = local;
  }
  const handle = handleFor(text);
  return handle ? { handle } : { error: `"${input}" isn't a username.` };
}

export async function findAccount(handle) {
  const r = await main.fetch("/api/server/account?handle=" + encodeURIComponent(handle), { headers: appHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw fail("Deluxe Main could not look that person up.", 502);
  return (await r.json()).user;
}

async function put(accountId, app, key, value) {
  const r = await main.fetch(`/api/data/${app}/` + key, {
    method: "PUT",
    headers: appHeaders(accountId, { "Content-Type": "application/json" }),
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw fail(`Deluxe Main could not save that (${r.status}).`, 502);
}

// A new Deluxe Mail message, stored the way Deluxe Mail stores its own.
export async function deliverMail(accountId, folder, msg) {
  const key = `${folder}/${String(9999999999999 - Date.now()).padStart(13, "0")}-${randomUUID()}`;
  await put(accountId, "mail", key, {
    id: key.split("-").slice(1).join("-"), key, folder, date: Date.now(), read: folder !== "inbox", starred: false, ...msg,
  });
}

// Deluxe Transfer's own history for that person.
export const saveHistory = (accountId, key, value) => put(accountId, "transfer", key, value);
