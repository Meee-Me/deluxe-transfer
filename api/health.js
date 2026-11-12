// GET /api/health  Which settings are in place (yes/no only; never the values).
import { json, guarded } from "./_lib.js";

export const GET = guarded(async function GET() {
  return json({
    ok: true,
    storage: !!process.env.BLOB_READ_WRITE_TOKEN,
    deluxeMail: !!process.env.MAIN_APP_KEY,
  });
});
