import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().default("amburax_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_MAX_RESENDS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
  MFA_CHALLENGE_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(30),
  // Dev-only stand-in: no SMS/WhatsApp/email provider is wired yet (see README).
  // Never true in production — echoing the code back to the client defeats MFA.
  DEV_OTP_ECHO: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  // Silent, per-account throttle: a repeated request inside this window does not
  // create a new token or send a new email, but still returns the same generic
  // success response — the throttle itself must not be observable by an attacker.
  RESET_REQUEST_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  RESET_REQUEST_MAX_PER_WINDOW: z.coerce.number().int().positive().default(5),
  // Deliberately looser than RESET_REQUEST_MAX_PER_WINDOW: legitimate typo/mismatch
  // retries are expected here, and the token itself (256-bit) is not brute-forceable
  // regardless of this limit — this guards against submission-endpoint DoS, not guessing.
  RESET_CONSUME_MAX_PER_WINDOW: z.coerce.number().int().positive().default(10),
  // Dev-only stand-in, same contract as DEV_OTP_ECHO: never true in production.
  DEV_RESET_LINK_ECHO: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  // Registrations are rare compared to logins; a looser window than login/OTP limits
  // is appropriate — this guards against scripted mass tenant creation, not typos.
  TENANT_REGISTRATION_MAX_PER_WINDOW: z.coerce.number().int().positive().default(10),
  // Long-lived by design: a business owner may not finish A5-A10 in one sitting.
  // Unlike a login session, this grants no access to the application — only to
  // continuing this one tenant's setup.
  ONBOARDING_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // Owner setup is a one-time-per-tenant action; this guards the endpoint against
  // scripted abuse, not against a legitimate owner's own retries.
  OWNER_SETUP_MAX_PER_WINDOW: z.coerce.number().int().positive().default(10),
  STORE_SETUP_MAX_PER_WINDOW: z.coerce.number().int().positive().default(10),
  // Staff invitations live longer than OTP/reset links — a week, not minutes, since the
  // invitee may not check email immediately.
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  INVITATION_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  INVITATION_CREATE_MAX_PER_WINDOW: z.coerce.number().int().positive().default(20),
  INVITATION_RESEND_MAX_PER_WINDOW: z.coerce.number().int().positive().default(20),
  TEAM_STEP_MAX_PER_WINDOW: z.coerce.number().int().positive().default(20),
  // Acceptance is a one-time action per invitation and the token is 256-bit (not
  // guessable), so this guards the endpoint against scripted abuse and repeated
  // password/name submissions, not against token brute force.
  INVITATION_ACCEPT_MAX_PER_WINDOW: z.coerce.number().int().positive().default(15),
  // Completion is a one-time-per-tenant action and the endpoint is idempotent; this
  // guards against scripted abuse, not against a legitimate owner refreshing the page.
  ONBOARDING_COMPLETE_MAX_PER_WINDOW: z.coerce.number().int().positive().default(20),
  POS_SETUP_MAX_PER_WINDOW: z.coerce.number().int().positive().default(20),
  POS_STEP_MAX_PER_WINDOW: z.coerce.number().int().positive().default(20),
  // Short by design: a pairing code is read off a setup screen and typed into a terminal
  // standing next to it. Anything longer widens the window in which a code left on screen,
  // photographed, or shoulder-surfed is still usable.
  POS_PAIRING_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  // Tighter than the other limiters: this is the one endpoint where a short-ish secret is
  // submitted repeatedly by an unauthenticated caller, so guessing must be expensive.
  POS_ACTIVATE_MAX_PER_WINDOW: z.coerce.number().int().positive().default(10),
  // Dev-only stand-in, same contract as DEV_OTP_ECHO/DEV_RESET_LINK_ECHO: no email
  // provider is wired yet. Never true in production regardless of the env var value.
  DEV_INVITE_LINK_ECHO: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME,
  SESSION_TTL_HOURS: process.env.SESSION_TTL_HOURS,
  LOGIN_MAX_ATTEMPTS: process.env.LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_MINUTES: process.env.LOGIN_LOCKOUT_MINUTES,
  OTP_LENGTH: process.env.OTP_LENGTH,
  OTP_TTL_MINUTES: process.env.OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS: process.env.OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS: process.env.OTP_MAX_RESENDS,
  OTP_RESEND_COOLDOWN_SECONDS: process.env.OTP_RESEND_COOLDOWN_SECONDS,
  MFA_CHALLENGE_MAX_AGE_MINUTES: process.env.MFA_CHALLENGE_MAX_AGE_MINUTES,
  DEV_OTP_ECHO: process.env.NODE_ENV === "production" ? "false" : process.env.DEV_OTP_ECHO,
  APP_BASE_URL: process.env.APP_BASE_URL,
  RESET_TOKEN_TTL_MINUTES: process.env.RESET_TOKEN_TTL_MINUTES,
  RESET_REQUEST_COOLDOWN_SECONDS: process.env.RESET_REQUEST_COOLDOWN_SECONDS,
  RESET_REQUEST_MAX_PER_WINDOW: process.env.RESET_REQUEST_MAX_PER_WINDOW,
  RESET_CONSUME_MAX_PER_WINDOW: process.env.RESET_CONSUME_MAX_PER_WINDOW,
  DEV_RESET_LINK_ECHO: process.env.NODE_ENV === "production" ? "false" : process.env.DEV_RESET_LINK_ECHO,
  TENANT_REGISTRATION_MAX_PER_WINDOW: process.env.TENANT_REGISTRATION_MAX_PER_WINDOW,
  ONBOARDING_SESSION_TTL_MINUTES: process.env.ONBOARDING_SESSION_TTL_MINUTES,
  OWNER_SETUP_MAX_PER_WINDOW: process.env.OWNER_SETUP_MAX_PER_WINDOW,
  STORE_SETUP_MAX_PER_WINDOW: process.env.STORE_SETUP_MAX_PER_WINDOW,
  INVITATION_TTL_HOURS: process.env.INVITATION_TTL_HOURS,
  INVITATION_RESEND_COOLDOWN_SECONDS: process.env.INVITATION_RESEND_COOLDOWN_SECONDS,
  INVITATION_CREATE_MAX_PER_WINDOW: process.env.INVITATION_CREATE_MAX_PER_WINDOW,
  INVITATION_RESEND_MAX_PER_WINDOW: process.env.INVITATION_RESEND_MAX_PER_WINDOW,
  TEAM_STEP_MAX_PER_WINDOW: process.env.TEAM_STEP_MAX_PER_WINDOW,
  INVITATION_ACCEPT_MAX_PER_WINDOW: process.env.INVITATION_ACCEPT_MAX_PER_WINDOW,
  ONBOARDING_COMPLETE_MAX_PER_WINDOW: process.env.ONBOARDING_COMPLETE_MAX_PER_WINDOW,
  POS_SETUP_MAX_PER_WINDOW: process.env.POS_SETUP_MAX_PER_WINDOW,
  POS_STEP_MAX_PER_WINDOW: process.env.POS_STEP_MAX_PER_WINDOW,
  POS_PAIRING_TTL_MINUTES: process.env.POS_PAIRING_TTL_MINUTES,
  POS_ACTIVATE_MAX_PER_WINDOW: process.env.POS_ACTIVATE_MAX_PER_WINDOW,
  DEV_INVITE_LINK_ECHO: process.env.NODE_ENV === "production" ? "false" : process.env.DEV_INVITE_LINK_ECHO,
});
