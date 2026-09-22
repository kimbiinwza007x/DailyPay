-- ============================================================
-- 003_add_staging.sql
-- ที่พักผลจาก parser ระหว่างรอ commit (ขยาย raw_rows แทนตาราง shadow)
-- + ตาราง jobs ใช้ Postgres เป็นคิวงานของ worker
-- ============================================================


alter table raw_rows
  add column parsed     jsonb,          -- ผลจาก parser ตาม ParsedRow (asdict)
  add column dedupe     text            -- 'new' | 'duplicate' | 'review'
             check (dedupe in ('new','duplicate','review')),
  add column dup_of     uuid references transactions on delete set null,
  add column proposed_category_id uuid references categories on delete set null;

comment on column raw_rows.parsed is
    'ผลจาก parser (ParsedRow แปลงเป็น json) รอให้ commit_service เขียนลง transactions';
comment on column raw_rows.dedupe is
    'ผลตัดสินของ core/dedupe.py: new เข้าระบบได้เลย, duplicate ข้าม, review ให้คนตัดสิน';
comment on column raw_rows.dup_of is
    'ถ้า dedupe = duplicate ชี้ไปยัง transaction ที่ซ้ำด้วย';
comment on column raw_rows.proposed_category_id is
    'หมวดที่ core/categorize.py เสนอ ก่อนผู้ใช้ยืนยัน/แก้ในหน้าตรวจ';


-- ------------------------------------------------------------
-- jobs : คิวงานของ worker ใช้ Postgres แทน Redis
-- enqueue อยู่ใน transaction เดียวกับ insert อื่น ๆ ได้เสมอ
-- ------------------------------------------------------------
create table jobs (
    id         bigserial primary key,
    kind       text not null,
    args       jsonb not null,
    run_after  timestamptz not null default now(),
    attempts   int not null default 0,
    locked_at  timestamptz,
    done_at    timestamptz,
    last_error text
);

create index on jobs (run_after) where done_at is null;

comment on table jobs is
    'คิวงาน: worker claim ด้วย for update skip locked จาก workers/runner.py';

