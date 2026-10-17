"use client";
import { RotateCw } from "lucide-react";
import { EmptyState } from "@/components/workspace/page-ui";
import { Button } from "@/components/ui/button";
export default function DashboardError({ retry }: { retry: () => void }) {
  return (
    <div className="data-card">
      <EmptyState
        error
        title="Could not load the workspace"
        description="Could not open this page. Retry to continue."
      >
        <Button onClick={retry}>
          <RotateCw className="size-4" />
          Retry
        </Button>
      </EmptyState>
    </div>
  );
}
