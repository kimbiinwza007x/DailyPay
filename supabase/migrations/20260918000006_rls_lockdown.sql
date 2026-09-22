-- ============================================================
-- 20260918000006_rls_lockdown.sql
-- Supabase เปิด PostgREST ให้ schema public อัตโนมัติ ตาราง public ทุกตัว
-- จึงเข้าถึงได้ด้วย anon key ถ้าไม่เปิด RLS
--
-- ระบบนี้ใช้คนเดียวและ Nest ต่อ Postgres ตรงด้วย service credentials
-- (bypass RLS อยู่แล้ว) จึง "เปิด RLS โดยไม่สร้าง policy" = ปฏิเสธทุกคำขอ
-- ที่มาจาก anon/authenticated key → ข้อมูลออกทาง Nest API ทางเดียว
--
-- ถ้าวันหนึ่งจะให้ Next.js อ่าน Supabase ตรง ๆ ค่อยเพิ่ม policy ทีละตาราง
-- (และต้องเพิ่มคอลัมน์ user_id ก่อน — ตอนนี้ schema เป็น single-user)
-- ============================================================

alter table accounts          enable row level security;
alter table categories        enable row level security;
alter table merchants         enable row level security;
alter table rules             enable row level security;
alter table import_batches    enable row level security;
alter table raw_rows          enable row level security;
alter table transactions      enable row level security;
alter table attachments       enable row level security;
alter table balance_snapshots enable row level security;
alter table budgets           enable row level security;
alter table jobs              enable row level security;

-- v_ledger และ view อื่น ๆ: ตั้งเป็น security_invoker เพื่อให้ RLS ของตารางเบื้องหลัง
-- มีผลกับคนที่ query view ด้วย (ไม่งั้น view จะรันสิทธิ์ของเจ้าของ = รั่ว)
alter view v_ledger              set (security_invoker = on);
alter view v_monthly_by_category set (security_invoker = on);
alter view v_account_balance     set (security_invoker = on);

-- ตัดสิทธิ์ของ role ที่ PostgREST ใช้ออกให้ชัดเจนอีกชั้น
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
