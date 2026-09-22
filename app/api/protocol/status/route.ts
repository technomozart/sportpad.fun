import { getExecutionStatus } from "@/lib/server/execution-status";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getExecutionStatus();
    return Response.json(status, {
      headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=20" },
    });
  } catch (error) {
    console.error("protocol_status_failed", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { error: "Protocol status is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
