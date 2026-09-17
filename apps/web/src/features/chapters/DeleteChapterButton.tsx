import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { del } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import { ConfirmDialog } from "../../components/ui.tsx";

export function DeleteChapterButton({
  projectId,
  chapter,
  stats,
  onDeleted,
}: {
  projectId: string;
  chapter: { id: string; order: number; title: string };
  stats?: { pages: number; panels: number; narration?: number } | null;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useAction(() => del(`/chapters/${chapter.id}`), {
    success: `Chapter "${chapter.title}" deleted`,
    onSuccess: async () => {
      setOpen(false);
      qc.removeQueries({ queryKey: qk.chapter(chapter.id) });
      onDeleted?.();
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
  return (
    <>
      <button
        type="button"
        className="btn-ghost text-red-500"
        onClick={() => setOpen(true)}
        aria-label={`Delete chapter ${chapter.order}`}
        title="Delete chapter"
      >
        <Trash2 className="size-4" />
      </button>
      <ConfirmDialog
        open={open}
        danger
        busy={remove.isPending}
        title={`Delete chapter ${chapter.order}: ${chapter.title}?`}
        confirmLabel="Delete chapter"
        onClose={() => setOpen(false)}
        onConfirm={() => remove.mutate()}
      >
        <p>
          This permanently removes the chapter with its scenes, pages, panels, lettering and narration
          {stats
            ? ` (${stats.pages} pages, ${stats.panels} panels${stats.narration !== undefined ? `, ${stats.narration} narration lines` : ""})`
            : ""}
          . Later chapters are renumbered.
        </p>
        <p className="muted mt-2 text-sm">
          Generated artwork and audio stay in the Assets library. Chapters with generations in progress can't be deleted
          until those finish or are cancelled.
        </p>
      </ConfirmDialog>
    </>
  );
}
