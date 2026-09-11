import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

// Fixed cost-12 hash of an arbitrary string, used only to burn the same bcrypt.compare
// cost on a "no such user" path as a real password check would take — otherwise that
// branch returns fast and the response-time difference becomes an enumeration oracle
// even though the response body is identical. See loginService.ts's `!user` branch.
export const TIMING_SAFETY_DUMMY_HASH = "$2a$12$Z9209qciyWM0NaIiT7XBOejnqBf2ISr0pETvFg0aiDxGxzfvfEzNi";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
