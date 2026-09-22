-- ============================================================
-- setup.sql — สคริปต์ตั้งต้นทั้งหมดสำหรับ Supabase SQL Editor
--
-- วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
--
-- ไฟล์นี้คือ migrations ทั้ง 7 ไฟล์ใน supabase/migrations/ ต่อกันตามลำดับ
-- (ใช้แทนกันได้กับ `supabase db push` เลือกทางใดทางหนึ่ง อย่ารันซ้อนกัน)
--
-- รันได้ครั้งเดียวกับฐานข้อมูลเปล่า — รันซ้ำจะ error ที่ create table
-- ถ้าต้องล้างแล้วเริ่มใหม่ ดูบล็อก DROP ที่ท้ายไฟล์ (ปิดคอมเมนต์ไว้)
--
-- ทั้งสคริปต์อยู่ใน transaction เดียว: ถ้าพังกลางทางจะไม่เหลือของค้างครึ่ง ๆ
--
-- ต้องใช้ PostgreSQL 15 ขึ้นไป (security_invoker บน view) — Supabase ใหม่เป็น 15/17 อยู่แล้ว
-- ============================================================

begin;


-- ############################################################
-- [1/7] 20260918000001_schema.sql
-- ตารางหลักทั้ง 10 ตัว
-- ############################################################

-- ============================================================
-- 001_schema.sql
-- ระบบบันทึกรายรับรายจ่ายอัตโนมัติ (ใช้ส่วนตัว, web + upload)
-- ต้องใช้ PostgreSQL 13 ขึ้นไป
--   - gen_random_uuid() เป็น built-in ตั้งแต่ 13
--   - sha256() เป็น built-in ตั้งแต่ 11
--   ไม่ต้องติดตั้ง extension ใด ๆ
-- ============================================================


-- ------------------------------------------------------------
-- accounts : บัญชีธนาคาร / บัตรเครดิต / เงินสด / e-wallet
-- ------------------------------------------------------------
create table accounts (
    id              uuid primary key default gen_random_uuid(),
    name            text        not null,
    type            text        not null
                    check (type in ('bank','credit_card','cash','ewallet','investment')),
    currency        char(3)     not null default 'THB',
    last4           text,
    opening_balance numeric(14,2) not null default 0,
    -- ใช้กับบัตรเครดิต: วันตัดรอบบิล (1-31) ไว้คำนวณรอบบิล
    statement_day   smallint    check (statement_day between 1 and 31),
    note            text,
    archived_at     timestamptz,
    created_at      timestamptz not null default now()
);

comment on column accounts.opening_balance is
    'ยอดตั้งต้นก่อนรายการแรกในระบบ ใช้คำนวณยอดคงเหลือปัจจุบัน';


-- ------------------------------------------------------------
-- categories : หมวดหมู่ 2 ระดับ (parent_id อ้างตัวเอง)
-- ------------------------------------------------------------
create table categories (
    id         uuid primary key default gen_random_uuid(),
    code       text unique,                -- ใช้อ้างอิงตอน seed / เขียน rule
    parent_id  uuid references categories on delete cascade,
    name       text not null,
    kind       text not null check (kind in ('expense','income','transfer')),
    icon       text,
    sort_order int  not null default 0,
    archived_at timestamptz,
    constraint categories_no_self_parent check (parent_id is null or parent_id <> id)
);

create index on categories (parent_id);


-- ------------------------------------------------------------
-- merchants : ร้านค้า/คู่ค้า พร้อมชื่อพ้องที่เจอในสเตทเมนต์
-- ------------------------------------------------------------
create table merchants (
    id                  uuid primary key default gen_random_uuid(),
    canonical_name      text not null unique,
    aliases             text[] not null default '{}',
    default_category_id uuid references categories on delete set null,
    created_at          timestamptz not null default now()
);

create index merchants_aliases_gin on merchants using gin (aliases);


-- ------------------------------------------------------------
-- rules : กฎจัดหมวดที่ผู้ใช้ตั้งเอง ทำงานก่อน merchant dictionary
-- ------------------------------------------------------------
create table rules (
    id              uuid primary key default gen_random_uuid(),
    priority        int  not null default 100,   -- น้อย = สำคัญกว่า
    match_field     text not null default 'description_raw'
                    check (match_field in ('description_raw','counterparty','amount')),
    match_type      text not null
                    check (match_type in ('contains','regex','exact','amount_range')),
    pattern         text not null,
    amount_min      numeric(14,2),
    amount_max      numeric(14,2),
    account_id      uuid references accounts on delete cascade,  -- null = ทุกบัญชี
    set_category_id uuid references categories on delete cascade,
    set_merchant_id uuid references merchants  on delete cascade,
    is_active       boolean not null default true,
    hit_count       int not null default 0,
    created_at      timestamptz not null default now(),
    constraint rules_must_set_something
        check (set_category_id is not null or set_merchant_id is not null)
);

