import { type Database, devEmails } from "@openmanga/db";
import type { Logger } from "@openmanga/logger";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
};

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

/** Development mail: stores in dev_emails (viewable in the dev mailbox UI) and logs a safe summary. */
export class DevMailProvider implements MailProvider {
  constructor(
    private readonly db: Database,
    private readonly logger?: Logger,
  ) {}

  async send(m: MailMessage) {
    const [row] = await this.db
      .insert(devEmails)
      .values({ to: m.to, subject: m.subject, textBody: m.text, htmlBody: m.html ?? null, metadata: m.metadata ?? {} })
      .returning({ id: devEmails.id });
    const [user, domain] = m.to.split("@");
    this.logger?.info("dev email stored", {
      devEmailId: row?.id,
      to: `${(user ?? "").slice(0, 2)}***@${domain ?? ""}`,
      subject: m.subject,
    });
  }
}
