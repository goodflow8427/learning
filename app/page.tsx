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

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleLoad() {
    const id = extractYouTubeId(urlInput);
    if (!id) {
      setVideoId(null);
      setError("올바른 유튜브 영상 URL을 입력해 주세요.");
      return;
    }
    setError(null);
    setVideoId(id);
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
    </main>
  );
}
