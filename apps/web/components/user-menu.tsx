'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

/**
 * ออกจากระบบต้องกดสองจังหวะโดยตั้งใจ
 *
 * เหตุผล: ทางเข้าเดียวของระบบคือ magic link ซึ่งอีเมลในตัวของ Supabase จำกัด
 * 2 ฉบับต่อชั่วโมง กดออกพลาดหนึ่งครั้ง = เสียโควต้าหนึ่งฉบับ และถ้าชนเพดานอยู่แล้ว
 * จะเข้าระบบไม่ได้จนกว่าจะครบชั่วโมง
 *
 * ส่วน session เองอยู่ได้ไม่มีกำหนด (refresh token ของ Supabase ไม่หมดอายุ
 * และ middleware ต่ออายุ access token ให้ทุก request) จึงไม่มีเหตุต้องออกเป็นปกติ
 */
export default function UserMenu({ email }: { email: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    await createClient().auth.signOut();
    // refresh ให้ middleware เห็นว่า cookie หายแล้ว จะได้เด้งไปหน้า login เอง
    router.replace('/login');
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="ml-auto flex items-center gap-2 text-sm">
        <span className="hidden text-xs text-warn sm:inline">
          เข้าใหม่ต้องรอลิงก์ทางอีเมล (จำกัด 2 ฉบับ/ชม.)
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="rounded-lg bg-expense px-2.5 py-1 text-white disabled:opacity-50"
        >
          {busy ? 'กำลังออก…' : 'ยืนยันออก'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-lg px-2.5 py-1 text-muted hover:text-ink"
        >
          ยกเลิก
        </button>
      </div>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-3 text-sm">
      {email && <span className="hidden text-muted sm:inline">{email}</span>}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg px-2.5 py-1 text-muted transition-colors hover:bg-canvas hover:text-ink"
      >
        ออกจากระบบ
      </button>
    </div>
  );
}
