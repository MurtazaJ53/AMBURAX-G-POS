/**
 * Every outbound identity message (OTP codes, password reset links) goes through this
 * one interface instead of a vendor SDK call inline in each auth flow: no SMS/WhatsApp/
 * email provider is wired yet (Notifications is Phase-1-scoped per MICROSERVICES.md but
 * wasn't in A2 or A3's own scope to build). The console adapter below is a disclosed dev
 * stand-in — swap it for a real Twilio/MSG91/SES adapter behind this same interface,
 * nothing in the calling code (mfaChallenge.ts, passwordReset.ts) changes.
 */
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
 * The stand-in prints the OTP code and the reset/invite URL so a developer can complete a
 * flow locally without an email or SMS provider. Those values are live credentials: an OTP
 * is an authentication factor, and a reset or invite URL is a bearer token in a link.
 *
 * Found while closing P0-2: this printing was NOT gated by environment, so deploying the
 * console adapter to production would have written working credentials to stdout on every
 * send. It is now hard-gated the same way DEV_OTP_ECHO/DEV_RESET_LINK_ECHO are (see
 * lib/env.ts) — plaintext in development only, redacted everywhere else, decided here
 * rather than trusted to deployment configuration.
 */
const SHOW_PLAINTEXT = process.env.NODE_ENV !== "production";

function devOnly(value: string): string {
  return SHOW_PLAINTEXT ? value : "[redacted]";
}

class ConsoleIdentityNotifier implements IdentityNotifier {
  async sendOtp(params: { destination: string; channel: string; code: string }): Promise<void> {
    // Dev-only stand-in delivery. Never reaches a real inbox/phone.
    console.log(
      `[identity-notifier:DEV] would send ${params.channel} OTP ${devOnly(params.code)} to ${devOnly(params.destination)}`,
    );
  }

  async sendPasswordResetLink(params: { destination: string; resetUrl: string }): Promise<void> {
    // Dev-only stand-in delivery. Never reaches a real inbox.
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
    // Dev-only stand-in delivery. Never reaches a real inbox.
    console.log(
      `[identity-notifier:DEV] would invite ${devOnly(params.destination)} to join ${params.tenantName} / ${params.storeName} as ${params.role}: ${devOnly(params.inviteUrl)}`,
    );
  }
}

export const identityNotifier: IdentityNotifier = new ConsoleIdentityNotifier();
