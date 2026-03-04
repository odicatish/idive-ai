// lib/supabase/admin.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  (process.env.SUPABASE_URL || "").trim() ||
  (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();

const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});