create index on rules (priority) where is_active;


-- ------------------------------------------------------------
-- import_batches : ทุกอย่างเข้าระบบผ่านตารางนี้เท่านั้น
-- file_hash unique = กันอัปโหลดไฟล์เดิมซ้ำตั้งแต่ด่านแรก
-- ------------------------------------------------------------
create table import_batches (
    id              uuid primary key default gen_random_uuid(),
    account_id      uuid references accounts on delete set null,
    source          text not null
                    check (source in ('csv','statement_pdf','slip_image','manual')),
    file_name       text,
    file_hash       text not null unique,      -- sha256 ของ bytes ทั้งไฟล์
    file_uri        text,                      -- object storage
    period_start    date,
    period_end      date,
    row_count       int not null default 0,
    imported_count  int not null default 0,
    duplicate_count int not null default 0,
    review_count    int not null default 0,
    status          text not null default 'parsing'
                    check (status in ('parsing','review','committed','reverted','failed')),
    error_message   text,
    created_at      timestamptz not null default now(),
    committed_at    timestamptz
);

create index on import_batches (created_at desc);


-- ------------------------------------------------------------
-- raw_rows : แถวดิบจากไฟล์ เก็บไว้ตลอดชีพเพื่อ replay parser ใหม่
-- ------------------------------------------------------------
create table raw_rows (
    id           uuid primary key default gen_random_uuid(),
    batch_id     uuid not null references import_batches on delete cascade,
    line_no      int,
    payload      jsonb not null,
    row_hash     text  not null,
    parse_status text  not null default 'pending'
                 check (parse_status in ('pending','parsed','duplicate','skipped','error')),
    parse_error  text,
    confidence   numeric(3,2) check (confidence between 0 and 1)
);

create unique index raw_rows_dedupe on raw_rows (batch_id, row_hash);
create index on raw_rows (batch_id) where parse_status = 'error';


-- ------------------------------------------------------------
-- transactions
--   amount ติดลบ = เงินออก / บวก = เงินเข้า
--   parent_id  : ใช้แยกบิลใบเดียวเป็นหลายหมวด (แม่เป็นยอดจริง ลูกคือส่วนย่อย)
--   locked_fields : ฟิลด์ที่ผู้ใช้แก้เอง ห้าม import ทับ
-- ------------------------------------------------------------
create table transactions (
    id                uuid primary key default gen_random_uuid(),
    account_id        uuid not null references accounts on delete restrict,
    parent_id         uuid references transactions on delete cascade,
    raw_row_id        uuid references raw_rows on delete set null,
    import_batch_id   uuid references import_batches on delete set null,

    occurred_at       timestamptz,
    booked_date       date not null,          -- วันตามเวลาไทย ใช้ group เดือน

    amount            numeric(14,2) not null,
    currency          char(3) not null default 'THB',
    fx_rate           numeric(18,8),
    amount_base       numeric(14,2) not null, -- แปลงเป็น THB แล้ว

    description_raw   text,
    counterparty      text,
    merchant_id       uuid references merchants  on delete set null,
    category_id       uuid references categories on delete set null,

    bank_ref          text,                   -- เลขอ้างอิงจากธนาคาร / QR payload
    balance_after     numeric(14,2),

    transfer_group_id uuid,                   -- สองขาของการโอนระหว่างบัญชีตัวเอง
    status            text not null default 'posted'
                      check (status in ('pending','posted','void')),
    needs_review      boolean not null default false,
    locked_fields     text[]  not null default '{}',
    fingerprint       text    not null,
    note              text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    constraint tx_no_self_parent check (parent_id is null or parent_id <> id),
    constraint tx_amount_not_zero check (amount <> 0)
);

-- กันซ้ำระดับรายการ เฉพาะรายการแม่ที่ยังไม่ถูกยกเลิก
create unique index tx_dedupe
    on transactions (fingerprint)
    where status <> 'void' and parent_id is null;

create index on transactions (booked_date desc);
create index on transactions (account_id, booked_date desc);
create index on transactions (category_id);
create index on transactions (merchant_id);
create index on transactions (import_batch_id);
create index on transactions (parent_id)          where parent_id is not null;
create index on transactions (transfer_group_id)  where transfer_group_id is not null;
create index on transactions (booked_date)        where needs_review;
create index on transactions (bank_ref)           where bank_ref is not null;

comment on column transactions.amount is 'ติดลบ = เงินออก, บวก = เงินเข้า';
comment on column transactions.locked_fields is
    'ชื่อคอลัมน์ที่ผู้ใช้แก้เอง เช่น {category_id,note} ตอน re-import ให้ merge เฉพาะฟิลด์ที่ไม่อยู่ในนี้';


