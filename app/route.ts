import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "CONSENT=YES+1",
};

interface Segment {
  start: number;
  text: string;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
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

  try {
    const tracks = await getCaptionTracks(videoId);
    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ available: false, reason: "no_captions" });
    }

    const track = pickTrack(tracks);
    const segments = await fetchSegments(track.baseUrl);
    if (segments.length === 0) {
      return NextResponse.json({ available: false, reason: "no_captions" });
    }

    return NextResponse.json({
      available: true,
      language:
        track.name?.simpleText ||
        track.name?.runs?.map((r) => r.text).join("") ||
        track.languageCode ||
        "",
      segments,
    });
  } catch {
    return NextResponse.json(
      { available: false, reason: "fetch_failed" },
      { status: 502 },
    );
  }
}

async function getCaptionTracks(
  videoId: string,
): Promise<CaptionTrack[] | null> {
  const res = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&hl=en`,
    { headers: BROWSER_HEADERS },
  );
  const html = await res.text();

  const marker = '"captionTracks":';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const arrText = extractJsonArray(html, markerIdx + marker.length);
  if (!arrText) return null;

  try {
    return JSON.parse(arrText) as CaptionTrack[];
  } catch {
    return null;
  }
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  const byLang = (lang: string) =>
    tracks.find((t) => t.languageCode?.startsWith(lang));
  return (
    byLang("ko") ||
    byLang("en") ||
    tracks.find((t) => t.kind !== "asr") ||
    tracks[0]
  );
}

async function fetchSegments(baseUrl: string): Promise<Segment[]> {
  const url = baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}&fmt=json3`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  const data = (await res.json()) as {
    events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
  };

  const segments: Segment[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    segments.push({ start: (ev.tStartMs ?? 0) / 1000, text });
  }
  return segments;
}

// Scans from `fromIndex`, returns the first balanced [ ... ] substring.
function extractJsonArray(html: string, fromIndex: number): string | null {
  const start = html.indexOf("[", fromIndex);
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}
