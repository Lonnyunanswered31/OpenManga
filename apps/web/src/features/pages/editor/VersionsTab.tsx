import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Columns2, Trash2 } from "lucide-react";
import { useState } from "react";
import { assetUrl, del, get, post } from "../../../api/client.ts";
import { qk, useAction } from "../../../api/hooks.ts";
import type { ArtworkVersion, EditorPanel } from "../../../api/types.ts";
import { AssetImage, clsx, EmptyState, ErrorBox, fmt, Modal, Spinner } from "../../../components/ui.tsx";
import { useProjectId } from "../../project/ProjectLayout.tsx";

export function VersionsTab({ panel, pageId }: { panel: EditorPanel; pageId: string }) {
  const projectId = useProjectId();
  const q = useQuery({
    queryKey: [...qk.panel(panel.id), "versions"],
    queryFn: () => get<{ activeAssetId: string | null; versions: ArtworkVersion[] }>(`/panels/${panel.id}/versions`),
  });
  const [compare, setCompare] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const inv = [qk.panel(panel.id), qk.page(pageId)];
  const activate = useAction((assetId: string) => post(`/panels/${panel.id}/versions/${assetId}/activate`), {
    invalidate: inv,
    success: "Version activated",
  });
  const remove = useAction((assetId: string) => del(`/panels/${panel.id}/versions/${assetId}`), {
    invalidate: inv,
    success: "Version moved to trash",
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const versions = q.data?.versions ?? [];
  if (!versions.length)
    return <EmptyState title="No artwork yet">Generate the panel to create its first version.</EmptyState>;
  const byId = new Map(versions.map((v) => [v.assetId, v]));
  const toggle = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c.slice(-1), id]));

  return (
    <div className="space-y-2 text-sm">
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={compare.length !== 2}
        onClick={() => setOpen(true)}
      >
        <Columns2 className="size-4" /> Compare selected ({compare.length}/2)
      </button>
      <ul className="space-y-2">
        {versions.map((v) => {
          const active = q.data?.activeAssetId === v.assetId;
          const parent = v.parentAssetId ? byId.get(v.parentAssetId) : null;
          return (
            <li
              key={v.assetId}
              className={clsx(
                "flex gap-2 rounded-lg border p-2",
                active ? "border-emerald-500" : "border-[var(--border)]",
              )}
            >
              <a href={assetUrl(v.assetId)} target="_blank" rel="noreferrer" className="shrink-0">
                <AssetImage assetId={v.assetId} alt={`Version ${v.versionNumber}`} className="size-20 rounded" />
              </a>
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex items-center gap-1 font-medium">
                  v{v.versionNumber}{" "}
                  {active && <CheckCircle2 className="size-3.5 text-emerald-500" aria-label="Active" />}
                  {v.cancelled && <span className="chip bg-zinc-500/15">cancelled</span>}
                </div>
                <div className="muted">
                  {(v.operation ?? v.kind ?? "generation").replace(/_/g, " ")}
                  {parent ? ` · from v${parent.versionNumber}` : ""}
                </div>
                <div className="muted">
                  {v.width}×{v.height} · {fmt.ago(v.createdAt)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={compare.includes(v.assetId)} onChange={() => toggle(v.assetId)} />{" "}
                    compare
                  </label>
                  {!active && (
                    <button
                      type="button"
                      className="btn-ghost px-1.5 py-0.5 text-xs"
                      onClick={() => activate.mutate(v.assetId)}
                    >
                      Activate
                    </button>
                  )}
                  {v.generationJobId && (
                    <Link
                      to="/projects/$projectId/generation/$jobId"
                      params={{ projectId, jobId: v.generationJobId }}
                      className="btn-ghost px-1.5 py-0.5 text-xs"
                    >
                      Job
                    </Link>
                  )}
                  {!active && (
                    <button
                      type="button"
                      className="btn-ghost px-1 py-0.5 text-red-500"
                      aria-label={`Delete version ${v.versionNumber}`}
                      onClick={() => remove.mutate(v.assetId)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Compare versions" wide="xl">
        <div className="grid grid-cols-2 gap-3">
          {compare.map((id) => (
            <figure key={id} className="space-y-1">
              <img
                src={assetUrl(id)}
                alt={`Version ${byId.get(id)?.versionNumber}`}
                className="w-full rounded-lg bg-[var(--panel-2)] object-contain"
              />
              <figcaption className="flex items-center justify-between text-sm">
                <span>v{byId.get(id)?.versionNumber}</span>
                {q.data?.activeAssetId !== id && (
                  <button type="button" className="btn-secondary py-1" onClick={() => activate.mutate(id)}>
                    Activate
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </Modal>
    </div>
  );
}
