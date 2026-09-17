import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Inbox, Trash2 } from "lucide-react";
import { useState } from "react";
import { del, get } from "../../api/client.ts";
import type { DevEmailRow } from "../../api/types.ts";
import { ConfirmDialog, EmptyState, ErrorBox, fmt, Spinner, toast } from "../../components/ui.tsx";

export function DevMailboxPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const list = useQuery({
    queryKey: ["dev-mailbox"],
    queryFn: () => get<{ emails: DevEmailRow[] }>("/dev/mailbox"),
    refetchInterval: 5000,
  });
  const email = list.data?.emails.find((e) => e.id === selected) ?? null;
  const links = email ? [...email.textBody.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]) : [];
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Inbox className="size-5" /> Dev mailbox
          </h1>
          <p className="muted text-sm">
            Email delivery is mocked. Messages sent by the app are stored here instead of being delivered.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/login" search={{}} className="btn-secondary">
            Sign in
          </Link>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setConfirmClear(true)}
            disabled={!list.data?.emails.length}
          >
            <Trash2 className="size-4" /> Clear
          </button>
        </div>
      </div>
      {list.isLoading && <Spinner />}
      <ErrorBox error={list.error} title="Mailbox unavailable" />
      {list.data && !list.data.emails.length && <EmptyState title="No emails yet" />}
      {list.data && list.data.emails.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <ul className="card divide-y divide-[var(--border)] overflow-hidden">
            {list.data.emails.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setSelected(e.id)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-[var(--panel-2)] ${selected === e.id ? "bg-[var(--panel-2)]" : ""}`}
                >
                  <div className={`truncate ${e.read ? "" : "font-semibold"}`}>{e.subject}</div>
                  <div className="muted truncate text-xs">
                    {e.to} · {fmt.ago(e.createdAt)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="card min-h-64 p-4">
            {email ? (
              <>
                <h2 className="font-semibold">{email.subject}</h2>
                <div className="muted mb-3 text-xs">
                  To {email.to} · {fmt.date(email.createdAt)}
                </div>
                <pre className="whitespace-pre-wrap break-words text-sm">{email.textBody}</pre>
                {links.map((l) => (
                  <a key={l} href={l} className="btn-primary mt-3">
                    Open link
                  </a>
                ))}
              </>
            ) : (
              <p className="muted text-sm">Select an email.</p>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmClear}
        title="Clear mailbox?"
        danger
        confirmLabel="Clear"
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await del("/dev/mailbox");
            await qc.invalidateQueries({ queryKey: ["dev-mailbox"] });
            setSelected(null);
          } catch (e) {
            toast.error(e);
          }
          setConfirmClear(false);
        }}
      >
        All stored development emails will be deleted.
      </ConfirmDialog>
    </div>
  );
}