-- ------------------------------------------------------------
-- attachments : ไฟล์สลิป เก็บแค่ hash + uri ตัวไฟล์อยู่ object storage
-- qr_payload unique = ตัวกันซ้ำที่แม่นที่สุด
-- ------------------------------------------------------------
create table attachments (
    id             uuid primary key default gen_random_uuid(),
    transaction_id uuid references transactions on delete set null,
    import_batch_id uuid references import_batches on delete set null,
    file_hash      text not null unique,      -- sha256 ของไฟล์รูป
    file_uri       text not null,
    mime_type      text,
    byte_size      int,
    qr_payload     text unique,               -- สตริงดิบจาก QR บนสลิป
    qr_status      text not null default 'pending'
                   check (qr_status in ('pending','found','unreadable')),
    slip_datetime  timestamptz,               -- จาก OCR
    amount         numeric(14,2),             -- จาก OCR
    receiver_name  text,
    receiver_last4 text,
    ocr_text       text,
    created_at     timestamptz not null default now()
);

create index on attachments (transaction_id);
create index on attachments (amount, slip_datetime) where qr_status = 'unreadable';


-- ------------------------------------------------------------
-- balance_snapshots : ยอดคงเหลือจากสเตทเมนต์ ใช้ตรวจว่ามีรายการหาย
-- ------------------------------------------------------------
create table balance_snapshots (
    account_id uuid not null references accounts on delete cascade,
    as_of      date not null,
    balance    numeric(14,2) not null,
    source     text not null check (source in ('statement','user','derived')),
    created_at timestamptz not null default now(),
    primary key (account_id, as_of)
);


-- ------------------------------------------------------------
-- budgets : งบรายเดือนต่อหมวด (ไม่บังคับ แต่เพิ่มทีหลังเจ็บกว่า)
-- ------------------------------------------------------------
create table budgets (
    id          uuid primary key default gen_random_uuid(),
    category_id uuid not null references categories on delete cascade,
    month       date not null,                -- เก็บเป็นวันที่ 1 ของเดือนเสมอ
    amount      numeric(14,2) not null check (amount >= 0),
    note        text,
    unique (category_id, month),
    constraint budgets_month_is_first_day check (extract(day from month) = 1)
);

-- ############################################################
-- [2/7] 20260918000002_functions.sql
-- fingerprint, trigger, pair_transfers, revert_batch, view รายงาน
-- ############################################################

-- ============================================================
-- 002_functions.sql
-- fingerprint, trigger, การจับคู่โอนภายใน, การยกเลิก batch, view รายงาน
-- ============================================================


-- ------------------------------------------------------------
-- fingerprint: ตัวกันซ้ำระดับรายการ
-- ลำดับความน่าเชื่อถือของกุญแจ:
--   1. bank_ref (เลขอ้างอิงธนาคาร หรือ QR payload จากสลิป) -- แม่นที่สุด
--   2. ถ้าไม่มี ใช้คำอธิบายที่ normalize แล้ว 24 ตัวแรก
-- normalize: ตัดอักขระที่ไม่ใช่ตัวอักษร/ตัวเลข (ไทยและอังกฤษ) ออกทั้งหมด
-- ------------------------------------------------------------
create or replace function tx_fingerprint(
    p_account uuid,
    p_date    date,
    p_amount  numeric,
    p_ref     text,
    p_desc    text
) returns text
language sql
stable
as $$
    select encode(
        sha256(convert_to(
            p_account::text
            || '|' || to_char(p_date, 'YYYYMMDD')
            || '|' || to_char(p_amount, 'FM9999999990.00')
            || '|' || coalesce(
                        nullif(trim(p_ref), ''),
                        left(regexp_replace(
                                lower(coalesce(p_desc, '')),
                                '[^a-z0-9ก-๙]', '', 'g'
                             ), 24)
                      ),
            'UTF8'
        )),
        'hex'
    );
$$;


-- ------------------------------------------------------------
-- trigger ก่อนเขียน transactions
--   - เติม booked_date จาก occurred_at ตามเวลาไทย
--   - เติม amount_base จาก fx_rate
--   - คำนวณ fingerprint ใหม่ทุกครั้ง
--   - รายการลูก (split) ใส่ id ตัวเองลงไปด้วยเพื่อไม่ให้ชนกันเอง
-- ------------------------------------------------------------
create or replace function tx_before_write() returns trigger
language plpgsql
as $$
begin
    if new.booked_date is null then
        if new.occurred_at is null then
            raise exception 'ต้องระบุ booked_date หรือ occurred_at อย่างน้อยหนึ่งอย่าง';
        end if;
        new.booked_date := (new.occurred_at at time zone 'Asia/Bangkok')::date;
    end if;

    if new.amount_base is null then
        new.amount_base := round(new.amount * coalesce(new.fx_rate, 1), 2);
    end if;

    new.fingerprint := tx_fingerprint(
        new.account_id,
        new.booked_date,
        new.amount,
        case when new.parent_id is null
             then new.bank_ref
             else coalesce(new.bank_ref, '') || '#' || new.id::text
        end,
        new.description_raw
    );

    new.updated_at := now();
    return new;
