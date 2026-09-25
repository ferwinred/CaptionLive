import type { Metadata } from "next";
import { Suspense } from "react";
import { Overlay } from "@/components/overlay";

export const metadata: Metadata = { title: "Overlay", robots: { index: false } };

export default async function OverlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <Overlay sessionId={decodeURIComponent(id)} />
    </Suspense>
  );
}
