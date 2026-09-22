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

