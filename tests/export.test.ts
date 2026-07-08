import { describe, expect, it } from 'vitest';
import { createKdfParams } from '../src/crypto';
import {
  buildExportFile,
  decryptExportFile,
  parseExportFile,
} from '../src/export/exportFile';
import type { Draft, Post } from '../src/storage/db';

const TEST_ITERATIONS = 1_000;

const posts: Post[] = [
  {
    id: 'p1',
    n: 1,
    text: '第一則',
    visibility: 'private',
    contentHash: 'a'.repeat(64),
    etchedAt: '2026-01-01T00:00:00.000Z',
    lastEditedAt: '2026-01-01T00:00:00.000Z',
    struckAt: null,
  },
  {
    id: 'p2',
    n: 2,
    text: '第二則，後來劃掉了',
    visibility: 'public',
    contentHash: 'b'.repeat(64),
    etchedAt: '2026-03-01T00:00:00.000Z',
    lastEditedAt: '2026-03-01T00:00:00.000Z',
    struckAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'p3',
    n: 3,
    text: '第三則，匯出當下仍在可塑期（編輯過）',
    visibility: 'private',
    contentHash: 'c'.repeat(64),
    etchedAt: '2026-07-01T00:00:00.000Z',
    lastEditedAt: '2026-07-01T12:00:00.000Z',
    struckAt: null,
  },
];
const drafts: Draft[] = [
  {
    id: 'draft-1',
    text: '差點說出口的話',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
  },
];

describe('export file', () => {
  it('匯出 → 序列化 → 解析 → 解密，完整往返（含可塑期貼文）', async () => {
    const kdf = createKdfParams(TEST_ITERATIONS);
    const file = await buildExportFile('通關密語123', kdf, posts, drafts);
    expect(file.quotaUsed).toBe(3); // = posts 則數，含未定形的

    // 模擬存檔再讀檔
    const parsed = parseExportFile(JSON.stringify(file));
    expect(parsed.format).toBe('etch-export');
    expect(parsed.version).toBe(1);

    const restored = await decryptExportFile(parsed, '通關密語123');
    expect(restored.posts).toEqual(posts);
    expect(restored.drafts).toEqual(drafts);
  });

  it('密文中不含明文內容', async () => {
    const kdf = createKdfParams(TEST_ITERATIONS);
    const file = await buildExportFile('通關密語123', kdf, posts, drafts);
    const json = JSON.stringify(file);
    expect(json).not.toContain('第一則');
    expect(json).not.toContain('差點說出口的話');
  });

  it('錯誤的密語解不開', async () => {
    const kdf = createKdfParams(TEST_ITERATIONS);
    const file = await buildExportFile('通關密語123', kdf, posts, drafts);
    await expect(decryptExportFile(file, '錯的密語')).rejects.toThrow(/解密失敗/);
  });

  it('拒絕非 Etch 匯出檔與未知版本', () => {
    expect(() => parseExportFile('not json')).toThrow(/JSON/);
    expect(() => parseExportFile('{"format":"other"}')).toThrow(/不是 Etch/);
    expect(() =>
      parseExportFile('{"format":"etch-export","version":99}'),
    ).toThrow(/版本/);
  });
});
