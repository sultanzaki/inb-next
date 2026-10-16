import type { Metadata } from "next";
import Image from "next/image";
import {
  PackageCheck,
  ClipboardCheck,
  FileCheck2,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { LoginForm } from "./login-form";
export const metadata: Metadata = {
  title: "Masuk — INBIONUSA",
  description: "Ruang kerja pengendalian mutu INBIONUSA.",
};
export default function LoginPage() {
  return (
    <div className="login-layout">
      <aside className="login-story">
        <div className="login-brand">
          <span className="grid size-12 place-items-center rounded-xl bg-surface">
            <Image
              src="/logo.png"
              alt="Logo INBIONUSA"
              width={34}
              height={34}
              priority
            />
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight">INBIONUSA</p>
            <p className="mt-1 text-[10px] uppercase tracking-[.15em] text-primary-line">
              Quality workspace
            </p>
          </div>
        </div>
        <div className="py-14">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary-line/20 bg-primary-deep px-3 py-1.5 text-[10px] font-medium tracking-wide text-primary-line">
            <span className="size-1.5 rounded-full bg-primary-line" />
            SISTEM MANAJEMEN MUTU
          </div>
          <h2 className="login-story-title">
            Setiap detail berarti.
            <br />
            <span className="text-primary-line">Setiap kualitas terjaga.</span>
          </h2>
          <p className="login-story-copy">
            Satukan standar produk, pengujian lot, dan sertifikasi dalam satu
            alur kerja yang terarah.
          </p>
          <div className="login-flow">
            <span className="login-flow-item">
              <PackageCheck className="size-4 text-primary-line" />
              Produk
            </span>
            <ArrowRight className="size-3 text-primary-line/60" />
            <span className="login-flow-item">
              <ClipboardCheck className="size-4 text-primary-line" />
              Inspeksi
            </span>
            <ArrowRight className="size-3 text-primary-line/60" />
            <span className="login-flow-item">
              <FileCheck2 className="size-4 text-primary-line" />
              COA
            </span>
          </div>
          <div className="mt-12 flex items-center gap-3 border-t border-primary-line/15 pt-6">
            <span className="grid size-10 place-items-center rounded-xl border border-primary-line/20">
              <ShieldCheck className="size-5 text-primary-line" />
            </span>
            <div>
              <p className="text-xs font-medium">
                Kualitas yang bisa ditelusuri.
              </p>
              <p className="mt-1 text-[11px] text-primary-line">
                Standar jelas. Pengujian tercatat. Keputusan terarah.
              </p>
            </div>
          </div>
        </div>
        <p className="text-[10px] tracking-wide text-primary-line/80">
          INBIONUSA · Quality Control System
        </p>
      </aside>
      <main className="login-form-panel">
        <LoginForm />
      </main>
    </div>
  );
}
