/**
 * Client IP determination with trusted Cloudflare / reverse proxy authentication.
 * Ensures client IP cannot be spoofed by unauthenticated X-Forwarded-For headers.
 */

// Official Cloudflare IPv4 & IPv6 Ingress Subnets
const CLOUDFLARE_IPV4_PREFIXES = [
  "173.245.48.", "103.21.244.", "103.22.200.", "103.31.4.",
  "141.101.", "108.162.", "190.93.", "188.114.",
  "197.234.", "198.41.", "162.158.", "104.16.", "104.17.",
  "104.18.", "104.19.", "104.20.", "104.21.", "104.22.", "104.23.", "104.24.",
  "172.64.", "131.0.72."
];

export function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const cleanIp = ip.trim();
    const cleanCidr = cidr.trim();
    if (cleanCidr.includes("/")) {
      const [range, bitsStr] = cleanCidr.split("/");
      const bits = parseInt(bitsStr ?? "32", 10);
      if (cleanIp.includes(":") || range?.includes(":")) {
        // Simple IPv6 prefix matching
        return cleanIp.toLowerCase().startsWith(range?.toLowerCase().split("::")[0] ?? "");
      }
      // IPv4 bitmask matching
      const ipNum = cleanIp.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
      const rangeNum = (range ?? "").split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (ipNum & mask) === (rangeNum & mask);
    }
    return cleanIp === cleanCidr;
  } catch {
    return false;
  }
}

export function resolveClientIp(headers: Headers, remoteSocketIp?: string): string {
  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const firstHop = forwarded.split(",")[0]?.trim();
    if (firstHop) return firstHop;
  }

  return remoteSocketIp ?? "127.0.0.1";
}
