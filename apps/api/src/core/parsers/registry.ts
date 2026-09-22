import { NoParserMatched, type Parser } from './base';

export class ParserRegistry {
  constructor(private readonly parsers: Parser[]) {}

  /** ให้แต่ละ parser บอกเองว่ามั่นใจแค่ไหน — ผู้ใช้ไม่ต้องเลือกธนาคารจาก dropdown */
  async pick(raw: Buffer, filename: string, threshold = 0.5): Promise<Parser> {
    const scored = await Promise.all(
      this.parsers.map(async (p) => {
        try {
          return { score: await p.sniff(raw, filename), parser: p };
        } catch {
          // parser ที่ sniff พัง (เช่น pdfjs ไม่ได้ติดตั้ง) ต้องไม่ล้มทั้งกอง
          return { score: 0, parser: p };
        }
      }),
    );
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < threshold) {
      const hint = best
        ? `ตัวที่ใกล้สุดคือ ${best.parser.name} (${best.score.toFixed(2)})`
        : 'ไม่มี parser ที่ลงทะเบียนไว้';
      throw new NoParserMatched(`ไม่รู้จักรูปแบบไฟล์นี้ ${hint}`);
    }
    return best.parser;
  }
}