end;
$$;

create trigger tx_before_write
    before insert or update on transactions
    for each row execute function tx_before_write();


-- ------------------------------------------------------------
-- ยอดรวมของรายการลูกต้องเท่ากับรายการแม่เสมอ
-- ใช้ constraint trigger แบบ deferred เพื่อให้แทรกลูกหลายแถวใน
-- ทรานแซกชันเดียวได้โดยไม่พังกลางทาง
-- ------------------------------------------------------------
create or replace function tx_check_split_balance() returns trigger
language plpgsql
as $$
declare
    v_parent uuid;
    v_parent_amount numeric(14,2);
    v_child_total   numeric(14,2);
begin
    v_parent := coalesce(new.parent_id, old.parent_id);
    if v_parent is null then
        return null;
    end if;

    select amount into v_parent_amount from transactions where id = v_parent;
    if not found then
        return null;    -- แม่ถูกลบไปแล้ว (cascade)
    end if;

    select coalesce(sum(amount), 0) into v_child_total
      from transactions where parent_id = v_parent;

    if v_child_total <> 0 and v_child_total <> v_parent_amount then
        raise exception
            'ยอดรวมรายการย่อย (%) ไม่เท่ากับรายการแม่ (%) id=%',
            v_child_total, v_parent_amount, v_parent;
    end if;

    return null;
end;
$$;

create constraint trigger tx_split_balance
    after insert or update or delete on transactions
    deferrable initially deferred
    for each row execute function tx_check_split_balance();


-- ------------------------------------------------------------
-- จับคู่การโอนระหว่างบัญชีตัวเอง
-- รันเป็น job หลัง commit batch ไม่ใช่ตอน insert ทีละแถว
-- เพราะขาที่สองอาจมาจากไฟล์ที่อัปโหลดทีหลังเป็นอาทิตย์
-- คืนค่า = จำนวนคู่ที่จับได้
-- ------------------------------------------------------------
create or replace function pair_transfers(p_window interval default '2 days')
returns integer
language plpgsql
as $$
declare
    v_pairs integer;
begin
    with unpaired as (
        select id, account_id, amount,
               coalesce(occurred_at, booked_date::timestamp at time zone 'Asia/Bangkok') as ts
          from transactions
         where transfer_group_id is null
           and status = 'posted'
           and parent_id is null
    ),
    candidates as (
        select distinct on (o.id)
               o.id as out_id,
               i.id as in_id
          from unpaired o
          join unpaired i
            on i.amount     = -o.amount
           and i.account_id <> o.account_id
           and i.ts between o.ts - p_window and o.ts + p_window
         where o.amount < 0
         order by o.id, abs(extract(epoch from (i.ts - o.ts)))
    ),
    -- ขาเข้าหนึ่งรายการต้องถูกจับคู่ครั้งเดียวเท่านั้น
    deduped as (
        select distinct on (in_id) out_id, in_id
          from candidates
         order by in_id, out_id
    ),
    assigned as (
        select out_id, in_id, gen_random_uuid() as gid from deduped
    ),
    updated as (
        update transactions t
           set transfer_group_id = a.gid
          from assigned a
         where t.id in (a.out_id, a.in_id)
        returning 1
    )
    select count(*) / 2 into v_pairs from updated;

    return coalesce(v_pairs, 0);
end;
$$;


-- ------------------------------------------------------------
-- ยกเลิก batch ทั้งก้อน (ใช้เมื่อ parse ผิดหรืออัปไฟล์ผิดบัญชี)
-- ลบเฉพาะรายการที่ผู้ใช้ยังไม่ได้แก้เอง รายการที่มี locked_fields
-- จะถูกปล่อยไว้แล้วตัดสายจาก batch แทน
-- ------------------------------------------------------------
create or replace function revert_batch(p_batch uuid)
returns integer
language plpgsql
as $$
declare
    v_deleted integer;
begin
    update transactions
       set import_batch_id = null,
           note = coalesce(note || ' / ', '') || 'batch ถูกยกเลิกแต่รายการนี้ถูกแก้ไขแล้ว'
     where import_batch_id = p_batch
       and locked_fields <> '{}';

    delete from transactions
     where import_batch_id = p_batch;
    get diagnostics v_deleted = row_count;

    update import_batches
       set status = 'reverted'
     where id = p_batch;

    return v_deleted;
