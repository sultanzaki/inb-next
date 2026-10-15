import type { Metadata } from 'next';
import { FileCheck, History, ShieldCheck } from 'lucide-react';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Masuk — INBIONUSA',
  description: 'Masuk ke Sistem Manajemen Mutu INBIONUSA.',
};

// Specimen grid: 1px lines in --color-primary-ink (#022c22) at 8% opacity,
// 24px cells — inline SVG data URI, no asset files.
const GRID_PATTERN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M0 .5H24M.5 0V24' fill='none' stroke='%23022c22' stroke-opacity='.08'/%3E%3C/svg%3E")`;

const BRAND_FACTS = [
  { icon: ShieldCheck, label: 'Kontrol Kualitas Terpusat' },
  { icon: FileCheck, label: 'Terbitkan COA digital' },
  { icon: History, label: 'Audit trail lengkap' },
];

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel — deep emerald with specimen grid */}
      <aside
        className="relative hidden flex-col px-12 py-12 text-white lg:flex lg:w-[42%]"
        style={{
          backgroundColor: '#064e3b',
          backgroundImage: `${GRID_PATTERN}, linear-gradient(180deg, #064e3b 0%, #022c22 100%)`,
        }}
      >
        <div>
          <p className="text-xl font-semibold tracking-tight">INBIONUSA</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">
            QC System
          </p>
          <p className="mt-8 max-w-[280px] text-[15px] leading-relaxed text-white/85">
            Sistem Manajemen Mutu
          </p>
        </div>

        <ul className="mt-auto divide-y divide-white/12">
          {BRAND_FACTS.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex items-center gap-3 py-3 text-[13px] text-white/80"
            >
              <Icon className="size-4 shrink-0 text-white/70" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </aside>

      {/* Form panel — floats on white, no card */}
      <main className="flex flex-1 items-center justify-center bg-surface px-6 py-12">
        <LoginForm />
      </main>
    </div>
  );
}
