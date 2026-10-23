"use client";
import { Button } from "@/components/ui/button";
export function SaveStatus({
  uncertain,
  onChecked,
}: {
  uncertain: boolean;
  onChecked: () => void;
}) {
  if (!uncertain) return null;
  return (
    <aside className="save-uncertain" role="alert">
      <strong>Save outcome not confirmed</strong>
      <p>
        The server may have saved this transaction. Check the record and its
        history before sending it again. Your recovery draft is kept on this
        device.
      </p>
      <Button variant="outline" size="sm" onClick={onChecked}>
        I checked the record — enable retry
      </Button>
    </aside>
  );
}
