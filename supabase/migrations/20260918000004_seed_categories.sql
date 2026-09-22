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

