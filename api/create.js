// POST /api/create  -> { code, owner }  Starts a transfer.
import { json, newCode, ownerKey, listAll, prefix } from "./_lib.js";

export async function POST() {
  for (let i = 0; i < 10; i++) {
    const code = newCode();
    if ((await listAll(prefix(code))).length === 0) return json({ code, owner: ownerKey(code) });
  }
  return json({ error: "Try again." }, 503);
}
