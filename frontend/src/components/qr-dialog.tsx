"use client";

import { Copy, Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { copy } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function QrDialog({ open, onClose, url, title }: { open: boolean; onClose: () => void; url: string; title: string }) {
  function downloadSvg() {
    const svg = document.getElementById("cl-qr")?.outerHTML;
    if (!svg) return;
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
      download: "captionlive-qr.svg",
    });
    a.click();
  }
  return (
    <Dialog open={open} onClose={onClose} title={title} description="Escaneá para ver los subtítulos en tu celular.">
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-2xl bg-white p-4">
          <QRCodeSVG id="cl-qr" value={url} size={260} level="M" marginSize={1} />
        </div>
        <code className="max-w-full break-all rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{url}</code>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => toast[(await copy(url)) ? "success" : "error"]("Enlace copiado")}>
            <Copy className="h-4 w-4" /> Copiar enlace
          </Button>
          <Button variant="outline" onClick={downloadSvg}><Download className="h-4 w-4" /> SVG</Button>
        </div>
      </div>
    </Dialog>
  );
}
