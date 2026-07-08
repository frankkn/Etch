import { useState } from 'react';
import { formatDateTime } from '../lib/time';
import { etchDraft, type Draft } from '../storage/db';
import { EtchConfirm } from './EtchConfirm';

export function Graveyard({
  drafts,
  quotaUsed,
  onEdit,
  onEtched,
}: {
  drafts: Draft[];
  quotaUsed: number;
  onEdit: (id: string) => void;
  onEtched: () => Promise<void>;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (drafts.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-stone-600">
        墳場是空的。這裡會躺著你差點說出口的話。
      </p>
    );
  }

  const confirming = drafts.find((d) => d.id === confirmingId) ?? null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-600">
        草稿不會消失，也不趕時間。Etch 會立刻發布——之後有 24 小時可以反悔。
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
          <footer className="mt-4 flex justify-end gap-2 text-sm">
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
          </footer>
        </article>
      ))}
      {confirming && (
        <EtchConfirm
          text={confirming.text}
          quotaUsed={quotaUsed}
          onClose={() => setConfirmingId(null)}
          onConfirm={async () => {
            await etchDraft(confirming.id);
            await onEtched();
          }}
        />
      )}
    </div>
  );
}
