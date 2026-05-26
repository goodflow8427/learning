import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "강의 복기",
  description: "투자·경제 강의를 다시 보고 복기하는 공간",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
