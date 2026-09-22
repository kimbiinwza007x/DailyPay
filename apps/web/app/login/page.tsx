'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));

  async function sendMagicLink(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // ต้องชี้มาที่ /auth/callback เพื่อแลก ?code= เป็น session
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
      <h1 className="font-display text-xl font-semibold">เข้าสู่ระบบ</h1>
      <p className="mt-1 text-sm text-muted">ใส่อีเมลแล้วกดรับลิงก์เข้าใช้งาน</p>

      {sent ? (
        <div className="mt-6 space-y-3">
          <p className="rounded-xl bg-income/10 px-4 py-3 text-sm text-income">
            ส่งลิงก์ไปที่ {email} แล้ว เปิดอีเมลแล้วกดลิงก์เพื่อเข้าใช้งาน
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="text-xs text-brand underline-offset-2 hover:underline"
          >
            ส่งใหม่อีกครั้ง
          </button>
        </div>
      ) : (
        <form onSubmit={sendMagicLink} className="mt-6 space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand"
          />

          {error && <p className="text-sm text-expense">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'กำลังส่ง…' : 'ส่งลิงก์เข้าใช้งาน'}
          </button>
        </form>
      )}

      <p className="mt-4 rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">
        อีเมลในตัวของ Supabase จำกัด <strong>2 ฉบับต่อชั่วโมง</strong> ถ้าขึ้น
        &ldquo;email rate limit exceeded&rdquo; ให้รอครบชั่วโมง หรือต่อ SMTP ของตัวเองใน
        Dashboard → Authentication → Emails → SMTP Settings เพื่อปลดเพดาน
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
