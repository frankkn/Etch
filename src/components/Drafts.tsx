import { useState } from 'react';
import { formatDateTime } from '../lib/time';
import { deleteDraft, etchDraft, type Draft } from '../storage/db';
import { EtchConfirm } from './EtchConfirm';

/** 草稿是唯一完全自由的空間：可編輯、可刪除，無時間約束，永遠不能公開。 */
export function Drafts({
  drafts,
  quotaUsed,
  onEdit,
  onEtched,
  onChanged,
}: {
  drafts: Draft[];
  quotaUsed: number;
  onEdit: (id: string) => void;
  onEtched: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (drafts.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-stone-600">
        還沒有草稿。這裡的東西完全自由——直到你把它刻下去。
      </p>
    );
  }

  const confirming = drafts.find((d) => d.id === confirmingId) ?? null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-600">
        草稿可以隨意改、隨意刪，不趕時間。Etch 會立刻發布——之後有 24 小時可以反悔。
      </p>
      {drafts.map((draft) => (
        <article
          key={draft.id}
          className="rounded border border-stone-800 bg-stone-900/40 p-5"
        >
          <header className="mb-3 flex items-baseline justify-between text-xs text-stone-500">
            <time dateTime={draft.createdAt}>
              {formatDateTime(draft.createdAt)}
            </time>
          </header>
          <p className="etch-content line-clamp-6 text-stone-300">
            {draft.text}
          </p>
          <footer className="mt-4 flex items-center justify-end gap-2 text-sm">
            {deletingId === draft.id ? (
              <>
                <span className="text-xs text-stone-400">刪除這則草稿？</span>
                <button
                  onClick={() => setDeletingId(null)}
                  className="rounded px-3 py-1.5 text-stone-400 hover:text-stone-200"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    await deleteDraft(draft.id);
                    setDeletingId(null);
                    await onChanged();
                  }}
                  className="rounded border border-red-900 px-3 py-1.5 text-red-400 hover:bg-red-950"
                >
                  刪除
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setDeletingId(draft.id)}
                  className="rounded px-3 py-1.5 text-stone-700 hover:text-stone-400"
                >
                  刪除
                </button>
                <button
                  onClick={() => onEdit(draft.id)}
                  className="rounded px-3 py-1.5 text-stone-500 hover:text-stone-200"
                >
                  編輯
                </button>
                <button
                  onClick={() => setConfirmingId(draft.id)}
                  className="rounded border border-stone-500 px-4 py-1.5 text-stone-100 hover:bg-stone-800"
                >
                  Etch
                </button>
              </>
            )}
          </footer>
        </article>
      ))}
      {confirming && (
        <EtchConfirm
          text={confirming.text}
          quotaUsed={quotaUsed}
          onClose={() => setConfirmingId(null)}
          onConfirm={async (visibility) => {
            await etchDraft(confirming.id, { visibility });
            await onEtched();
          }}
        />
      )}
    </div>
  );
}
