"use client";

import { useEffect, useReducer, useState } from "react";
import { endpoints } from "@/lib/api";
import { initialCaptionState, reduceCaption } from "@/lib/captions";
import type { CaptionEvent } from "@/lib/types";

export type ConnectionState = "connecting" | "open" | "reconnecting";

/**
 * Live captions over Server-Sent Events. EventSource reconnects by itself and resumes from
 * Last-Event-ID, so nothing is lost on flaky venue Wi-Fi.
 */
export function useCaptionStream(sessionId: string | null, langs: string[]) {
  const [state, dispatch] = useReducer(reduceCaption, undefined, initialCaptionState);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const key = langs.join(",");

  useEffect(() => {
    if (!sessionId || !key) return;
    const es = new EventSource(endpoints.streamUrl(sessionId, key.split(",")));
    const onEvent = (e: MessageEvent) => {
      try {
        dispatch(JSON.parse(e.data) as CaptionEvent);
      } catch {}
    };
    for (const t of ["final", "interim", "status"]) es.addEventListener(t, onEvent as EventListener);
    es.onopen = () => setConnection("open");
    es.onerror = () => setConnection("reconnecting");
    return () => es.close();
  }, [sessionId, key]);

  return { state, connection };
}
