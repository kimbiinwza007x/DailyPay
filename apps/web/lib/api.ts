import { createClient } from './supabase-server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** เรียก Nest API จาก server component พร้อมแนบ access token ของ Supabase */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      // ตอบกลับไม่ใช่ json — ใช้ statusText ตามเดิม
    }
    throw new ApiError(`เรียก ${path} ไม่สำเร็จ: ${detail}`, res.status);
  }
  return res.json() as Promise<T>;
}
