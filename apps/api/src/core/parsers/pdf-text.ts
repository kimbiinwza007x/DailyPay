/**
 * ดึงข้อความจาก PDF ด้วย pdfjs-dist (legacy build ใช้ใน Node ได้)
 * โหลดแบบ lazy + ห่อ try/catch ทั้งหมด: เครื่องที่ยังไม่ได้ลง pdfjs ต้อง sniff ได้อยู่
 * แค่ได้คะแนนต่ำลง ไม่ใช่ทั้ง request พัง
 */
export async function extractPdfText(raw: Buffer): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(raw),
      // ไม่มี worker ใน Node — บังคับให้รันใน thread เดียวกัน
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // จัดบรรทัดใหม่จากพิกัด y เพราะ pdfjs คืน item เรียงตาม content stream ไม่ใช่ตามสายตา
      const lines = new Map<number, { x: number; s: string }[]>();
      for (const item of content.items as { str?: string; transform?: number[] }[]) {
        if (typeof item.str !== 'string' || item.str === '') continue;
        const t = item.transform ?? [0, 0, 0, 0, 0, 0];
        const y = Math.round((t[5] ?? 0) * 2) / 2;
        const x = t[4] ?? 0;
        const bucket = lines.get(y) ?? [];
        bucket.push({ x, s: item.str });
        lines.set(y, bucket);
      }
      const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
      for (const [, bucket] of ordered) {
        parts.push(
          bucket
            .sort((a, b) => a.x - b.x)
            .map((c) => c.s)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        );
      }
      await page.cleanup();
    }
    await doc.destroy();
    return parts.join('\n');
  } catch {
    return '';
  }
}

/** render หน้าแรกของ PDF เป็น PNG ที่ 300dpi — สลิปที่เป็น PDF ต้องทำก่อนอ่าน QR เสมอ */
export async function renderPdfFirstPage(raw: Buffer, dpi = 300): Promise<Buffer | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = (await import('@napi-rs/canvas')) as {
      createCanvas: (w: number, h: number) => {
        getContext(t: '2d'): unknown;
        toBuffer(mime: 'image/png'): Buffer;
      };
    };
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(raw),
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await (page.render({ canvasContext: ctx, viewport } as never) as { promise: Promise<void> })
      .promise;
    const out = canvas.toBuffer('image/png');
    await doc.destroy();
    return out;
  } catch {
    // @napi-rs/canvas เป็น optional dependency — ไม่มีก็แค่ไม่รองรับสลิป PDF
    return null;
  }
}
