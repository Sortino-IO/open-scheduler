import { newId, updateStore, type QueuedEmail } from "./store";

export function emailIsDryRun(): boolean {
  if (process.env.EMAIL_DRY_RUN === "true") return true;
  return !process.env.RESEND_API_KEY;
}

export function notifyEmail(): string {
  return process.env.NOTIFY_EMAIL?.trim() || "";
}

export function fromAddress(): string {
  const value = process.env.EMAIL_FROM?.trim();
  if (value) return value;
  if (emailIsDryRun()) return "Scheduler <scheduler@localhost>";
  throw new Error("EMAIL_FROM must be set to send email.");
}

export async function deliverEmail(message: {
  kind: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ dryRun: boolean }> {
  const dryRun = emailIsDryRun();
  let status: QueuedEmail["status"] = dryRun ? "queued" : "sent";
  let error: string | undefined;

  if (!dryRun) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!response.ok) {
      status = "failed";
      error = (await response.text()).slice(0, 500);
    }
  }

  await updateStore((data) => {
    data.emails.push({
      id: newId(),
      kind: message.kind,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      createdAt: new Date().toISOString(),
      status,
      error,
    });
  });

  if (status === "failed") throw new Error(error || "Email failed");
  return { dryRun };
}
