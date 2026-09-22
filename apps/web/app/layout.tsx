import type { Metadata } from 'next';
import Link from 'next/link';
import UserMenu from '@/components/user-menu';
import { createClient } from '@/lib/supabase-server';
import './globals.css';

export const metadata: Metadata = {
  title: 'บันทึกรายรับรายจ่าย',
  description: 'ระบบบันทึกรายรับรายจ่ายอัตโนมัติ — นำเข้าสเตทเมนต์และสลิป กันซ้ำ จัดหมวดอัตโนมัติ',
};

const NAV = [
  { href: '/', label: 'ภาพรวม' },
  { href: '/upload', label: 'นำเข้าไฟล์' },
  { href: '/review', label: 'คิวรอตรวจ' },
  { href: '/report', label: 'รายงาน' },
  { href: '/reconcile', label: 'กระทบยอด' },
];

/** แถบเตือนตอน auth ถูกปิด — ไม่ควรมีวันหลุดขึ้น production โดยไม่มีใครเห็น */
const AUTH_DISABLED = process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let email: string | null = null;
  if (!AUTH_DISABLED) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
  }

  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&family=Sarabun:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-canvas">
        <header className="border-b border-black/5 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-display text-lg font-semibold text-brand">
              รายรับรายจ่าย
            </Link>
            <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-muted transition-colors hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            {email !== null && <UserMenu email={email} />}
          </div>
        </header>
        {AUTH_DISABLED && (
          <div className="bg-warn/15 px-4 py-2 text-center text-xs text-warn">
            auth ถูกปิดอยู่ — ทุกหน้าเปิดได้โดยไม่ต้องล็อกอิน ต้องเอา
            <code className="mx-1">AUTH_DISABLED</code>
            ออกจาก .env ก่อนใช้งานจริง
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