end;
$$;


-- ------------------------------------------------------------
-- v_ledger : แหล่งความจริงของ "รายงาน"
--   - ตัดรายการยกเลิก
--   - ตัดการโอนระหว่างบัญชีตัวเอง (ไม่ใช่รายรับรายจ่าย)
--   - ถ้ารายการแม่ถูกแยกเป็นหลายหมวด ให้นับเฉพาะลูก
-- ทุกรายงานต้อง query จาก view นี้ ห้าม query transactions ตรง ๆ
-- ------------------------------------------------------------
create or replace view v_ledger as
select t.*
  from transactions t
 where t.status <> 'void'
   and t.transfer_group_id is null
   and not exists (
        select 1 from transactions c where c.parent_id = t.id
   );


-- ------------------------------------------------------------
-- v_monthly_by_category : สรุปรายเดือนแยกหมวด
-- ------------------------------------------------------------
create or replace view v_monthly_by_category as
select date_trunc('month', l.booked_date)::date as month,
       c.id                                     as category_id,
       coalesce(p.name || ' › ', '') || c.name   as category_path,
       c.kind,
       sum(l.amount_base)                       as total,
       count(*)                                 as tx_count
  from v_ledger l
  left join categories c on c.id = l.category_id
  left join categories p on p.id = c.parent_id
 group by 1, 2, 3, 4;


-- ------------------------------------------------------------
-- v_account_balance : ยอดคงเหลือปัจจุบัน + ส่วนต่างจากสเตทเมนต์ล่าสุด
-- ถ้า diff ไม่เป็น 0 แปลว่ามีรายการหายหรือซ้ำ ต้องไล่หา
-- ------------------------------------------------------------
create or replace view v_account_balance as
with computed as (
    select a.id,
           a.name,
           a.opening_balance
             + coalesce(sum(t.amount) filter (where t.status <> 'void'
                                                and t.parent_id is null), 0) as balance
      from accounts a
      left join transactions t on t.account_id = a.id
     group by a.id, a.name, a.opening_balance
),
latest_snapshot as (
    select distinct on (account_id) account_id, as_of, balance
      from balance_snapshots
     order by account_id, as_of desc
)
select c.id,
       c.name,
       c.balance                        as computed_balance,
       s.balance                        as statement_balance,
       s.as_of                          as statement_as_of,
       c.balance - s.balance            as diff
  from computed c
  left join latest_snapshot s on s.account_id = c.id;

-- ############################################################
-- [3/7] 20260918000003_add_staging.sql
-- คอลัมน์ staging บน raw_rows + ตาราง jobs (คิวงาน)
-- ############################################################

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

-- ############################################################
-- [4/7] 20260918000004_seed_categories.sql
-- seed หมวดหมู่ภาษาไทย 2 ระดับ
-- ############################################################

-- ============================================================
-- 004_seed_categories.sql
-- หมวดหมู่ภาษาไทย 2 ระดับ (parent_id อ้างตัวเอง)
-- code ใช้อ้างอิงตอนเขียน rule / seed อื่น ๆ ไม่ควรเปลี่ยนหลังใช้งานจริง
-- ============================================================


-- ------------------------------------------------------------
-- ระดับบน (parent)
-- ------------------------------------------------------------
insert into categories (code, parent_id, name, kind, icon, sort_order) values
    ('food',        null, 'อาหาร',              'expense', 'utensils',      10),
    ('transport',   null, 'เดินทาง',             'expense', 'car',           20),
    ('home',        null, 'บ้าน/ที่พัก',         'expense', 'home',          30),
    ('utility',     null, 'สาธารณูปโภค',        'expense', 'bolt',          40),
    ('shopping',    null, 'ช้อปปิ้ง',            'expense', 'shopping-bag',  50),
    ('health',      null, 'สุขภาพ',              'expense', 'heart-pulse',   60),
    ('entertain',   null, 'บันเทิง',             'expense', 'film',          70),
    ('education',   null, 'การศึกษา',            'expense', 'book',          80),
    ('finance',     null, 'การเงิน',             'expense', 'bank',          90),
    ('family',      null, 'ครอบครัว/ของขวัญ',    'expense', 'gift',          100),
    ('other_exp',   null, 'อื่น ๆ (รายจ่าย)',    'expense', 'ellipsis',      110),

    ('salary',      null, 'เงินเดือน',           'income',  'wallet',        200),
    ('freelance',   null, 'งานฟรีแลนซ์',         'income',  'briefcase',     210),
    ('invest_inc',  null, 'ผลตอบแทนการลงทุน',    'income',  'chart-line',    220),
    ('refund_inc',  null, 'เงินคืน/refund',      'income',  'rotate-left',   230),
    ('other_inc',   null, 'อื่น ๆ (รายรับ)',     'income',  'ellipsis',      240),

    ('transfer',    null, 'โอนระหว่างบัญชีตัวเอง', 'transfer', 'right-left', 900)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- ระดับล่าง (child) — อ้าง parent ผ่าน code
