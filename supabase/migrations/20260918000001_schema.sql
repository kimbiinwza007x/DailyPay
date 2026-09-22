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

