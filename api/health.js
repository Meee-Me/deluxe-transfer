// GET /api/health  Which settings are in place (yes/no only; never the values).
import { json, guarded, backend, blobAccess } from "./_lib.js";
import { supabaseUrl, supabaseKey } from "./_supabase.js";

export const GET = guarded(async function GET() {
  return json({
    ok: true,
    storage: !!backend(),
    backend: backend(),
    ...(backend() === "blob" ? { access: await blobAccess().catch(() => "unknown") } : {}),
    ...(!backend() && supabaseUrl() && !supabaseKey()
      ? { problem: "Supabase is connected but its secret key is missing: add SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) on Vercel." }
      : {}),
    deluxeMail: !!String(process.env.MAIN_APP_KEY || "").trim(),
  });
});
