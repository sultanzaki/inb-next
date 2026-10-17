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
          <DialogTitle>Preview COA</DialogTitle>
          <DialogDescription>
            Not issued yet. The certificate number is assigned on issuance.
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
              Open preview in a new tab
              <ExternalLink className="size-3.5" />
            </a>
            <iframe
              title="Certificate PDF preview"
              src={url + "#toolbar=0"}
              className="pdf-preview-frame"
            />
          </>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Back to editing
          </Button>
          <Button loading={busy} onClick={() => void onIssue()}>
            Issue COA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
