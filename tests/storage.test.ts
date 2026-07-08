import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createKdfParams, sha256Hex } from '../src/crypto';
import { MALLEABLE_WINDOW_MS, QUOTA_TOTAL } from '../src/lib/constants';
import {
  _closeDbForTests,
  deleteDraft,
  deletePost,
  editPost,
  etchDraft,
  etchText,
  getQuotaUsed,
  hardenTimeMs,
  importAll,
  isMalleable,
  isStoreEmpty,
  listDrafts,
  listPosts,
  saveDraft,
  strikePost,
  type Post,
} from '../src/storage/db';

beforeEach(async () => {
  await _closeDbForTests();
  await deleteDB('etch');
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

const hardenedPost = (n: number, text = `第 ${n} 則`): Post => ({
  id: `p${n}`,
  n,
  text,
  visibility: 'private',
  contentHash: 'f'.repeat(64), // 測試 fixture，不需要是真實雜湊
  etchedAt: '2026-01-01T00:00:00.000Z',
  lastEditedAt: '2026-01-01T00:00:00.000Z',
  struckAt: null,
});

describe('立即發布與編號', () => {
  it('Etch 立即發布：立即定號、可塑、佔額度', async () => {
    const post = await etchText('第一則');
    expect(post.n).toBe(1);
    expect(isMalleable(post)).toBe(true);
    expect(await getQuotaUsed()).toBe(1);
  });

  it('編號依發布順序遞增', async () => {
    const a = await etchText('一');
    const b = await etchText('二');
    expect(a.n).toBe(1);
    expect(b.n).toBe(2);
  });

  it('從草稿出版：貼文寫入、草稿刪除', async () => {
    const draft = await saveDraft('放了很久的話');
    const post = await etchDraft(draft.id);
    expect(post.text).toBe('放了很久的話');
    expect(post.n).toBe(1);
    expect(await listDrafts()).toHaveLength(0);
  });

  it('空白內容不能出版', async () => {
    await expect(etchText('   \n  ')).rejects.toThrow(/空白/);
  });
});

describe('可見性與 contentHash', () => {
  it('預設私密；Etch 時可選公開', async () => {
    const a = await etchText('刻給自己');
    const b = await etchText('刻給世界', { visibility: 'public' });
    expect(a.visibility).toBe('private');
    expect(b.visibility).toBe('public');
  });

  it('contentHash = SHA-256(明文)，發布時計算', async () => {
    const post = await etchText('abc');
    expect(post.contentHash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('可塑期內編輯會同步更新 contentHash 與可見性', async () => {
    const post = await etchText('原文', { visibility: 'public' });
    const edited = await editPost(post.id, '改過的文', {
      visibility: 'private',
    });
    expect(edited.contentHash).not.toBe(post.contentHash);
    expect(edited.contentHash).toBe(await sha256Hex('改過的文'));
    expect(edited.visibility).toBe('private');
  });

  it('編輯時不指定可見性則維持原狀', async () => {
    const post = await etchText('原文', { visibility: 'public' });
    const edited = await editPost(post.id, '只改字');
    expect(edited.visibility).toBe('public');
  });
});

describe('可塑期（固定 24 小時，錨定發布時間）', () => {
  it('可塑期內可編輯：編號不變、時限不延長', async () => {
    const post = await etchText('初版', { now: hoursAgo(23) });
    const edited = await editPost(post.id, '修過的版本');
    expect(edited.n).toBe(post.n);
    expect(edited.etchedAt).toBe(post.etchedAt);
    // 定形時刻錨定發布時間，編輯不重置
    expect(hardenTimeMs(edited)).toBe(hardenTimeMs(post));
    expect(hardenTimeMs(edited)).toBe(
      new Date(post.etchedAt).getTime() + MALLEABLE_WINDOW_MS,
    );
  });

  it('發布超過 24 小時後不可編輯、不可刪除（即使剛編輯過也一樣）', async () => {
    const post = await etchText('已成定局', { now: hoursAgo(25) });
    await expect(editPost(post.id, '想改')).rejects.toThrow(/定形/);
    await expect(deletePost(post.id)).rejects.toThrow(/定形/);
  });

  it('可塑期內可刪除：額度退還、不留痕跡', async () => {
    const post = await etchText('後悔了');
    await deletePost(post.id);
    expect(await listPosts()).toHaveLength(0);
    expect(await getQuotaUsed()).toBe(0);
  });

  it('刪除後，之後的貼文編號往前遞補；重發拿到最新編號', async () => {
    const a = await etchText('A');
    const b = await etchText('B');
    const c = await etchText('C');
    expect([a.n, b.n, c.n]).toEqual([1, 2, 3]);
    await deletePost(b.id);
    const after = await listPosts();
    expect(after.map((p) => [p.text, p.n])).toEqual([
      ['A', 1],
      ['C', 2],
    ]);
    const d = await etchText('D（重發）');
    expect(d.n).toBe(3); // 最新編號
  });

  it('遞補不會動到已定形的編號（定形的必然在前面）', async () => {
    const old = await etchText('已定形', { now: hoursAgo(30) });
    const fresh = await etchText('還可塑－1');
    const fresh2 = await etchText('還可塑－2');
    await deletePost(fresh.id);
    const posts = await listPosts();
    const byId = new Map(posts.map((p) => [p.id, p]));
    expect(byId.get(old.id)!.n).toBe(1); // 石頭不動
    expect(byId.get(fresh2.id)!.n).toBe(2); // 可塑的遞補
  });
});

describe('額度', () => {
  it('額度含可塑期中的貼文，用完不能再發', async () => {
    const posts = Array.from({ length: QUOTA_TOTAL }, (_, i) =>
      hardenedPost(i + 1),
    );
    await importAll(posts, [], createKdfParams(1_000));
    await expect(etchText('第 101 則')).rejects.toThrow(/用完/);
  });

  it('刪除可塑貼文後，額度立刻可再使用', async () => {
    const posts = Array.from({ length: QUOTA_TOTAL - 1 }, (_, i) =>
      hardenedPost(i + 1),
    );
    await importAll(posts, [], createKdfParams(1_000));
    const last = await etchText('第 100 則');
    await expect(etchText('第 101 則')).rejects.toThrow(/用完/);
    await deletePost(last.id);
    const replacement = await etchText('重來的第 100 則');
    expect(replacement.n).toBe(QUOTA_TOTAL);
  });
});

describe('Strike 與不可逆性', () => {
  it('可塑期內不能 Strike（該用編輯或刪除）', async () => {
    const post = await etchText('還可塑');
    await expect(strikePost(post.id)).rejects.toThrow(/可塑期/);
  });

  it('定形後可 Strike，僅一次且不可逆；劃掉仍佔額度、編號不變', async () => {
    const post = await etchText('曾經這樣想', { now: hoursAgo(25) });
    const struck = await strikePost(post.id);
    expect(struck.struckAt).not.toBeNull();
    expect(struck.n).toBe(1);
    await expect(strikePost(post.id)).rejects.toThrow(/不可逆/);
    expect(await listPosts()).toHaveLength(1);
    expect(await getQuotaUsed()).toBe(1);
  });

});

describe('草稿（唯一完全自由的空間）', () => {
  it('儲存與編輯草稿', async () => {
    const draft = await saveDraft('初稿');
    const edited = await saveDraft('改過的稿', draft.id);
    expect(edited.id).toBe(draft.id);
    expect(edited.createdAt).toBe(draft.createdAt);
    expect(await listDrafts()).toHaveLength(1);
  });

  it('草稿可自由刪除（真刪除，不留痕跡）', async () => {
    const draft = await saveDraft('想想還是算了');
    await deleteDraft(draft.id);
    expect(await listDrafts()).toHaveLength(0);
  });
});

describe('匯入', () => {
  it('全新裝置可匯入還原（含可塑期中的貼文）', async () => {
    expect(await isStoreEmpty()).toBe(true);
    await importAll(
      [
        hardenedPost(1, '定形的貼文'),
        {
          id: 'p2',
          n: 2,
          text: '匯出當下還在可塑期',
          visibility: 'public',
          contentHash: 'f'.repeat(64),
          etchedAt: hoursAgo(1).toISOString(),
          lastEditedAt: hoursAgo(1).toISOString(),
          struckAt: null,
        },
      ],
      [],
      createKdfParams(1_000),
    );
    const posts = await listPosts();
    expect(posts).toHaveLength(2);
    expect(await getQuotaUsed()).toBe(2);
    expect(isMalleable(posts.find((p) => p.id === 'p2')!)).toBe(true);
  });

  it('本機已有資料時拒絕匯入覆蓋', async () => {
    await saveDraft('本機既有的草稿');
    await expect(importAll([], [], createKdfParams(1_000))).rejects.toThrow(
      /已有資料/,
    );
  });
});
