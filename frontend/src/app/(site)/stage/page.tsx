import type { Metadata } from "next";
import { Suspense } from "react";
import { StageConsole } from "@/components/stage/stage-console";

export const metadata: Metadata = { title: "Escenario" };

export default function StagePage() {
  return (
    <Suspense>
      <StageConsole />
    </Suspense>
  );
}
