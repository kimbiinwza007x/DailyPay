// Vercel function เดียวของ API — ทุก path ถูก rewrite มาที่นี่ (ดู vercel.json)
//
// เป็น .js ธรรมดาโดยตั้งใจ: ถ้าเป็น .ts builder ของ Vercel จะ transpile ด้วย esbuild
// ซึ่งไม่ปล่อย decorator metadata แล้ว DI ของ Nest จะพัง จึงให้ `nest build` (tsc)
// compile ไว้ที่ dist/ ก่อน แล้วไฟล์นี้แค่ require ของที่ build แล้ว
module.exports = require('../dist/vercel').default;
