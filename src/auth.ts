import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Config } from "./config";

function isLoopback(ip: string) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export function createAdminAuth(config: Config) {
  const tokenHash = createHash("sha256").update(config.adminToken).digest();
  return (req: Request, peer: string): boolean => {
    const auth = req.headers.get("authorization") ?? "";
    const provided = createHash("sha256").update(auth.startsWith("Bearer ") ? auth.slice(7) : "").digest();
    if (timingSafeEqual(provided, tokenHash)) return true;

    // OSG routing.md: HMAC-SHA256(uid), lowercase hex. Only trust the local gateway.
    if (!config.wsAuthUidSecret || !isLoopback(peer)) return false;
    const uid = req.headers.get("x-ws-uid");
    const signature = req.headers.get("x-ws-uid-sig");
    if (!uid || uid.length > 256 || /[\s,\x00-\x1f\x7f]/.test(uid) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
    const expected = createHmac("sha256", config.wsAuthUidSecret).update(uid, "utf8").digest();
    return timingSafeEqual(expected, Buffer.from(signature, "hex"));
  };
}
