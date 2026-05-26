import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

const TIMEDTEXT_HEADERS = {
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

    const ordered = orderTracks(tracks);
    for (const track of ordered) {
      const segments = await fetchSegments(track.baseUrl);
      if (segments.length > 0) {
        return NextResponse.json({
          available: true,
          language:
            track.name?.simpleText ||
            track.name?.runs?.map((r) => r.text).join("") ||
            track.languageCode ||
            "",
          segments,
        });
      }
    }

    // Tracks exist but every transcript came back empty (YouTube blocked it).
    return NextResponse.json({ available: false, reason: "fetch_failed" });
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
  return (
    (await tracksFromInnertube(videoId, "ANDROID", ANDROID_KEY)) ||
    (await tracksFromInnertube(videoId, "WEB", WEB_KEY)) ||
    (await tracksFromWatchPage(videoId))
  );
}

async function tracksFromInnertube(
  videoId: string,
  clientName: "ANDROID" | "WEB",
  key: string,
): Promise<CaptionTrack[] | null> {
  try {
    const client =
      clientName === "ANDROID"
        ? {
            clientName: "ANDROID",
            clientVersion: "19.09.37",
            androidSdkVersion: 30,
            hl: "en",
            gl: "US",
          }
        : { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" };

    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${key}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            clientName === "ANDROID"
              ? "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip"
              : TIMEDTEXT_HEADERS["User-Agent"],
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: JSON.stringify({ context: { client }, videoId }),
      },
    );
    const data = (await res.json()) as {
      captions?: {
        playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
      };
    };
    const tracks =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return tracks && tracks.length > 0 ? tracks : null;
  } catch {
    return null;
  }
}

async function tracksFromWatchPage(
  videoId: string,
): Promise<CaptionTrack[] | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${videoId}&hl=en`,
      { headers: TIMEDTEXT_HEADERS },
    );
    const html = await res.text();
    const marker = '"captionTracks":';
    const markerIdx = html.indexOf(marker);
    if (markerIdx === -1) return null;

    const arrText = extractJsonArray(html, markerIdx + marker.length);
    if (!arrText) return null;
    const tracks = JSON.parse(arrText) as CaptionTrack[];
    return tracks.length > 0 ? tracks : null;
  } catch {
    return null;
  }
}

// Korean first, then English, then manual (non-auto) tracks, then the rest.
function orderTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const score = (t: CaptionTrack) => {
    let s = 0;
    if (t.languageCode?.startsWith("ko")) s += 100;
    else if (t.languageCode?.startsWith("en")) s += 50;
    if (t.kind !== "asr") s += 10;
    return s;
  };
  return [...tracks].sort((a, b) => score(b) - score(a));
}

async function fetchSegments(baseUrl: string): Promise<Segment[]> {
  // Try the structured json3 format first.
  try {
    const res = await fetch(setParam(baseUrl, "fmt", "json3"), {
      headers: TIMEDTEXT_HEADERS,
    });
    const data = (await res.json()) as {
      events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
    };
    const segs = parseJson3(data);
    if (segs.length > 0) return segs;
  } catch {
    // fall through to XML
  }

  // Fall back to the default XML format.
  try {
    const res = await fetch(stripParam(baseUrl, "fmt"), {
      headers: TIMEDTEXT_HEADERS,
    });
    const xml = await res.text();
    return parseXml(xml);
  } catch {
    return [];
  }
}

function parseJson3(data: {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
}): Segment[] {
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

function parseXml(xml: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const text = decodeHtml(m[2]).replace(/\s+/g, " ").trim();
    if (text) segments.push({ start: parseFloat(m[1]), text });
  }
  return segments;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function setParam(url: string, key: string, value: string): string {
  const stripped = stripParam(url, key);
  return `${stripped}${stripped.includes("?") ? "&" : "?"}${key}=${value}`;
}

function stripParam(url: string, key: string): string {
  return url
    .replace(new RegExp(`([?&])${key}=[^&]*`), "$1")
    .replace(/[?&]$/, "")
    .replace(/&&/g, "&");
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
