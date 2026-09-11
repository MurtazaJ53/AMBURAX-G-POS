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

class ConsoleIdentityNotifier implements IdentityNotifier {
  async sendOtp(params: { destination: string; channel: string; code: string }): Promise<void> {
    // Dev-only stand-in delivery. Never reaches a real inbox/phone.
    console.log(`[identity-notifier:DEV] would send ${params.channel} OTP ${params.code} to ${params.destination}`);
  }

  async sendPasswordResetLink(params: { destination: string; resetUrl: string }): Promise<void> {
    // Dev-only stand-in delivery. Never reaches a real inbox.
    console.log(`[identity-notifier:DEV] would email password reset link to ${params.destination}: ${params.resetUrl}`);
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
      `[identity-notifier:DEV] would invite ${params.destination} to join ${params.tenantName} / ${params.storeName} as ${params.role}: ${params.inviteUrl}`,
    );
  }
}

export const identityNotifier: IdentityNotifier = new ConsoleIdentityNotifier();
