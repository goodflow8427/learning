import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

interface Segment {
  start: number;
  text: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v");

  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json(
      { available: false, reason: "invalid_id" },
      { status: 400 },
    );
  }

  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) {
    // The env var isn't set on the server.
    return NextResponse.json(
      { available: false, reason: "fetch_failed" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}`,
      { headers: { "x-api-key": apiKey } },
    );

    if (!res.ok) {
      // 404 / not-available → treat as "no captions"; other errors → failure.
      return NextResponse.json({
        available: false,
        reason: res.status === 404 || res.status === 206 ? "no_captions" : "fetch_failed",
      });
    }

    const data = (await res.json()) as {
      lang?: string;
      content?: { text?: string; offset?: number; start?: number }[];
    };

    const content = Array.isArray(data.content) ? data.content : [];
    const segments: Segment[] = content
      .map((c) => ({
        start: toSeconds(c.offset ?? c.start ?? 0),
        text: String(c.text ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      }))
      .filter((s) => s.text);

    if (segments.length === 0) {
      return NextResponse.json({ available: false, reason: "no_captions" });
    }

    return NextResponse.json({
      available: true,
      language: data.lang ?? "",
      segments,
    });
  } catch {
    return NextResponse.json(
      { available: false, reason: "fetch_failed" },
      { status: 502 },
    );
  }
}

// Supadata returns offsets in milliseconds.
function toSeconds(value: number): number {
  return value / 1000;
}
