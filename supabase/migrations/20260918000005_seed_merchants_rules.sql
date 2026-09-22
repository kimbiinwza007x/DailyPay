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

