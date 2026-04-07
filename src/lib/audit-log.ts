import { createServiceClient } from "@/lib/supabase/service";
import { headers } from "next/headers";

interface AuditLogParams {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a security-relevant event. Fire-and-forget — never blocks the request.
 * Uses service client since the table has no client-accessible RLS policies.
 */
export async function logSecurityEvent(params: AuditLogParams): Promise<void> {
  try {
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()
            || hdrs.get("x-real-ip")
            || "unknown";
    const userAgent = hdrs.get("user-agent") || "unknown";

    const svc = createServiceClient() as any;
    await svc.from("security_audit_logs").insert({
      user_id:       params.userId || null,
      user_email:    params.userEmail || null,
      action:        params.action,
      resource_type: params.resourceType || null,
      resource_id:   params.resourceId || null,
      ip_address:    ip,
      user_agent:    userAgent,
      metadata:      params.metadata || {},
    });
  } catch (err) {
    // Never let audit logging break the actual operation
    console.error("[audit-log] Failed to write audit log:", err instanceof Error ? err.message : "unknown");
  }
}
