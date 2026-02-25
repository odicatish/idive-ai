import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function isPromise<T = any>(v: any): v is Promise<T> {
  return !!v && typeof v === "object" && typeof v.then === "function";
}

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          const all = cookieStore.getAll();
          return isPromise(all) ? await all : all;
        },

        async setAll(cookiesToSet) {
          // În RSC uneori set poate arunca -> ignore (ok)
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // ignore
          }
        },
      },
    }
  );
}