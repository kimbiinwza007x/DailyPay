/** อ่าน env ครั้งเดียวตอนบูต แล้วล้มทันทีถ้าขาด — ดีกว่าไปพังตอน request แรกกลางดึก */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'ต้องตั้ง DATABASE_URL (connection string ของ Supabase)'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().default('imports'),
  API_PORT: z.coerce.number().int().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  /** ปิด auth ได้เฉพาะตอน dev เครื่องตัวเอง — production ต้องเป็น false เสมอ */
  AUTH_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().default(2000),
  /**
   * จำนวน connection ต่อ process — เครื่องตัวเองใช้ 10 ได้
   * บน Vercel ต้องต่ำ (ค่าเริ่มต้น 3) เพราะทุก instance ของ function ถือ pool แยกกัน
   */
  PG_POOL_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .default(process.env['VERCEL'] ? 3 : 10),
  /** Vercel ส่งค่านี้มาใน Authorization ตอนเรียก cron — กันคนนอกยิง endpoint เอง */
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`ตั้งค่า environment ไม่ครบ:\n${issues.join('\n')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.AUTH_DISABLED) {
    throw new Error('AUTH_DISABLED=true ใช้กับ NODE_ENV=production ไม่ได้');
  }
  cached = parsed.data;
  return cached;
}
