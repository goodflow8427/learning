"use client";

import { useState } from "react";
import styles from "./page.module.css";

function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare 11-char video id
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    // /embed/ID or /shorts/ID or /live/ID
    const match = url.pathname.match(
      /^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/,
    );
    if (match) return match[1];
  }

  return null;
}

function formatTime(sec: number): string {
  const total = Math.floor(sec);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface Segment {
  start: number;
  text: string;
}

type TranscriptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; segments: Segment[]; language: string }
  | { status: "empty" }
  | { status: "error" };

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptState>({
    status: "idle",
  });
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  async function fetchTranscript(id: string) {
    setTranscript({ status: "loading" });
    try {
      const res = await fetch(`/api/transcript?v=${id}`);
      const data = await res.json();
      if (data.available && Array.isArray(data.segments)) {
        setTranscript({
          status: "ready",
          segments: data.segments,
          language: data.language ?? "",
        });
      } else if (data.reason === "fetch_failed") {
        setTranscript({ status: "error" });
      } else {
        setTranscript({ status: "empty" });
      }
    } catch {
      setTranscript({ status: "error" });
    }
  }

  function handleLoad() {
    const id = extractYouTubeId(urlInput);
    if (!id) {
      setVideoId(null);
      setTranscript({ status: "idle" });
      setError("올바른 유튜브 영상 URL을 입력해 주세요.");
      return;
    }
    setError(null);
    setVideoId(id);
    setTranscriptOpen(true);
    fetchTranscript(id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleLoad();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>강의 복기</h1>
        <p className={styles.subtitle}>
          유튜브 강의 영상을 불러와 다시 보며 복기해요.
        </p>
      </header>

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          placeholder="유튜브 영상 URL을 붙여넣으세요"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className={styles.button} onClick={handleLoad}>
          영상 불러오기
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.workspace}>
        <section className={styles.videoColumn}>
          {videoId ? (
            <div className={styles.videoWrapper}>
              <iframe
                className={styles.video}
                src={`https://www.youtube.com/embed/${videoId}`}
                title="YouTube video player"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          ) : (
            <div className={styles.videoPlaceholder}>
              여기에 영상이 표시됩니다.
            </div>
          )}
        </section>

        <aside className={styles.chatPanel}>
          <div className={styles.chatHeader}>복기 노트</div>
          <div className={styles.chatBody}>
            <p className={styles.chatHint}>
              채팅 / 복기 기능은 다음 단계에서 추가될 예정입니다.
            </p>
          </div>
        </aside>
      </div>

      {videoId && (
        <section className={styles.transcriptPanel}>
          <button
            className={styles.transcriptHeader}
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-expanded={transcriptOpen}
          >
            <span>
              자막
              {transcript.status === "ready" && transcript.language
                ? ` · ${transcript.language}`
                : ""}
            </span>
            <span className={styles.chevron}>{transcriptOpen ? "▾" : "▸"}</span>
          </button>

          {transcriptOpen && (
            <div className={styles.transcriptBody}>
              {transcript.status === "loading" && (
                <p className={styles.transcriptHint}>자막을 가져오는 중…</p>
              )}

              {transcript.status === "empty" && (
                <p className={styles.transcriptHint}>
                  이 영상은 자막이 없어서 지원하지 않아요.
                </p>
              )}

              {transcript.status === "error" && (
                <p className={styles.transcriptHint}>
                  자막을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.
                </p>
              )}

              {transcript.status === "ready" && (
                <ol className={styles.transcriptList}>
                  {transcript.segments.map((seg, i) => (
                    <li key={i} className={styles.transcriptItem}>
                      <span className={styles.timestamp}>
                        {formatTime(seg.start)}
                      </span>
                      <span className={styles.segmentText}>{seg.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
