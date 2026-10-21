"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { requestTimeout } from "@/lib/request-timeout";

export function useFileDownload() {
  const [busy, setBusy] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function download(url: string, filename: string, key = url) {
    // A synchronous guard also catches a second click before React renders.
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(key);
    const notice = toast.loading("Preparing download…");
    const timeout = requestTimeout(controller.signal, 90_000);
    try {
      const response = await fetch(url, {
        signal: timeout.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw Error(error?.message || "Could not prepare the file. Retry.");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const objectURL = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectURL;
      const provided = response.headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/i)?.[1];
      anchor.download = (provided || filename).replace(
        /[^\p{L}\p{N}_. ()-]/gu,
        "_",
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectURL), 10_000);
      toast.success("Download ready.");
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(
          error instanceof Error && error.name === "TimeoutError"
            ? "Preparing the file took too long. Retry."
            : error instanceof Error
              ? error.message
              : "Could not download the file. Retry.",
        );
    } finally {
      timeout.dispose();
      toast.dismiss(notice);
      active.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  }
  return { busy, download };
}
