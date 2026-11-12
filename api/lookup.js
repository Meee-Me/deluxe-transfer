// POST /api/lookup {to}   Authorization: Bearer <Deluxe Main key>
// Who a username or address belongs to, so the page can show their name.
import { json, guarded } from "./_lib.js";
import { signedIn, parseRecipient, findAccount, DOMAIN } from "./_people.js";

export const POST = guarded(async function POST(request) {
  if (!(await signedIn(request))) return json({ error: "Sign in with Deluxe Main to send to people.", code: "signin" }, 401);
  const { to } = await request.json().catch(() => ({}));
  const parsed = parseRecipient(to);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const person = await findAccount(parsed.handle);
  if (!person) return json({ error: `Nobody is called ${parsed.handle}.` }, 404);
  return json({ handle: person.handle, name: person.name, address: `${person.handle}@${DOMAIN}` });
});
