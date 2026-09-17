import { useQuery } from "@tanstack/react-query";
import { get } from "../../api/client.ts";
import { qk } from "../../api/hooks.ts";
import type { UsageSummary } from "../../api/types.ts";
import { ErrorBox, PageHeader, Spinner } from "../../components/ui.tsx";
import { useProjectId } from "../project/ProjectLayout.tsx";
import { UsageDashboard } from "./UsageDashboard.tsx";

function UsageView({
  title,
  subtitle,
  queryKey,
  path,
}: {
  title: string;
  subtitle: string;
  queryKey: readonly unknown[];
  path: string;
}) {
  const q = useQuery({ queryKey, queryFn: () => get<UsageSummary>(path) });
  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageHeader title={title} subtitle={subtitle} />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading ? <Spinner /> : q.data && <UsageDashboard data={q.data} />}
    </div>
  );
}

export function UsagePage() {
  return (
    <UsageView
      title="API usage & cost"
      subtitle="Across all your projects. Estimates use recorded provider token usage and rate snapshots."
      queryKey={["usage", "me"]}
      path="/usage"
    />
  );
}

export function ProjectUsagePage() {
  const projectId = useProjectId();
  return (
    <UsageView
      title="Project cost"
      subtitle="Recorded provider usage for this project."
      queryKey={qk.usage(projectId)}
      path={`/projects/${projectId}/usage`}
    />
  );
}
