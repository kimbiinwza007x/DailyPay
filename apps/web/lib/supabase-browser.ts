'use client';

import { createBrowserClient } from '@supabase/ssr';

/** client ฝั่ง browser ใช้ anon key เท่านั้น — service_role key ห้ามโผล่ฝั่งนี้เด็ดขาด */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
