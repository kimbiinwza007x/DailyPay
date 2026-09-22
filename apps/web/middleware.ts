import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth'];

/**
 * ปิด auth ชั่วคราวระหว่าง dev — อีเมลในตัวของ Supabase จำกัด 2 ฉบับ/ชั่วโมง
 * magic link จึงใช้เข้าออกบ่อย ๆ ตอนพัฒนาไม่ไหว
 *
 * ค่านี้ต้องเป็น NEXT_PUBLIC_ เพราะ middleware รันบน edge runtime ที่อ่าน env
 * ได้เฉพาะตัวที่ถูก inline ตอน build
 * next.config.ts กันไม่ให้ตั้งเป็น true พร้อมกับ NODE_ENV=production
 */
const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** refresh session ทุก request และกันหน้าที่ต้อง login */
export async function middleware(request: NextRequest) {
  if (AUTH_DISABLED) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: CookieToSet[]) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  if (user && path === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.delete('next');
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