-- ------------------------------------------------------------
with p as (select id, code from categories where parent_id is null)
insert into categories (code, parent_id, name, kind, icon, sort_order)
select v.code, p.id, v.name, v.kind, v.icon, v.sort_order
  from (values
    -- อาหาร
    ('food_dine',     'food', 'ทานนอกบ้าน',        'expense', 'utensils',   11),
    ('food_delivery', 'food', 'เดลิเวอรี่',         'expense', 'moped',      12),
    ('food_grocery',  'food', 'ของสด/ตลาด',        'expense', 'carrot',     13),
    ('food_coffee',   'food', 'กาแฟ/เครื่องดื่ม',   'expense', 'cup',        14),

    -- เดินทาง
    ('transport_fuel',   'transport', 'น้ำมัน',           'expense', 'gas-pump', 21),
    ('transport_transit','transport', 'ขนส่งสาธารณะ',     'expense', 'train',    22),
    ('transport_ride',   'transport', 'เรียกรถ (Grab ฯลฯ)','expense', 'car-side', 23),
    ('transport_parking','transport', 'ที่จอดรถ/ทางด่วน',  'expense', 'square-parking', 24),
    ('transport_maint',  'transport', 'ซ่อม/บำรุงรถ',      'expense', 'wrench',   25),

    -- บ้าน/ที่พัก
    ('home_rent',    'home', 'ค่าเช่า/ผ่อนบ้าน',   'expense', 'house',      31),
    ('home_supply',  'home', 'ของใช้ในบ้าน',      'expense', 'broom',      32),
    ('home_repair',  'home', 'ซ่อมแซม/ตกแต่ง',    'expense', 'hammer',     33),

    -- สาธารณูปโภค
    ('utility_elec',  'utility', 'ค่าไฟ',           'expense', 'plug',       41),
    ('utility_water', 'utility', 'ค่าน้ำ',          'expense', 'droplet',    42),
    ('utility_net',   'utility', 'อินเทอร์เน็ต',    'expense', 'wifi',       43),
    ('utility_mobile','utility', 'มือถือ',          'expense', 'phone',      44),

    -- ช้อปปิ้ง
    ('shopping_clothes','shopping', 'เสื้อผ้า',        'expense', 'shirt',    51),
    ('shopping_gadget', 'shopping', 'อุปกรณ์ไอที',     'expense', 'laptop',   52),
    ('shopping_online', 'shopping', 'ช้อปออนไลน์ทั่วไป','expense', 'cart',    53),

    -- สุขภาพ
    ('health_hospital', 'health', 'โรงพยาบาล/คลินิก', 'expense', 'hospital', 61),
    ('health_pharmacy', 'health', 'ร้านยา',           'expense', 'pills',    62),
    ('health_fitness',  'health', 'ฟิตเนส/กีฬา',      'expense', 'dumbbell', 63),
    ('health_insurance','health', 'ประกันสุขภาพ',     'expense', 'shield',   64),

    -- บันเทิง
    ('entertain_stream', 'entertain', 'สตรีมมิ่ง (Netflix ฯลฯ)', 'expense', 'tv',    71),
    ('entertain_movie',  'entertain', 'หนัง/คอนเสิร์ต',          'expense', 'ticket',72),
    ('entertain_hobby',  'entertain', 'งานอดิเรก',                'expense', 'gamepad',73),
    ('entertain_travel', 'entertain', 'ท่องเที่ยว',               'expense', 'plane', 74),

    -- การศึกษา
    ('education_course', 'education', 'คอร์ส/เรียนพิเศษ', 'expense', 'graduation-cap', 81),
    ('education_book',   'education', 'หนังสือ',           'expense', 'book-open',      82),

    -- การเงิน
    ('finance_fee',      'finance', 'ค่าธรรมเนียม',       'expense', 'receipt',   91),
    ('finance_interest', 'finance', 'ดอกเบี้ยจ่าย',       'expense', 'percent',   92),
    ('finance_invest',   'finance', 'ลงทุน (ซื้อ)',       'expense', 'chart-line',93),
    ('finance_insurance','finance', 'ประกันชีวิต/ทรัพย์สิน','expense','shield-check',94),
    ('finance_tax',      'finance', 'ภาษี',                'expense', 'landmark',  95),

    -- ครอบครัว/ของขวัญ
    ('family_support', 'family', 'เลี้ยงดูครอบครัว', 'expense', 'people-roof', 101),
    ('family_gift',    'family', 'ของขวัญ/ทำบุญ',    'expense', 'gift',        102),
    ('family_kids',    'family', 'ลูก',              'expense', 'baby',        103),

    -- เงินเดือน
    ('salary_base',   'salary', 'เงินเดือนหลัก', 'income', 'wallet',   201),
    ('salary_bonus',  'salary', 'โบนัส',         'income', 'star',     202)
  ) as v(code, parent_code, name, kind, icon, sort_order)
  join p on p.code = v.parent_code
