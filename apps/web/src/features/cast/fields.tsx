import type { ReactNode } from "react";
import { TagInput } from "../../components/ui.tsx";

/** Labeled text input/textarea bound to one key of a record. */
export function TextRow<T extends Record<string, unknown>>({
  value,
  k,
  label,
  onChange,
  disabled,
  multiline,
  placeholder,
}: {
  value: T;
  k: keyof T & string;
  label: string;
  onChange: (v: T) => void;
  disabled?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const v = String(value[k] ?? "");
  const set = (s: string) => onChange({ ...value, [k]: s });
  const common = {
    value: v,
    disabled,
    placeholder,
    onChange: (e: { target: { value: string } }) => set(e.target.value),
  };
  return multiline ? (
    <label className="block">
      <span className="label">{label}</span>
      <textarea className="input min-h-16" {...common} />
    </label>
  ) : (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" {...common} />
    </label>
  );
}

export function ListRow<T extends Record<string, unknown>>({
  value,
  k,
  label,
  onChange,
  disabled,
}: {
  value: T;
  k: keyof T & string;
  label: string;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <TagInput
        value={(value[k] as string[] | undefined) ?? []}
        disabled={disabled}
        placeholder="Type and press Enter"
        onChange={(list) => onChange({ ...value, [k]: list })}
      />
    </div>
  );
}

export function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-[var(--border)] p-3">
      <legend className="px-1 text-xs font-semibold tracking-wide uppercase muted">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export const VERSION_ACTIONS: Record<string, { status: string; label: string }[]> = {
  draft: [
    { status: "approved", label: "Approve" },
    { status: "superseded", label: "Supersede" },
  ],
  approved: [
    { status: "locked", label: "Lock" },
    { status: "draft", label: "Back to draft" },
    { status: "superseded", label: "Supersede" },
  ],
  locked: [{ status: "superseded", label: "Supersede" }],
  superseded: [],
};
