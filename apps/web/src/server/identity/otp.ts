import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";

const SALT_ROUNDS = 10; // OTPs are short-lived and low-entropy vs passwords; 10 keeps verify latency low.

export function generateOtpCode(): string {
  const max = 10 ** env.OTP_LENGTH;
  const value = randomInt(0, max);
  return value.toString().padStart(env.OTP_LENGTH, "0");
}

export function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, SALT_ROUNDS);
}

export function verifyOtpCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