on conflict (code) do nothing;

-- ############################################################
-- [5/7] 20260918000005_seed_merchants_rules.sql
-- seed ร้านค้าไทย + rule ตั้งต้น
-- ############################################################

-- ============================================================
-- 005_seed_merchants_rules.sql
-- ร้านค้าไทยที่เจอบ่อยในสเตทเมนต์ + rule ตั้งต้น
-- aliases คือรูปแบบที่มักเห็นจริงในสเตทเมนต์ (ตัวพิมพ์ใหญ่ มีเลขต่อท้ายสาขา ฯลฯ)
-- ตัวจับ merchant (core/categorize.py) ควร normalize (upper + strip เลข) ก่อนเทียบ
-- ============================================================


with cat as (select id, code from categories)
insert into merchants (canonical_name, aliases, default_category_id)
select v.canonical_name, v.aliases, cat.id
  from (values
    -- สะดวกซื้อ / ซูเปอร์มาร์เก็ต
    ('7-Eleven',        array['7-ELEVEN','7-11','CPALL','SEVEN ELEVEN'],           'food_grocery'),
    ('Big C',           array['BIGC','BIG C','BIG C SUPERCENTER'],                 'food_grocery'),
    ('Tesco Lotus/Lotus''s', array['LOTUS','LOTUSS','TESCO LOTUS'],                'food_grocery'),
    ('Makro',           array['MAKRO','SIAM MAKRO'],                               'food_grocery'),
    ('Tops',            array['TOPS','TOPS MARKET','TOPS SUPERMARKET'],            'food_grocery'),
    ('Gourmet Market',  array['GOURMET MARKET'],                                   'food_grocery'),
    ('Family Mart',     array['FAMILYMART','FAMILY MART'],                        'food_grocery'),

    -- เดลิเวอรี่ / เรียกรถ
    ('Grab',            array['GRAB','GRABPAY','GRAB TAXI','GRABFOOD'],            'transport_ride'),
    ('LINE MAN',        array['LINE MAN','LINEMAN','WONGNAI LINE MAN'],            'food_delivery'),
    ('Foodpanda',       array['FOODPANDA','FOOD PANDA'],                           'food_delivery'),
    ('Bolt',            array['BOLT','BOLT TAXI'],                                 'transport_ride'),

    -- ช้อปออนไลน์
    ('Shopee',          array['SHOPEE','SHOPEEPAY','SHOPEE THAILAND'],             'shopping_online'),
    ('Lazada',          array['LAZADA','LAZADA THAILAND'],                        'shopping_online'),

    -- สตรีมมิ่ง / ซับสคริปชัน
    ('Netflix',         array['NETFLIX','NETFLIX.COM'],                           'entertain_stream'),
    ('Spotify',         array['SPOTIFY','SPOTIFY AB'],                            'entertain_stream'),
    ('YouTube Premium', array['YOUTUBE','GOOGLE YOUTUBE','YOUTUBEPREMIUM'],       'entertain_stream'),
    ('Apple',           array['APPLE.COM/BILL','ITUNES','APPLE SERVICES'],       'shopping_gadget'),

    -- สาธารณูปโภค
    ('การไฟฟ้า',        array['กฟภ','กฟน','PEA','MEA','ELECTRICITY AUTHORITY'],   'utility_elec'),
    ('การประปา',        array['กปภ','กปน','PWA','MWA','WATERWORKS'],              'utility_water'),
    ('AIS',             array['AIS','ADVANCED INFO SERVICE'],                     'utility_mobile'),
    ('TRUE',            array['TRUE','TRUE CORPORATION','TRUEMOVE'],              'utility_mobile'),
    ('DTAC',            array['DTAC','TOTAL ACCESS'],                             'utility_mobile'),

    -- น้ำมัน
    ('PTT',             array['PTT','PTT STATION','PTT OR'],                      'transport_fuel'),
    ('บางจาก',          array['BANGCHAK','BCP'],                                  'transport_fuel'),
    ('เชลล์',           array['SHELL'],                                           'transport_fuel'),
    ('เอสโซ่',          array['ESSO'],                                            'transport_fuel'),

    -- ร้านยา/โรงพยาบาล
    ('Watsons',         array['WATSONS','WATSON'],                                'health_pharmacy'),
    ('Boots',           array['BOOTS'],                                           'health_pharmacy')
  ) as v(canonical_name, aliases, category_code)
  join cat on cat.code = v.category_code
