import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { get, post } from "../../api/client.ts";
import { useMe } from "../../api/hooks.ts";
import { ErrorBox, Field, fmt, PageHeader, Spinner, toast } from "../../components/ui.tsx";
import { ProviderKeys } from "../ai/AiPicker.tsx";

type Session = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

export function AccountPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ sessions: Session[] }>("/auth/sessions") });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return setError(new Error("Passwords do not match"));
    setBusy(true);
    setError(null);
    try {
      await post("/auth/password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      toast.success("Password changed. Other sessions were signed out.");
      await sessions.refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <PageHeader title="Account" subtitle={me ? `${me.username} · ${me.email} · ${me.role}` : undefined} />
      <ProviderKeys />
      <form onSubmit={change} className="card space-y-3 p-4">
        <h2 className="font-medium">Change password</h2>
        <Field label="Current password">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            required
          />
        </Field>
        <Field label="New password (min 10)">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            required
          />
        </Field>
        <ErrorBox error={error} />
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner />} Update password
        </button>
      </form>
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Active sessions</h2>
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              try {
                await post("/auth/logout-all");
                qc.clear();
                navigate({ to: "/login", search: {} });
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            Sign out everywhere
          </button>
        </div>
        {sessions.isLoading && <Spinner />}
        <ul className="divide-y divide-[var(--border)] text-sm">
          {sessions.data?.sessions.map((s) => (
            <li key={s.id} className="py-2">
              <div className="flex items-center gap-2">
                <span className="truncate">{s.userAgent ?? "Unknown device"}</span>
                {s.current && <span className="chip bg-accent-600/20">this device</span>}
              </div>
              <div className="muted text-xs">
                IP {s.ip ?? "unknown"} · last used {fmt.ago(s.lastUsedAt)} · expires {fmt.date(s.expiresAt)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
