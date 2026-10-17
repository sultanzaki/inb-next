import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-page-bg p-6">
      <div className="w-full max-w-md text-center">
        <Image
          src="/logo.png"
          alt="INBIONUSA"
          width={48}
          height={48}
          className="mx-auto mb-10"
        />
        <div className="data-card p-8 sm:p-10">
          <span className="empty-icon mx-auto">
            <Compass className="size-7" />
          </span>
          <p className="micro-label mt-6">404 · Page not found</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Back to your workspace
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This page may have moved. Check the address.
          </p>
          <Link
            href="/dashboard"
            className="mt-7 inline-flex min-h-10 items-center gap-2 rounded-control bg-primary px-5 py-3 text-sm font-medium text-surface transition-colors hover:bg-primary-dark"
          >
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted">INBIONUSA · Quality workspace</p>
      </div>
    </main>
  );
}
