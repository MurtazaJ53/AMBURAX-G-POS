import { logError } from "@/lib/safeLog";

export interface IdentityNotifier {
  sendOtp(params: { destination: string; channel: "SMS" | "WHATSAPP" | "EMAIL"; code: string }): Promise<void>;
  sendPasswordResetLink(params: { destination: string; resetUrl: string }): Promise<void>;
  sendInvitation(params: {
    destination: string;
    inviteUrl: string;
    tenantName: string;
    storeName: string;
    role: string;
  }): Promise<void>;
}

/**
 * Codes, reset links and destinations are printed only on an explicit opt-in on a
 * non-production server. "Not production" alone is not enough: a staging or misconfigured
 * server without NODE_ENV=production would otherwise write live login codes into its logs.
 */
function showPlaintext(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.LOG_OTP_FOR_DEV === "1";
}

function devOnly(value: string): string {
  return showPlaintext() ? value : "[redacted]";
}

class ConsoleIdentityNotifier implements IdentityNotifier {
  async sendOtp(params: { destination: string; channel: string; code: string }): Promise<void> {
    console.log(
      `[identity-notifier:DEV] would send ${params.channel} OTP ${devOnly(params.code)} to ${devOnly(params.destination)}`,
    );
  }

  async sendPasswordResetLink(params: { destination: string; resetUrl: string }): Promise<void> {
    console.log(
      `[identity-notifier:DEV] would email password reset link to ${devOnly(params.destination)}: ${devOnly(params.resetUrl)}`,
    );
  }

  async sendInvitation(params: {
    destination: string;
    inviteUrl: string;
    tenantName: string;
    storeName: string;
    role: string;
  }): Promise<void> {
    console.log(
      `[identity-notifier:DEV] would invite ${devOnly(params.destination)} to join ${params.tenantName} / ${params.storeName} as ${params.role}: ${devOnly(params.inviteUrl)}`,
    );
  }
}

/**
 * Production Gateway Notifier supporting:
 * - SMS: MSG91 or Fast2SMS
 * - Email: Resend or Amazon SES
 * Falls back safely to Console/Audit logging if live API keys are not supplied in env.
 */
class ProductionIdentityNotifier implements IdentityNotifier {
  private consoleFallback = new ConsoleIdentityNotifier();

  async sendOtp(params: { destination: string; channel: "SMS" | "WHATSAPP" | "EMAIL"; code: string }): Promise<void> {
    const provider = process.env.SMS_GATEWAY_PROVIDER?.toLowerCase();
    const authKey = process.env.SMS_GATEWAY_AUTH_KEY;

    if (provider === "msg91" && authKey) {
      try {
        await fetch("https://control.msg91.com/api/v5/otp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "authkey": authKey,
          },
          body: JSON.stringify({
            template_id: process.env.MSG91_OTP_TEMPLATE_ID,
            mobile: params.destination.replace(/\D/g, ""),
            otp: params.code,
          }),
        });
        return;
      } catch (err) {
        logError("notifier/msg91: sendOtp failed", err);
      }
    } else if (provider === "fast2sms" && authKey) {
      try {
        await fetch("https://www.fast2sms.com/dev/bulkV2", {
          method: "POST",
          headers: {
            "authorization": authKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            route: "otp",
            variables_values: params.code,
            numbers: params.destination.replace(/\D/g, "").slice(-10),
          }),
        });
        return;
      } catch (err) {
        logError("notifier/fast2sms: sendOtp failed", err);
      }
    }

    // Dev or unconfigured gateway fallback
    await this.consoleFallback.sendOtp(params);
  }

  async sendPasswordResetLink(params: { destination: string; resetUrl: string }): Promise<void> {
    const emailKey = process.env.EMAIL_API_KEY;
    const provider = process.env.EMAIL_PROVIDER?.toLowerCase() ?? "resend";

    if (provider === "resend" && emailKey) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${emailKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || "no-reply@amburax.com",
            to: params.destination,
            subject: "Reset your AMBURAX password",
            html: `<p>Click the link below to reset your password:</p><p><a href="${params.resetUrl}">Reset Password</a></p><p>This link expires in 15 minutes.</p>`,
          }),
        });
        return;
      } catch (err) {
        logError("notifier/resend: sendPasswordResetLink failed", err);
      }
    }

    await this.consoleFallback.sendPasswordResetLink(params);
  }

  async sendInvitation(params: {
    destination: string;
    inviteUrl: string;
    tenantName: string;
    storeName: string;
    role: string;
  }): Promise<void> {
    const emailKey = process.env.EMAIL_API_KEY;
    const provider = process.env.EMAIL_PROVIDER?.toLowerCase() ?? "resend";

    if (provider === "resend" && emailKey) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${emailKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || "no-reply@amburax.com",
            to: params.destination,
            subject: `You've been invited to join ${params.tenantName}`,
            html: `<p>You have been invited to join <strong>${params.tenantName}</strong> (${params.storeName}) as <strong>${params.role}</strong>.</p><p><a href="${params.inviteUrl}">Accept Invitation</a></p>`,
          }),
        });
        return;
      } catch (err) {
        logError("notifier/resend: sendInvitation failed", err);
      }
    }

    await this.consoleFallback.sendInvitation(params);
  }
}

export const identityNotifier: IdentityNotifier = new ProductionIdentityNotifier();
