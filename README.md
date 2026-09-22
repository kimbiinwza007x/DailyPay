# ระบบบันทึกรายรับรายจ่ายอัตโนมัติ

Monorepo: **NestJS** (API + worker) · **Next.js** (เว็บ) · **Supabase** (Postgres + Auth + Storage)

เอกสารออกแบบอยู่ที่ [`design.md`](design.md) — โค้ดทุกส่วนยังยึดกฎ 3 ข้อเดิม:
เก็บข้อมูลดิบไว้เสมอ · ทุกอย่างเข้าระบบผ่าน `import_batches` · รายงาน query จาก `v_ledger` เท่านั้น

```
Code/
├── apps/
│   ├── api/                 NestJS — REST API + worker (process แยก)
│   │   └── src/
│   │       ├── core/        ชั้นที่ไม่รู้จัก DB เลย (fingerprint, dedupe, categorize, parsers)
│   │       ├── adapters/    QR reader (zxing-wasm) + OCR ไทย (tesseract.js)
│   │       ├── db/          SQL ดิบผ่าน node-postgres + unit of work
│   │       ├── storage/     Supabase Storage
│   │       ├── modules/     use case + controller
│   │       └── worker/      job runner (Postgres เป็นคิว)
│   └── web/                 Next.js App Router + Tailwind v4
├── packages/shared/         types + zod schema ที่ทั้งสองฝั่งใช้ร่วมกัน
└── supabase/migrations/     SQL ทั้งหมด (schema, function, view, seed, RLS)
```

ทิศทางการพึ่งพายังเป็นทางเดียวเหมือนเดิม: `modules` → `core` ← `db`/`adapters`
**ชั้น `core` ห้าม import อะไรจากชั้นนอกเด็ดขาด** — รับค่าเข้ามาเป็น argument แทน

## เริ่มใช้งาน

### 1. ติดตั้ง

```bash
pnpm install
```

### 2. สร้างโปรเจกต์ Supabase แล้วคัดลอก env

```bash
cp .env.example .env
```

กรอกค่าจาก Supabase dashboard:

| ตัวแปร | หาได้จาก |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API |
| `DATABASE_URL` | Project Settings → Database → Connection string (URI) |

> `SUPABASE_SERVICE_ROLE_KEY` bypass RLS ได้ **ใช้ฝั่ง Nest เท่านั้น** ห้ามใส่ในตัวแปรที่ขึ้นต้นด้วย `NEXT_PUBLIC_`

Next.js อ่าน env จากโฟลเดอร์ของตัวเองเท่านั้น จึงต้องคัดลอกสามตัวที่ขึ้นต้นด้วย `NEXT_PUBLIC_` ไปไว้อีกที่:

```bash
cat > apps/web/.env.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:3001
ENV
```

### 3. สร้างตารางในฐานข้อมูล

เลือกทางใดทางหนึ่ง **อย่ารันซ้อนกัน**

**ทาง A — วางใน SQL Editor** (ไม่ต้องลง CLI)

เปิด Supabase Dashboard → SQL Editor → New query → วางเนื้อหาทั้งไฟล์ [`supabase/setup.sql`](supabase/setup.sql) → Run

**ทาง B — ใช้ Supabase CLI**

```bash
supabase link --project-ref <project-ref>
supabase db push
```

ทั้งสองทางได้ผลเหมือนกัน: ตาราง 11 ตัว + function/trigger/view + seed หมวดหมู่ไทย 56 หมวด
+ ร้านค้าไทย 28 ร้าน + rule ตั้งต้น 10 กฎ + RLS lockdown + bucket `imports`

> `setup.sql` คือ migrations ทั้ง 7 ไฟล์ต่อกันใน transaction เดียว แก้ที่ `supabase/migrations/`
> แล้ว regenerate เสมอ อย่าแก้ `setup.sql` ตรง ๆ

### 4. รัน

```bash
pnpm dev:api      # http://localhost:3001/api
pnpm dev:worker   # ดึงงานจากตาราง jobs
pnpm dev:web      # http://localhost:3000
```

**ต้องรัน worker ด้วยเสมอ** — ไฟล์ที่อัปโหลดจะค้างสถานะ `parsing` ตลอดกาลถ้าไม่มีใครดึงงาน

## เส้นทาง API

| Method | Path | ทำอะไร |
|---|---|---|
| `POST` | `/api/imports` | อัปโหลดไฟล์ → สร้าง batch + enqueue `parse_batch` |
| `GET` | `/api/batches?status=review` | รายการ batch |
| `GET` | `/api/batches/:id` | batch + แถวที่ parse แล้ว พร้อมผลกันซ้ำ/หมวดที่เสนอ |
| `POST` | `/api/batches/:id/commit` | จุดเดียวที่เขียน `transactions` |
| `DELETE` | `/api/batches/:id` | `revert_batch()` ทิ้งทั้งก้อน |
| `GET` | `/api/reports/monthly?month=YYYY-MM` | สรุปรายเดือนแยกหมวด (จาก `v_monthly_by_category`) |
| `GET` | `/api/reports/reconcile` | กระทบยอด (จาก `v_account_balance`) |
| `GET` | `/api/ledger` | รายการจาก `v_ledger` พร้อมตัวกรอง |
| `GET` | `/api/accounts`, `/api/categories` | ข้อมูลอ้างอิงสำหรับ dropdown |

