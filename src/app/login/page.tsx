import { Copyright } from "@/components/brand/copyright";
import type { Metadata } from "next";
import Image from "next/image";
import {
  Factory,
  FlaskConical,
  Warehouse,
  Handshake,
  ArrowUpRight,
} from "lucide-react";
import { LoginForm } from "./login-form";
export const metadata: Metadata = {
  title: "Sign in — INBIONUSA",
  description:
    "Your INBIONUSA workspace for production, quality, warehouse and sales.",
};
const modules = [
  { name: "Production", note: "From plan to finished batch", icon: Factory },
  { name: "Quality", note: "Confidence in every release", icon: FlaskConical },
  { name: "Warehouse", note: "Every lot, accounted for", icon: Warehouse },
  { name: "Sales", note: "From quotation to delivery", icon: Handshake },
];
export default function LoginPage() {
  return (
    <div className="login-layout login-operations">
      <aside className="login-story">
        <div className="login-brand">
          <Image
            src="/logo.png"
            alt="INBIONUSA logo"
            width={42}
            height={42}
            priority
          />
          <div>
            <p className="text-sm font-semibold tracking-tight">INBIONUSA</p>
            <p className="login-brand-caption">OPERATIONS WORKSPACE</p>
          </div>
        </div>
        <div className="login-story-content">
          <p className="login-eyebrow">ONE CONNECTED WORKSPACE</p>
          <h2>
            Good work.
            <br />
            All together.
          </h2>
          <p className="login-story-description">
            From the first batch to the final delivery. Keep your teams,
            products and decisions connected.
          </p>
          <div className="login-modules">
            {modules.map(({ name, note, icon: Icon }) => (
              <div className="login-module" key={name}>
                <Icon aria-hidden="true" />
                <div>
                  <strong>{name}</strong>
                  <span>{note}</span>
                </div>
                <ArrowUpRight aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
        <p className="login-story-footer">
          <Copyright />
        </p>
      </aside>
      <main className="login-form-panel">
        <LoginForm />
        <p className="login-mobile-copyright">
          <Copyright />
        </p>
      </main>
    </div>
  );
}