on conflict (canonical_name) do nothing;


-- ------------------------------------------------------------
-- rules : กฎที่ตรวจก่อน merchant dictionary เสมอ
-- ใช้กับ pattern ที่ merchant/OCR แยกยาก เช่น การจ่ายบัตรเครดิต
-- ------------------------------------------------------------
with cat as (select id, code from categories)
insert into rules (priority, match_field, match_type, pattern, set_category_id)
select v.priority, v.match_field, v.match_type, v.pattern, cat.id
  from (values
    -- จ่ายบัตรเครดิตคือ transfer ไม่ใช่รายจ่าย (ดู design.md ข้อ 8)
    (10, 'description_raw', 'contains', 'PAYMENT-CREDIT CARD', 'transfer'),
    (10, 'description_raw', 'contains', 'CREDIT CARD PAYMENT', 'transfer'),
    (10, 'description_raw', 'contains', 'ชำระบัตรเครดิต',       'transfer'),

    -- โอนเงินระหว่างบัญชีตัวเองที่มักเจอในสเตทเมนต์
    (10, 'description_raw', 'contains', 'PROMPTPAY TRANSFER OWN', 'transfer'),
    (10, 'description_raw', 'contains', 'INTERNAL FUND TRANSFER', 'transfer'),

    -- ค่าธรรมเนียมธนาคาร
    (20, 'description_raw', 'contains', 'SERVICE CHARGE', 'finance_fee'),
    (20, 'description_raw', 'contains', 'ค่าธรรมเนียม',    'finance_fee'),
    (20, 'description_raw', 'contains', 'ATM FEE',         'finance_fee'),

    -- เงินเดือน
    (20, 'description_raw', 'contains', 'SALARY',  'salary_base'),
    (20, 'description_raw', 'contains', 'เงินเดือน', 'salary_base')
  ) as v(priority, match_field, match_type, pattern, category_code)
  join cat on cat.code = v.category_code;

-- ############################################################
-- [6/7] 20260918000006_rls_lockdown.sql
-- เปิด RLS ปิดทางเข้าจาก anon key
-- ############################################################

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

-- ############################################################
-- [7/7] 20260918000007_storage_bucket.sql
-- bucket สำหรับไฟล์ที่อัปโหลด
-- ############################################################

-- ============================================================
-- 20260918000007_storage_bucket.sql
-- bucket สำหรับไฟล์ต้นฉบับที่อัปโหลด (statement, สลิป)
-- design.md ข้อ 8: อย่าเก็บไฟล์รูปเป็น bytea — เก็บแค่ file_hash + file_uri
--
-- private = ไม่มี public URL ต้องขอ signed url ผ่าน Nest เท่านั้น
-- ไม่สร้าง storage policy ใด ๆ → anon/authenticated key เข้าไม่ได้
-- Nest ใช้ service_role key จึง bypass
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'imports',
    'imports',
    false,
    26214400,  -- 25 MB
    array[
        'text/csv',
        'application/vnd.ms-excel',
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/octet-stream'
    ]
)
on conflict (id) do nothing;

commit;


-- ============================================================
-- ตรวจผลหลังรัน
-- ============================================================
-- select table_name from information_schema.tables
--  where table_schema = 'public' order by table_name;        -- ต้องได้ 11 ตาราง
-- select count(*) from categories;                           -- ต้องได้ 56 หมวด (แม่ 17 + ลูก 39)
-- select count(*) from merchants;                            -- ต้องได้ 28 ร้าน
-- select count(*) from rules;                                -- ต้องได้ 10 กฎ
-- select id, public from storage.buckets where id = 'imports';


-- ============================================================
-- ล้างทั้งหมดเพื่อเริ่มใหม่ (ลบข้อมูลจริงทิ้งหมด — เปิดใช้เมื่อแน่ใจเท่านั้น)
-- ============================================================
-- begin;
-- drop view if exists v_account_balance, v_monthly_by_category, v_ledger;
-- drop table if exists jobs, budgets, balance_snapshots, attachments,
--                      transactions, raw_rows, import_batches,
--                      rules, merchants, categories, accounts cascade;
-- drop function if exists tx_fingerprint(uuid, date, numeric, text, text);
-- drop function if exists tx_before_write();
-- drop function if exists tx_check_split_balance();
-- drop function if exists pair_transfers(interval);
-- drop function if exists revert_batch(uuid);
-- delete from storage.buckets where id = 'imports';
-- commit;
