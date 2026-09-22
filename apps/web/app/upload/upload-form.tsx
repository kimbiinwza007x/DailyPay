'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AccountDto, StageResultDto } from '@dailypay/shared';
import { createClient } from '@/lib/supabase-browser';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function UploadForm({ accounts }: { accounts: AccountDto[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setDuplicate(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const form = new FormData();
      form.append('file', file);
      if (accountId) form.append('accountId', accountId);

      const res = await fetch(`${API_URL}/api/imports`, {
        method: 'POST',
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? res.statusText);
      }

      const result = (await res.json()) as StageResultDto;
      // ชั้นกันซ้ำที่ 1: ไฟล์เดิมที่ลากมาวางซ้ำ — พาไปดูของเดิมแทนที่จะสร้าง batch ใหม่
      if (result.duplicateFile) {
        setDuplicate(result.batchId);
      } else {
        router.push(`/review/${result.batchId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">ไฟล์</label>
        <input
          type="file"
          required
          accept=".csv,.pdf,.jpg,.jpeg,.png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-1.5 file:text-brand"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">บัญชี</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
        >
          <option value="">— ยังไม่ระบุ (ทุกแถวจะเข้าคิวรอตรวจ) —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          ไม่เลือกบัญชีจะกันซ้ำระดับ fingerprint ไม่ได้ เพราะ fingerprint คำนวณจาก account_id ด้วย
        </p>
      </div>

      {error && <p className="text-sm text-expense">{error}</p>}
      {duplicate && (
        <p className="rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
          ไฟล์นี้เคยอัปโหลดแล้ว —{' '}
          <a href={`/review/${duplicate}`} className="underline">
            ดูไฟล์เดิม
          </a>
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !file}
        className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'กำลังอัปโหลด…' : 'อัปโหลด'}
      </button>
    </form>
  );
}
