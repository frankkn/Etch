import { useEffect, useState } from 'react';
import type { View } from '../App';
import { QUOTA_TOTAL } from '../lib/constants';
import { countdownLabel } from '../lib/time';
import {
  editPost,
  etchDraft,
  etchText,
  malleableRemainingMs,
  saveDraft,
  type Draft,
  type Post,
} from '../storage/db';
import { EtchConfirm } from './EtchConfirm';

export type WriteTarget =
  | { kind: 'new' }
  | { kind: 'draft'; draft: Draft }
  | { kind: 'post'; post: Post };

export function Write({
  target,
  quotaUsed,
  onDone,
}: {
  target: WriteTarget;
  quotaUsed: number;
  onDone: (dest: View) => Promise<void>;
}) {
  const initialText =
    target.kind === 'draft'
      ? target.draft.text
      : target.kind === 'post'
        ? target.post.text
        : '';
  const targetId =
    target.kind === 'draft'
      ? target.draft.id
      : target.kind === 'post'
        ? target.post.id
        : null;

  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  const exhausted = quotaUsed >= QUOTA_TOTAL;
  const canSubmit = text.trim() !== '' && !busy;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {target.kind === 'post' ? (
        <p className="rounded border border-stone-800 bg-stone-900/40 p-4 text-xs leading-relaxed text-stone-400">
          編輯 No. {target.post.n}（可塑期還剩{' '}
          {countdownLabel(malleableRemainingMs(target.post))}
          ）。編號不變，時限也不會延長——定形時間固定是發布後 24 小時。
        </p>
      ) : exhausted ? (
        <p className="rounded border border-stone-800 bg-stone-900/40 p-4 text-sm text-stone-400">
          你的 {QUOTA_TOTAL} 則已經用完了。仍然可以寫，但只能存成草稿。
        </p>
      ) : null}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="純文字。Etch 會立刻發布——之後有 24 小時可以反悔。"
        rows={12}
        className="etch-content w-full resize-y rounded border border-stone-800 bg-stone-900/40 p-4 text-stone-200 outline-none placeholder:text-stone-700 focus:border-stone-600"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center justify-end gap-4">
        <span className="text-xs text-stone-600">{text.length} 字</span>
        {target.kind === 'post' ? (
          <button
            disabled={!canSubmit}
            onClick={() =>
              run(async () => {
                await editPost(target.post.id, text);
                await onDone('timeline');
              })
            }
            className="rounded border border-stone-600 px-5 py-2 text-sm text-stone-100 transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            更新
          </button>
        ) : (
          <>
            <button
              disabled={!canSubmit}
              onClick={() =>
                run(async () => {
                  await saveDraft(
                    text,
                    target.kind === 'draft' ? target.draft.id : undefined,
                  );
                  await onDone('drafts');
                })
              }
              className="rounded px-4 py-2 text-sm text-stone-400 transition-colors hover:text-stone-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              存為草稿
            </button>
            <button
              disabled={!canSubmit || exhausted}
              onClick={() => setConfirming(true)}
              className="rounded border border-stone-400 px-5 py-2 text-sm font-medium text-stone-100 transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Etch
            </button>
          </>
        )}
      </div>
      {confirming && (
        <EtchConfirm
          text={text}
          quotaUsed={quotaUsed}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            if (target.kind === 'draft') {
              // 先把最新內容存回草稿，出版的才是眼前這個版本
              await saveDraft(text, target.draft.id);
              await etchDraft(target.draft.id);
            } else {
              await etchText(text);
            }
            await onDone('timeline');
          }}
        />
      )}
    </div>
  );
}
