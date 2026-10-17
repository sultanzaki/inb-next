"use client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
export function PdfPreview({
  url,
  onClose,
  onIssue,
  busy,
}: {
  url: string | null;
  onClose: () => void;
  onIssue: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <Dialog
      open={Boolean(url)}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent className="pdf-preview-dialog">
        <DialogHeader>
          <DialogTitle>Pratinjau COA</DialogTitle>
          <DialogDescription>
            Dokumen ini belum diterbitkan. Nomor otomatis akan dialokasikan saat
            penerbitan.
          </DialogDescription>
        </DialogHeader>
        {url && (
          <>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-primary"
            >
              Buka pratinjau di tab baru
              <ExternalLink className="size-3.5" />
            </a>
            <iframe
              title="Pratinjau PDF sertifikat analisis"
              src={url + "#toolbar=0"}
              className="pdf-preview-frame"
            />
          </>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Kembali mengedit
          </Button>
          <Button loading={busy} onClick={() => void onIssue()}>
            Terbitkan COA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
