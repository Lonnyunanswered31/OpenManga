import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useState } from "react";
import { get, post } from "../../api/client.ts";
import { qk, useAction } from "../../api/hooks.ts";
import type { ChapterListItem } from "../../api/types.ts";
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner, StatusChip } from "../../components/ui.tsx";
import { ChapterBatchChip } from "../generation/BatchStatus.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { DeleteChapterButton } from "./DeleteChapterButton.tsx";
import { PlanButton } from "./PlanButton.tsx";

export function NarrationCoverage({ stats: s }: { stats: NonNullable<ChapterListItem["stats"]> }) {
  if (!s.panels) return null;
  if (!s.narration)
    return <span className="chip bg-amber-500/15 text-amber-600 dark:text-amber-300">no narration</span>;
  const pct = Math.round((Math.min(s.narratedPanels, s.panels) / s.panels) * 100);
  return (
    <span
      className={
        pct < 90 ? "chip bg-amber-500/15 text-amber-600 dark:text-amber-300" : "chip bg-emerald-500/15 text-emerald-600"
      }
      title="Panels with at least one narration line"
    >
      narration covers {pct}% of panels
    </span>
  );
}

export function ChaptersPage() {
  const projectId = useProjectId();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: qk.chapters(projectId),
    queryFn: () => get<{ chapters: ChapterListItem[] }>(`/projects/${projectId}/chapters`),
  });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", sourceExcerpt: "" });
  const create = useAction(() => post(`/projects/${projectId}/chapters`, form), {
    invalidate: [qk.chapters(projectId)],
    success: "Chapter created",
    onSuccess: () => {
      setCreating(false);
      setForm({ title: "", summary: "", sourceExcerpt: "" });
    },
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Chapters"
        subtitle="Chapter → scene → page → panel planning."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New chapter
          </button>
        }
      />
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading && <Spinner className="size-6" />}
      {data && !data.chapters.length && (
        <EmptyState icon={<FileText className="size-8" />} title="No chapters yet">
          Apply a story analysis to create chapters, or add one manually.
        </EmptyState>
      )}
      <div className="space-y-3">
        {data?.chapters.map((ch) => {
          const s = ch.stats;
          return (
            <div key={ch.id} className="card flex flex-wrap items-start gap-4 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--panel-2)] font-semibold">
                {ch.order}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/projects/$projectId/chapters/$chapterId"
                    params={{ projectId, chapterId: ch.id }}
                    className="font-medium hover:underline"
                  >
                    {ch.title}
                  </Link>
                  <StatusChip status={ch.planStatus} label={`plan: ${ch.planStatus}`} />
                  {!ch.hasPlan && <span className="muted text-xs">not planned</span>}
                  <ChapterBatchChip projectId={projectId} chapterId={ch.id} />
                </div>
                <p className="muted mt-1 line-clamp-2 text-sm">{ch.summary || "No summary"}</p>
                {s && (
                  <div className="muted mt-2 flex flex-wrap gap-3 text-xs">
                    <span>{s.scenes} scenes</span>
                    <span>{s.pages} pages</span>
                    <span>
                      {s.ready}/{s.panels} panels with art
                    </span>
                    <span>{s.narration} narration lines</span>
                    <NarrationCoverage stats={s} />
                    <span>{ch.sourceLength.toLocaleString()} chars source</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <PlanButton
                  projectId={projectId}
                  chapterId={ch.id}
                  hasPages={(s?.pages ?? 0) > 0}
                  label={s?.pages ? "Replan" : "Plan chapter"}
                />
                <Link
                  to="/projects/$projectId/pages"
                  params={{ projectId }}
                  search={{ chapterId: ch.id }}
                  className="btn-secondary"
                >
                  Pages
                </Link>
                <Link
                  to="/projects/$projectId/narration"
                  params={{ projectId }}
                  search={{ chapterId: ch.id }}
                  className="btn-secondary"
                >
                  Narration
                </Link>
                <DeleteChapterButton projectId={projectId} chapter={ch} stats={s} />
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New chapter"
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!form.title.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Create
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">Title</span>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Summary</span>
            <textarea
              className="input min-h-16"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Source text (used for planning)</span>
            <textarea
              className="input min-h-48"
              value={form.sourceExcerpt}
              onChange={(e) => setForm({ ...form, sourceExcerpt: e.target.value })}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
