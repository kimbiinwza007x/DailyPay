'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * ปกติไฟล์ถูกประมวลผลเองทันทีหลังอัปโหลด ปุ่มนี้มีไว้กรณีที่หลุด
 * (เช่น function ถูกตัดกลางทาง) — บน Vercel ไม่มี worker ค้างคอยเก็บงาน
 * และ cron บน Hobby รันได้วันละครั้ง ถ้าไม่มีปุ่มนี้ต้องรอถึงพรุ่งนี้
 */
export default function DrainButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function drain(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      const res = await fetch(`${API_URL}/api/jobs/drain`, {
        method: 'POST',
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) throw new Error(res.statusText);
      const { processed } = (await res.json()) as { processed: number };
      setMessage(processed > 0 ? `ประมวลผลแล้ว ${processed} งาน` : 'ไม่มีงานค้างในคิว');
      router.refresh();
    } catch (err) {
      setMessage(`ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        onClick={drain}
        disabled={busy}
        className="rounded-lg bg-info px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? 'กำลังประมวลผล… (สลิปใช้เวลาใบละ 3-5 วินาที)' : 'ประมวลผลตอนนี้'}
      </button>
      {message && <span className="text-xs">{message}</span>}
    </div>
  );
}
