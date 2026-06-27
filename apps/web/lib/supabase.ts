import { createClient } from '@supabase/supabase-js';

// Cliente do navegador. URL e anon key são publicáveis (protegidos por RLS).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