ทุกเส้นทาง (ยกเว้น `/api/health`) ต้องมี `Authorization: Bearer <supabase access token>`
ตอน dev ตั้ง `AUTH_DISABLED=true` ข้ามได้ — `NODE_ENV=production` จะปฏิเสธค่านี้
(ต้องตั้ง `NEXT_PUBLIC_AUTH_DISABLED` ให้ตรงกันด้วย ไม่งั้นเว็บเข้าได้แต่ API ตอบ 401)

## การล็อกอิน

ใช้ magic link ทางอีเมลอย่างเดียว ไม่มีรหัสผ่าน

**อีเมลในตัวของ Supabase จำกัด 2 ฉบับต่อชั่วโมง** ซึ่งปลดล็อกได้ทางเดียวคือต่อ SMTP ของตัวเอง
(Dashboard → Authentication → Emails → SMTP Settings) จึงออกแบบให้ **ล็อกอินครั้งเดียวแล้วอยู่ยาว**

- session ของ Supabase อยู่ได้ไม่มีกำหนด refresh token ไม่หมดอายุ
- access token อายุ 1 ชั่วโมง แต่ `middleware.ts` ต่ออายุให้ทุก request
- ปุ่มออกจากระบบจึงต้องกดสองจังหวะ กันเผลอกดแล้วเสียโควต้าอีเมลฟรี ๆ

`/auth/callback` คือปลายทางของลิงก์ในอีเมล ทำหน้าที่แลก `?code=` เป็น session
ถ้าลบ route นี้ทิ้ง กดลิงก์แล้วจะวนกลับหน้า login ไม่จบ

## สิ่งที่ต้องระวังเวลาแก้โค้ด

**`fingerprint` ฝั่ง TypeScript ต้องตรงกับ `tx_fingerprint()` ใน SQL เป๊ะทุกตัวอักษร**
ไม่งั้นค่าที่คำนวณตอนเสนอผล parse จะไม่ตรงกับที่ trigger คำนวณตอน insert แล้วกันซ้ำชั้น 3 พลาดเงียบ ๆ
มีเทสคุมไว้ที่ `apps/api/test/fingerprint.spec.ts`

**เงินเป็น `Decimal`/`string` เสมอ ห้ามผ่าน `number`**
`node-postgres` ถูกตั้งให้คืน `numeric` เป็น string แล้ว (`src/db/pool.ts`) อย่าเปลี่ยนกลับ

**`parser.rows()` ห้าม throw กลางทาง** — แถวที่พังให้ `confidence = 0` แล้วไปต่อ
ไฟล์ 200 แถวพังที่แถว 137 แล้วโยน exception = ผู้ใช้ไม่ได้อะไรเลย

**enqueue job ต้องอยู่ใน transaction เดียวกับการ insert**
นี่คือเหตุผลที่ยังใช้ Postgres เป็นคิวแทน Redis/BullMQ

**รายงานห้าม query `transactions` ตรง ๆ** ให้ผ่าน `v_ledger` เท่านั้น

## เทส

```bash
pnpm test      # 45 เทส ครอบ dedupe, fingerprint, parsers, categorize, OCR text
```

เทสทั้งหมดเป็น unit test ของชั้น `core` ใช้ fake query ไม่แตะ DB จริง

## OCR สลิป

ทดสอบกับสลิปจริง 3 ค่าย (K PLUS, Dime!, TrueMoney) อ่าน QR ได้ 3/3 และอ่านยอด+วันที่ถูก 3/3

สองอย่างที่ต้องรู้ถ้าจะแก้ `adapters/thai-ocr.ts`

**OCR ยิงหลายรอบโดยตั้งใจ** ภาพที่ขยาย+ปรับคอนทราสต์อ่านยอดตัวใหญ่ได้แต่ชื่อเดือนไทยเพี้ยนเป็น
อักษรละติน ส่วนภาพต้นฉบับตรงกันข้าม จึงยิงรอบแรกด้วยภาพที่ปรับแล้ว ขาดอะไรค่อยยิงรอบต่อไป
แล้วเอาข้อความมาต่อกัน (3-5 วินาทีต่อใบ)

**ห้ามหยิบตัวเลขแรกที่เจอมาเป็นยอด** ค่าธรรมเนียมหน้าตาเหมือนยอดจริงเป๊ะ (`0.00 บาท`)
บางค่ายวางไว้เหนือยอดจริงด้วย ถ้าหยิบผิดจะบันทึกรายการ 240.49 เป็น 0.00 แบบเงียบ ๆ
ซึ่งแย่กว่าอ่านไม่ได้ — มีเทสคุมไว้ที่ `test/thai-ocr.spec.ts`

fixture ของเทสคือข้อความที่ tesseract อ่านออกมาจริง ไม่ใช่ข้อความที่พิมพ์เอง
ถ้าเจอสลิปค่ายใหม่ที่อ่านไม่ออก ให้ dump ข้อความ OCR เพิ่มเข้า `test/fixtures-ocr.json`

## ที่ยังไม่เสร็จ

- [ ] ยังไม่เคยรันกับ Supabase จริง — migration ผ่านแค่การอ่าน ยังไม่ integration test
- [ ] `kbank-csv.ts` / `scb-statement-pdf.ts` เป็น mapping เดาไว้ก่อน ต้องทดสอบกับไฟล์ export จริงแล้วปรับ
- [ ] สลิปที่เป็น PDF ต้องมี `@napi-rs/canvas` ถึงจะ render อ่าน QR ได้ (โค้ด degrade เป็น unreadable ถ้าไม่มี)
- [ ] ยังไม่มีหน้าจัดการบัญชี/หมวดหมู่/งบประมาณบนเว็บ (API `POST /api/accounts` มีแล้ว)
