import type { Metadata } from "next";
import { Suspense } from "react";
import { Viewer } from "@/components/viewer/viewer";

export const metadata: Metadata = { title: "Subtítulos en vivo" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <Viewer sessionId={decodeURIComponent(id)} />
    </Suspense>
  );
}
