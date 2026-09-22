import type { AccountDto } from '@dailypay/shared';
import { apiFetch } from '@/lib/api';
import { Card, ErrorNote } from '@/components/ui';
import UploadForm from './upload-form';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  let accounts: AccountDto[] = [];
  let error: string | null = null;
  try {
    accounts = await apiFetch<AccountDto[]>('/accounts');
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-display text-xl font-semibold">นำเข้าไฟล์</h1>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card>
        <UploadForm accounts={accounts} />
      </Card>
      <p className="text-xs text-muted">
        รองรับ CSV จาก K PLUS, statement PDF ของ SCB และรูปสลิป (JPG/PNG)
        — ระบบเดารูปแบบไฟล์เอง ไม่ต้องเลือกธนาคาร
      </p>
    </div>
  );
}
