"use client";
import { RotateCw } from "lucide-react";
import { EmptyState } from "@/components/workspace/page-ui";
import { Button } from "@/components/ui/button";
export default function DashboardError({ retry }: { retry: () => void }) {
  return (
    <div className="data-card">
      <EmptyState
        error
        title="Ruang kerja belum berhasil dimuat"
        description="Terjadi kendala saat membuka halaman ini. Coba kembali untuk melanjutkan pekerjaan Anda."
      >
        <Button onClick={retry}>
          <RotateCw className="size-4" />
          Coba lagi
        </Button>
      </EmptyState>
    </div>
  );
}
