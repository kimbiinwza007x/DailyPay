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
