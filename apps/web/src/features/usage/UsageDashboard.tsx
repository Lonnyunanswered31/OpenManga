import type { UsageSummary } from "../../api/types.ts";
import { fmt } from "../../components/ui.tsx";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#3b6cf6",
  deepseek: "#10b981",
  mock: "#f59e0b",
  kokoro: "#8b5cf6",
};
const color = (p: string) => PROVIDER_COLORS[p] ?? "#94a3b8";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="muted text-xs">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="muted text-xs">{hint}</div>}
    </div>
  );
}

function DailyChart({ daily }: { daily: UsageSummary["daily"] }) {
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
  const byDay = new Map<string, { provider: string; cost: number }[]>();
  for (const d of daily) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d]);
  const max = Math.max(0.0001, ...days.map((d) => (byDay.get(d) ?? []).reduce((s, x) => s + x.cost, 0)));
  const providers = [...new Set(daily.map((d) => d.provider))];
  return (
    <div>
      <div className="flex h-40 items-end gap-0.5" role="img" aria-label="Daily API cost for the last 30 days">
        {days.map((day) => {
          const parts = byDay.get(day) ?? [];
          const total = parts.reduce((s, x) => s + x.cost, 0);
          return (
            <div key={day} className="flex h-full flex-1 flex-col justify-end" title={`${day}: ${fmt.usd(total)}`}>
              {parts.map((p) => (
                <div
                  key={p.provider}
                  style={{ height: `${(p.cost / max) * 100}%`, background: color(p.provider) }}
                  className="w-full first:rounded-t-sm"
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="muted mt-2 flex flex-wrap gap-3 text-xs">
        {providers.map((p) => (
          <span key={p} className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: color(p) }} /> {p}
          </span>
        ))}
        {!providers.length && <span>No spend in the last 30 days</span>}
      </div>
    </div>
  );
}

const th = "p-2 text-left font-normal";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  elevenlabs: "ElevenLabs",
  mock: "Mock",
};

export function UsageDashboard({ data }: { data: UsageSummary }) {
  const w = data.windows;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={fmt.usd(w.today?.costUsd)} hint={`${w.today?.calls ?? 0} calls`} />
        <Stat label="Last 7 days" value={fmt.usd(w["7d"]?.costUsd)} hint={`${w["7d"]?.calls ?? 0} calls`} />
        <Stat label="Last 30 days" value={fmt.usd(w["30d"]?.costUsd)} hint={`${w["30d"]?.calls ?? 0} calls`} />
        <Stat label="Lifetime" value={fmt.usd(w.lifetime?.costUsd)} hint={`${w.lifetime?.calls ?? 0} calls`} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Images" value={fmt.usd(data.breakdown.imagesUsd)} hint="image models" />
        <Stat label="Text" value={fmt.usd(data.breakdown.textUsd)} hint="planning, prompts, narration" />
        <Stat label="Narration (local TTS)" value="$0.00" hint="No external API cost" />
        <Stat
          label="Providers"
          value={String(Object.keys(data.breakdown.byProvider).length)}
          hint={Object.keys(data.breakdown.byProvider).join(", ") || "none yet"}
        />
      </div>
      {Object.keys(data.breakdown.byProvider).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(data.breakdown.byProvider)
            .sort((a, b) => b[1] - a[1])
            .map(([provider, cost]) => (
              <Stat key={provider} label={PROVIDER_LABELS[provider] ?? provider} value={fmt.usd(cost)} />
            ))}
        </div>
      )}
      {data.breakdown.mockUsd > 0 && (
        <p className="muted text-xs">Mock provider cost: {fmt.usd(data.breakdown.mockUsd)}</p>
      )}
      {data.unpricedCalls > 0 && (
        <p className="rounded-md bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-300">
          {data.unpricedCalls} call{data.unpricedCalls === 1 ? "" : "s"} could not be priced (no rate snapshot for that
          model), so spend is understated. An administrator can add rates under Admin → Rates.
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-medium">Daily cost (30 days)</h2>
        <DailyChart daily={data.daily} />
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-medium">By operation</h2>
        <table className="w-full text-sm">
          <thead className="muted text-xs">
            <tr className="border-b border-[var(--border)]">
              <th className={th}>Operation</th>
              <th className={th}>Calls</th>
              <th className={th}>Cost</th>
              <th className={th}>Avg latency</th>
              <th className={th}>Failures</th>
            </tr>
          </thead>
          <tbody>
            {data.operations.map((o) => (
              <tr key={o.operation} className="border-b border-[var(--border)] last:border-0">
                <td className="p-2">{o.label}</td>
                <td className="p-2">{fmt.num(o.calls)}</td>
                <td className="p-2">{fmt.usd(o.cost)}</td>
                <td className="p-2">{fmt.ms(o.avg_latency)}</td>
                <td className="p-2">{o.failures}</td>
              </tr>
            ))}
            {!data.operations.length && (
              <tr>
                <td className="muted p-2" colSpan={5}>
                  No usage yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-2 font-medium">By provider</h2>
        <table className="w-full text-sm">
          <thead className="muted text-xs">
            <tr className="border-b border-[var(--border)]">
              <th className={th}>Provider</th>
              <th className={th}>Model</th>
              <th className={th}>Calls</th>
              <th className={th}>Text in</th>
              <th className={th}>Text out</th>
              <th className={th}>Cached</th>
              <th className={th}>Image in</th>
              <th className={th}>Image out</th>
              <th className={th}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={`${p.provider}-${p.model}`} className="border-b border-[var(--border)] last:border-0">
                <td className="p-2">{p.provider}</td>
                <td className="p-2">{p.model}</td>
                <td className="p-2">{fmt.num(p.calls)}</td>
                <td className="p-2">{fmt.num(p.text_in)}</td>
                <td className="p-2">{fmt.num(p.text_out)}</td>
                <td className="p-2">{fmt.num(p.cached)}</td>
                <td className="p-2">{fmt.num(p.image_in)}</td>
                <td className="p-2">{fmt.num(p.image_out)}</td>
                <td className="p-2">{fmt.usd(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto p-4">
          <h2 className="font-medium">Reference size experiments</h2>
          <p className="muted mb-2 text-xs">
            Panel generations grouped by the prompt-reference derivative box. Compare image-input tokens, cost and
            latency against consistency before changing OPENAI_REFERENCE_MAX_WIDTH/HEIGHT.
          </p>
          <table className="w-full text-sm">
            <thead className="muted text-xs">
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Ref size</th>
                <th className={th}>Generations</th>
                <th className={th}>Avg image in</th>
                <th className={th}>Avg cost</th>
                <th className={th}>Avg latency</th>
              </tr>
            </thead>
            <tbody>
              {data.referenceExperiments.map((r) => (
                <tr key={r.ref_size} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-2 font-mono">{r.ref_size}</td>
                  <td className="p-2">{r.generations}</td>
                  <td className="p-2">{Math.round(r.avg_image_input_tokens)}</td>
                  <td className="p-2">{fmt.usd(r.avg_cost)}</td>
                  <td className="p-2">{fmt.ms(r.avg_latency)}</td>
                </tr>
              ))}
              {!data.referenceExperiments.length && (
                <tr>
                  <td className="muted p-2" colSpan={5}>
                    No referenced panel generations yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-medium">Quality signals</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-semibold">{data.quality.generatedPanels}</div>
              <div className="muted text-xs">Generated panels</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{Math.round(data.quality.regenerationRate * 100)}%</div>
              <div className="muted text-xs">Regeneration rate</div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{Math.round(data.quality.acceptanceRate * 100)}%</div>
              <div className="muted text-xs">Acceptance rate</div>
            </div>
          </div>
          <p className="muted mt-3 text-xs">Acceptance = generated panels marked approved or locked.</p>
        </section>
      </div>
    </div>
  );
}
