import { Injectable, Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../config/env';
import type { ObjectStore } from './object-store';

/** uri ที่เก็บลง DB: supabase://<bucket>/<key> — ย้าย bucket ทีหลังได้โดยไม่ต้องไล่แก้แถวเก่า */
const SCHEME = 'supabase://';

@Injectable()
export class SupabaseObjectStore implements ObjectStore {
  private readonly log = new Logger(SupabaseObjectStore.name);
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor() {
    const env = loadEnv();
    // service_role key: bypass RLS ได้ ห้ามให้หลุดไปฝั่ง browser เด็ดขาด
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = env.SUPABASE_STORAGE_BUCKET;
  }

  private split(uri: string): { bucket: string; key: string } {
    if (!uri.startsWith(SCHEME)) throw new Error(`ไม่รองรับ uri scheme: ${uri}`);
    const rest = uri.slice(SCHEME.length);
    const slash = rest.indexOf('/');
    if (slash < 0) throw new Error(`uri ไม่มี key: ${uri}`);
    return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }

  async put(key: string, data: Buffer, contentType = 'application/octet-stream'): Promise<string> {
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, {
      contentType,
      // key คือ sha256 ของไฟล์ ไฟล์เดิมได้ key เดิม เขียนทับได้ไม่เสียหาย
      upsert: true,
    });
    if (error) throw new Error(`อัปโหลดไฟล์ขึ้น Supabase Storage ไม่สำเร็จ: ${error.message}`);
    return `${SCHEME}${this.bucket}/${key}`;
  }

  async get(uri: string): Promise<Buffer> {
    const { bucket, key } = this.split(uri);
    const { data, error } = await this.client.storage.from(bucket).download(key);
    if (error || !data) {
      throw new Error(`อ่านไฟล์จาก Supabase Storage ไม่สำเร็จ: ${error?.message ?? 'ไม่พบไฟล์'}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async signedUrl(uri: string, expiresInSeconds = 300): Promise<string | null> {
    try {
      const { bucket, key } = this.split(uri);
      const { data, error } = await this.client.storage
        .from(bucket)
        .createSignedUrl(key, expiresInSeconds);
      if (error) throw error;
      return data?.signedUrl ?? null;
    } catch (err) {
      this.log.warn(`สร้าง signed url ไม่สำเร็จ: ${String(err)}`);
      return null;
    }
  }
}
