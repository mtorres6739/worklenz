import { getEmailIdentityForTeam } from "./branding.service";
import { sendEmailEnhanced } from "../shared/email";

const appOrigin = (process.env.APP_ORIGIN || process.env.FRONTEND_URL || "http://localhost:5000").replace(/\/+$/, "");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailShell(title: string, body: string, accent = "#1677ff"): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:600px;margin:32px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <div style="height:6px;background:${accent}"></div>
      <div style="padding:32px"><h1 style="font-size:22px;margin:0 0 20px">${escapeHtml(title)}</h1>${body}</div>
      <div style="padding:18px 32px;background:#f8fafc;color:#64748b;font-size:12px">SDM Client Projects</div>
    </div></body></html>`;
}

export function portalInvitationUrl(rawToken: string): string {
  return `${appOrigin}/portal/invite/${encodeURIComponent(rawToken)}`;
}

export function portalResetUrl(rawToken: string): string {
  return `${appOrigin}/portal/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export async function sendPortalInvitation(input: {
  teamId: string;
  email: string;
  inviteeName: string;
  clientName: string;
  inviterName: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<boolean> {
  const link = portalInvitationUrl(input.rawToken);
  const html = emailShell(
    `You're invited to ${input.clientName}`,
    `<p style="line-height:1.6">Hello ${escapeHtml(input.inviteeName)},</p>
     <p style="line-height:1.6">${escapeHtml(input.inviterName)} invited you to the secure SDM client project portal for ${escapeHtml(input.clientName)}.</p>
     <p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#1677ff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Accept invitation</a></p>
     <p style="color:#64748b;font-size:13px">This private link expires ${escapeHtml(input.expiresAt.toUTCString())}. If you were not expecting it, ignore this message.</p>`,
  );
  const result = await sendEmailEnhanced({
    to: [input.email],
    from: await getEmailIdentityForTeam(input.teamId),
    subject: `Invitation to ${input.clientName} projects`,
    html,
  });
  return result.success;
}

export async function sendPortalPasswordReset(input: {
  teamId: string;
  email: string;
  name: string;
  rawToken: string;
}): Promise<boolean> {
  const link = portalResetUrl(input.rawToken);
  const html = emailShell(
    "Reset your client portal password",
    `<p style="line-height:1.6">Hello ${escapeHtml(input.name)},</p>
     <p style="line-height:1.6">Use the button below to choose a new password. The link expires in one hour.</p>
     <p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#1677ff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Reset password</a></p>
     <p style="color:#64748b;font-size:13px">If you did not request this, no action is required.</p>`,
  );
  const result = await sendEmailEnhanced({
    to: [input.email],
    from: await getEmailIdentityForTeam(input.teamId),
    subject: "Reset your SDM client portal password",
    html,
  });
  return result.success;
}
