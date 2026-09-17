export type MemberRole = "owner" | "editor" | "viewer";
export type ProjectAction = "read" | "write" | "generate" | "delete" | "manage";

const allowed: Record<MemberRole, ProjectAction[]> = {
  owner: ["read", "write", "generate", "delete", "manage"],
  editor: ["read", "write", "generate"],
  viewer: ["read"],
};

export function canPerform(
  actor: { id: string; role: "user" | "admin"; status: "active" | "disabled" },
  membership: MemberRole | null,
  action: ProjectAction,
): boolean {
  if (actor.status !== "active") return false;
  if (actor.role === "admin" && (action === "read" || action === "manage")) return true;
  if (!membership) return false;
  return allowed[membership].includes(action);
}

export type ApprovalStatus = "draft" | "approved" | "locked" | "superseded";

const transitions: Record<ApprovalStatus, ApprovalStatus[]> = {
  draft: ["approved", "superseded"],
  approved: ["draft", "locked", "superseded"],
  locked: ["superseded"],
  superseded: [],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus) {
  return from === to || transitions[from].includes(to);
}

/** Locked/superseded versions are immutable: edits must create a new version. */
export const isImmutable = (s: ApprovalStatus) => s === "locked" || s === "superseded";

export const PRIORITY = { interactive: 1, single: 2, page: 5, chapter: 8, maintenance: 10 } as const;

export class RetryableError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
