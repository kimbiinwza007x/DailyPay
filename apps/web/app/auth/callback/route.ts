import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase-server';

/**
 * ปลายทางของ magic link — Supabase ส่งกลับมาพร้อม ?code= แล้วต้องแลกเป็น session
 * ถ้าไม่มี route นี้ กดลิงก์ในอีเมลแล้วจะเด้งกลับหน้า login วนไม่จบ
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // next มาจาก query string จึงต้องเป็น path ภายในเท่านั้น กัน open redirect
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(`${origin}${safeNext}`);
}
