import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

/**
 * Next อ่าน .env จากโฟลเดอร์ของแอปเองเท่านั้น แต่ค่าตั้งต้นของทั้ง monorepo อยู่ที่ Code/.env
 * โหลดเองตรงนี้เพื่อไม่ต้องก๊อปค่าเดียวกันไว้สองที่แล้วปล่อยให้มันเลื่อนออกจากกัน
 * ลำดับความสำคัญ: apps/web/.env.local > apps/web/.env > Code/.env (dotenv ไม่ทับค่าที่ตั้งไว้แล้ว)
 */
loadDotenv({ path: ['.env.local', '.env', '../../.env'] });

const authDisabled = process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true';

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const) {
  if (!process.env[key]) {
    throw new Error(
      `ขาดตัวแปร ${key} — กรอกใน Code/.env (คัดลอกจาก .env.example) แล้วรีสตาร์ท dev server`,
    );
  }
}

// กันพลาดตอน deploy: ปิด auth แล้วเผลอ build ขึ้น production = เว็บเปิดให้ใครก็ได้
if (authDisabled && process.env.NODE_ENV === 'production') {
  throw new Error(
    'NEXT_PUBLIC_AUTH_DISABLED=true ใช้กับ production build ไม่ได้ — เอาออกจาก .env ก่อน build',
  );
}

if (authDisabled) {
  console.warn('\n  ⚠  auth ถูกปิดอยู่ (NEXT_PUBLIC_AUTH_DISABLED=true) ทุกหน้าเปิดได้โดยไม่ต้องล็อกอิน\n');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @dailypay/shared เป็น TypeScript ที่ compile เป็น CJS ให้ Next ทรานสไพล์เอง
  transpilePackages: ['@dailypay/shared'],
};

export default nextConfig;
