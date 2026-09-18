import { getPublicLaunches } from "@/lib/server/public-launches";

export async function GET() {
  try {
    const launches = await getPublicLaunches();
    return Response.json({ launches }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("public_launches_get_failed", error);
    return Response.json({ launches: [], unavailable: true }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
