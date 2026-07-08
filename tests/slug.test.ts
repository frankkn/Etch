import { describe, expect, it } from 'vitest';
import { generateSlug, SLUG_PATTERN } from '../src/sync/slug';

describe('分享連結 slug', () => {
  it('12 位、只含不易混淆的英數字元', () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(12);
    expect(slug).toMatch(/^[A-Za-z0-9]+$/);
    expect(slug).not.toMatch(/[0OIl1]/); // 去掉易混淆字元
  });

  it('每次產生都不同（隨機性煙霧測試）', () => {
    const slugs = new Set(Array.from({ length: 50 }, () => generateSlug()));
    expect(slugs.size).toBe(50);
  });

  it('路由 pattern 能解析分享頁網址', () => {
    const slug = generateSlug();
    expect(`/s/${slug}`.match(SLUG_PATTERN)?.[1]).toBe(slug);
    expect(`/s/${slug}/`.match(SLUG_PATTERN)?.[1]).toBe(slug);
    expect('/timeline'.match(SLUG_PATTERN)).toBeNull();
    expect('/s/'.match(SLUG_PATTERN)).toBeNull();
  });
});
