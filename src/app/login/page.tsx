import type { Metadata } from "next";
import Image from "next/image";
import { LoginForm } from "./login-form";
export const metadata: Metadata = {
  title: "Masuk — INBIONUSA",
  description: "Sistem pengendalian mutu INBIONUSA.",
};
export default function LoginPage() {
  return (
    <div className="login-layout">
      <aside className="login-story">
        <div className="login-brand">
          <Image
            src="/logo.png"
            alt="Logo INBIONUSA"
            width={42}
            height={42}
            priority
          />
          <div>
            <p className="text-sm font-semibold tracking-tight">INBIONUSA</p>
            <p className="mt-0.5 text-[11px] text-muted">Quality Control</p>
          </div>
        </div>
        <div className="py-16">
          <h2 className="login-story-title">
            Quality
            <br />
            Control<span className="text-primary">.</span>
          </h2>
          <p className="login-story-note">
            Standar produk, hasil pengujian, dan sertifikat. Tercatat dalam satu
            tempat.
          </p>
        </div>
        <div className="login-index">
          <div>
            <span>01</span>Produk
          </div>
          <div>
            <span>02</span>Inspeksi
          </div>
          <div>
            <span>03</span>Sertifikat
          </div>
        </div>
      </aside>
      <main className="login-form-panel">
        <LoginForm />
      </main>
    </div>
  );
}
