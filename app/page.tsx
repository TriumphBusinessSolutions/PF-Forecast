"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import Head from "next/head";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "../lib/supabase";

// ------------------ brand + helpers ------------------
const BRAND = { blue: "#004aad", orange: "#fa9100" };

const MEMBERSHIP_PLANS = [
  {
    id: "launch",
    name: "Launch",
    blurb: "Perfect for solo advisors establishing their first Profit First dashboards.",
    headline: "Starter access",
    accent: "rgba(0, 74, 173, 0.65)",
  },
  {
    id: "growth",
    name: "Growth",
    blurb: "Great for growing firms that need to collaborate with a handful of clients.",
    headline: "Team collaboration",
    accent: "rgba(250, 145, 0, 0.7)",
  },
  {
    id: "scale",
    name: "Scale",
    blurb: "Reserved for multi-advisor teams managing complex Profit First portfolios.",
    headline: "Unlimited potential",
    accent: "rgba(15, 23, 42, 0.7)",
  },
];

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

const shortYM = (ym: string) => {
  const dt = new Date(ym + "-01");
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", "-");
};

const toSlug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ------------------ types ------------------
type ClientRow = { id: string; name: string };
type PFAccount = { slug: string; name: string; color?: string | null; sort_order?: number | null };

type ActLong = { client_id: string; ym: string; pf_slug: string; net_amount: number };
type BalLong = { client_id: string; ym: string; pf_slug: string; ending_balance: number };

type OccRow = {
  client_id: string;
  month_start: string;
  coa_account_id: string;
  kind: string;
  name: string;
  amount: number;
};

// ------------------ small UI atoms ------------------
const Card: React.FC<React.PropsWithChildren<{ title?: string }>> = ({ title, children }) => (
  <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
    {title && (
      <div className="px-4 py-2 text-sm font-semibold text-slate-800 border-b bg-slate-50 rounded-t-xl">
        {title}
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className = "",
  disabled,
  ...p
}) => (
  <button
    {...p}
    disabled={disabled}
    className={`px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 transition-colors ${
      disabled ? "opacity-60 cursor-not-allowed bg-slate-100" : "bg-white hover:bg-slate-50"
    } ${className}`}
  />
);

const AppScaffold: React.FC<React.PropsWithChildren> = ({ children }) => (
  <main className="min-h-screen bg-slate-100">
    <Head>
      <title>Profit First Forecast</title>
      <link
        href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
    </Head>
    <style jsx global>{`
        html, body { font-family: Rubik, system-ui, -apple-system, Segoe UI, Roboto, Arial; }
      `}</style>
    {children}
  </main>
);

const AuthView: React.FC = () => {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [signupStep, setSignupStep] = useState<"plans" | "form">("form");
  const [selectedPlan, setSelectedPlan] = useState<string>(MEMBERSHIP_PLANS[0]?.id ?? "launch");
  const [tilt, setTilt] = useState({ x: 0, y: 0, intensity: 0 });
  const [glow, setGlow] = useState({ x: 50, y: 50 });
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left;
    const offsetY = event.clientY - bounds.top;
    const xRatio = Math.min(Math.max(offsetX / bounds.width, 0), 1);
    const yRatio = Math.min(Math.max(offsetY / bounds.height, 0), 1);
    const rotateX = (yRatio - 0.5) * 12;
    const rotateY = (xRatio - 0.5) * -16;
    setTilt({ x: rotateX, y: rotateY, intensity: 1 });
    setGlow({ x: xRatio * 100, y: yRatio * 100 });
    setParallax({ x: (xRatio - 0.5) * 14, y: (yRatio - 0.5) * 10 });
  }, []);

  const handlePointerLeave = useCallback(() => {
    setTilt({ x: 0, y: 0, intensity: 0 });
    setGlow({ x: 50, y: 50 });
    setParallax({ x: 0, y: 0 });
  }, []);

  const motionStyle = useMemo(
    () =>
      ({
        ["--tilt-x" as any]: `${tilt.x.toFixed(2)}deg`,
        ["--tilt-y" as any]: `${tilt.y.toFixed(2)}deg`,
        ["--tilt-intensity" as any]: `${tilt.intensity.toFixed(2)}`,
        ["--glow-x" as any]: `${glow.x.toFixed(2)}%`,
        ["--glow-y" as any]: `${glow.y.toFixed(2)}%`,
        ["--parallax-x" as any]: `${parallax.x.toFixed(2)}`,
        ["--parallax-y" as any]: `${parallax.y.toFixed(2)}`,
      }) as React.CSSProperties,
    [glow.x, glow.y, parallax.x, parallax.y, tilt.intensity, tilt.x, tilt.y],
  );

  const selectedPlanMeta = useMemo(
    () => MEMBERSHIP_PLANS.find((plan) => plan.id === selectedPlan) ?? MEMBERSHIP_PLANS[0],
    [selectedPlan],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { membership_plan: selectedPlan } },
        });
        if (error) throw error;
        setMessage({
          type: "success",
          text: "Check your email to confirm your account before signing in.",
        });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setMessage({ type: "error", text });
    } finally {
      setLoading(false);
    }
  }

  const switchMode = (nextMode: "sign-in" | "sign-up") => {
    setMode(nextMode);
    setMessage(null);
    if (nextMode === "sign-up") {
      setSignupStep("plans");
      setSelectedPlan(MEMBERSHIP_PLANS[0]?.id ?? "launch");
      setEmail("");
      setPassword("");
    } else {
      setSignupStep("form");
      setEmail("");
      setPassword("");
    }
  };

  const showPlanStep = mode === "sign-up" && signupStep === "plans";

  return (
    <div
      className="auth-root"
      style={motionStyle}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="auth-artwork" aria-hidden="true">
        <div className="auth-radial auth-radial--top" />
        <div className="auth-radial auth-radial--bottom" />
        <div className="auth-grid" />
        <div className="auth-orb auth-orb--one" />
        <div className="auth-orb auth-orb--two" />
        <div className="auth-orb auth-orb--three" />
        <div className="auth-lion">
          <div className="auth-lion__mane" />
          <div className="auth-lion__face" />
          <div className="auth-lion__eyes" />
          <div className="auth-lion__snout" />
          <div className="auth-lion__crown" />
        </div>
        <svg viewBox="0 0 600 400" className="auth-chart">
          <path
            d="M0 320L60 260L120 280L180 210L240 240L300 150L360 210L420 120L480 190L540 110L600 160"
            fill="none"
            stroke="currentColor"
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[60, 120, 180, 240, 300, 360, 420, 480, 540].map((x, i) => (
            <g key={x}>
              <rect
                x={x - 6}
                y={i % 2 === 0 ? 200 : 140}
                width={12}
                height={i % 2 === 0 ? 90 : 120}
                rx={3}
                fill="currentColor"
                opacity={0.4}
              />
              <circle cx={x} cy={i % 2 === 0 ? 260 : 150} r={7} fill="currentColor" />
            </g>
          ))}
        </svg>
        <div className="auth-glow auth-glow--emerald" />
        <div className="auth-glow auth-glow--base" />
      </div>

      <div className="auth-card-wrapper">
        <div className="auth-card">
          <div className="auth-copy">
            <h1 className="auth-brand-title">Triumph Cash Forecast</h1>
            <p className="auth-brand-subtitle">Specially made to Follow Profit First Methods</p>
            <h2 className="auth-title">
              {mode === "sign-in"
                ? "Welcome back"
                : showPlanStep
                ? "Choose your membership"
                : "Create your account"}
            </h2>
            <p className="auth-subtitle">
              {mode === "sign-in"
                ? "Sign in to review client performance and update allocations."
                : showPlanStep
                ? "Select the membership level that fits your firm—each option can be customized later."
                : "Set up your workspace so you can start onboarding clients."}
            </p>
          </div>

          {showPlanStep ? (
            <div className="auth-plan-picker" role="radiogroup" aria-label="Membership level">
              <div className="auth-plan-grid">
                {MEMBERSHIP_PLANS.map((plan) => {
                  const active = selectedPlan === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`auth-plan ${active ? "auth-plan--active" : ""}`}
                      onClick={() => setSelectedPlan(plan.id)}
                    >
                      <span className="auth-plan-headline">{plan.headline}</span>
                      <span className="auth-plan-name">{plan.name}</span>
                      <span className="auth-plan-blurb">{plan.blurb}</span>
                      <span className="auth-plan-pill">Customize soon</span>
                      <span className="auth-plan-highlight" style={{ background: plan.accent }} />
                    </button>
                  );
                })}
              </div>
              <button type="button" className="auth-submit" onClick={() => setSignupStep("form")}>
                Continue with {selectedPlanMeta?.name ?? "plan"}
              </button>
              <p className="auth-plan-note">
                You can fine-tune pricing, client limits, and perks for each membership inside Supabase later.
              </p>
              <p className="auth-switch">
                Already have an account?{" "}
                <button type="button" onClick={() => switchMode("sign-in")}>Sign in</button>
              </p>
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              {mode === "sign-up" && selectedPlanMeta && (
                <div className="auth-plan-summary">
                  <div>
                    <span className="auth-plan-summary-label">Membership</span>
                    <span className="auth-plan-summary-name">{selectedPlanMeta.name}</span>
                  </div>
                  <button
                    type="button"
                    className="auth-plan-summary-change"
                    onClick={() => setSignupStep("plans")}
                  >
                    Change
                  </button>
                </div>
              )}
              <label className="auth-field" htmlFor="authEmail">
                <span className="auth-label">Email</span>
                <input
                  id="authEmail"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input"
                />
              </label>
              <label className="auth-field" htmlFor="authPassword">
                <span className="auth-label">Password</span>
                <input
                  id="authPassword"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                />
              </label>
              {message && (
                <p
                  className={`auth-message ${
                    message.type === "error" ? "auth-message--error" : "auth-message--success"
                  }`}
                >
                  {message.text}
                </p>
              )}
              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
              </button>
              <p className="auth-switch">
                {mode === "sign-in" ? (
                  <>
                    Don&apos;t have an account?{" "}
                    <button type="button" onClick={() => switchMode("sign-up")}>Sign up</button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button type="button" onClick={() => switchMode("sign-in")}>Sign in</button>
                  </>
                )}
              </p>
            </form>
          )}
        </div>
      </div>

      <style jsx>{`
        .auth-root {
          position: relative;
          display: flex;
          min-height: 100vh;
          width: 100%;
          align-items: center;
          justify-content: center;
          padding: 64px 16px;
          background: radial-gradient(circle at 18% -12%, rgba(250, 145, 0, 0.46), transparent 62%),
            radial-gradient(circle at 80% 120%, rgba(0, 74, 173, 0.65), rgba(2, 6, 23, 0.94) 68%),
            linear-gradient(160deg, #020617 10%, #071630 48%, #112347 100%);
          overflow: hidden;
          perspective: 1600px;
          color: #f8fafc;
        }
        .auth-root::before {
          content: "";
          position: absolute;
          inset: -25%;
          background: conic-gradient(
            from 140deg,
            rgba(0, 74, 173, 0.36),
            rgba(15, 23, 42, 0.15),
            rgba(250, 145, 0, 0.28),
            rgba(15, 23, 42, 0.28)
          );
          filter: blur(160px);
          opacity: 0.75;
          pointer-events: none;
        }
        .auth-root::after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(
              circle at var(--glow-x, 50%) var(--glow-y, 50%),
              rgba(250, 145, 0, 0.14),
              transparent 68%
            ),
            radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.18), transparent 62%);
          mix-blend-mode: screen;
          opacity: 0.9;
          pointer-events: none;
          transition: opacity 0.4s ease;
        }
        @media (min-width: 640px) {
          .auth-root {
            padding: 80px 24px;
          }
        }
        .auth-artwork {
          position: absolute;
          inset: 0;
          pointer-events: none;
          transform: translate3d(
            calc(var(--parallax-x, 0) * 6px),
            calc(var(--parallax-y, 0) * 4px),
            0
          );
          transition: transform 0.35s ease;
        }
        .auth-radial {
          position: absolute;
          inset: 0;
        }
        .auth-radial--top {
          background: radial-gradient(circle at top, rgba(37, 99, 235, 0.35), transparent 60%);
        }
        .auth-radial--bottom {
          background: radial-gradient(circle at bottom, rgba(16, 185, 129, 0.25), transparent 55%);
        }
        .auth-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(120deg, rgba(148, 163, 184, 0.14) 1px, transparent 0),
            linear-gradient(0deg, rgba(148, 163, 184, 0.12) 1px, transparent 0);
          background-size: 40px 40px, 60px 60px;
          opacity: 0.2;
          transform: translate3d(
              calc(var(--parallax-x, 0) * -8px),
              calc(var(--parallax-y, 0) * -6px),
              0
            )
            scale(1.05);
          transition: transform 0.4s ease;
        }
        .auth-orb {
          position: absolute;
          border-radius: 9999px;
          filter: blur(0);
          opacity: 0.35;
          transform: translate3d(
            calc(var(--parallax-x, 0) * -10px),
            calc(var(--parallax-y, 0) * -8px),
            0
          );
          transition: transform 0.5s ease;
          animation: auth-orb-float 14s ease-in-out infinite;
        }
        .auth-orb--one {
          top: -160px;
          right: -120px;
          width: 420px;
          height: 420px;
          background: radial-gradient(circle at 30% 30%, rgba(56, 189, 248, 0.45), transparent 70%);
          box-shadow: 0 45px 120px -40px rgba(14, 116, 144, 0.6);
          animation-delay: -2s;
        }
        .auth-orb--two {
          bottom: -140px;
          left: -140px;
          width: 360px;
          height: 360px;
          background: radial-gradient(circle at 60% 40%, rgba(250, 204, 21, 0.4), transparent 75%);
          box-shadow: 0 55px 140px -50px rgba(161, 98, 7, 0.6);
          animation-delay: 1.5s;
        }
        .auth-orb--three {
          top: 20%;
          left: 45%;
          width: 240px;
          height: 240px;
          background: radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.42), transparent 70%);
          box-shadow: 0 35px 110px -50px rgba(6, 95, 70, 0.6);
          animation-delay: -4s;
        }
        @keyframes auth-orb-float {
          0%,
          100% {
            transform: translate3d(
              calc(var(--parallax-x, 0) * -10px),
              calc(var(--parallax-y, 0) * -8px),
              0
            );
          }
          50% {
            transform: translate3d(
                calc(var(--parallax-x, 0) * -6px),
                calc(var(--parallax-y, 0) * -4px),
                0
              )
              translateY(-28px);
          }
        }
        .auth-chart {
          position: absolute;
          right: -96px;
          top: 64px;
          width: 520px;
          color: rgba(56, 189, 248, 0.42);
        }
        .auth-lion {
          position: absolute;
          bottom: -120px;
          left: -100px;
          width: 420px;
          height: 420px;
          display: grid;
          place-items: center;
          transform: rotate(-8deg);
          opacity: 0.85;
        }
        .auth-lion__mane {
          width: 100%;
          height: 100%;
          border-radius: 48% 52% 55% 45% / 50% 44% 56% 50%;
          background: radial-gradient(circle at 48% 42%, rgba(255, 255, 255, 0.1), transparent 55%),
            radial-gradient(circle at 65% 72%, rgba(255, 255, 255, 0.12), transparent 60%),
            conic-gradient(from 140deg, rgba(250, 145, 0, 0.82), rgba(253, 186, 116, 0.95), rgba(234, 88, 12, 0.9), rgba(250, 145, 0, 0.82));
          filter: drop-shadow(0 30px 70px rgba(2, 6, 23, 0.45));
        }
        .auth-lion__face {
          position: absolute;
          width: 58%;
          height: 58%;
          border-radius: 48% 48% 52% 52% / 46% 46% 54% 54%;
          background: linear-gradient(145deg, #fff4cf, #fde68a 55%, #fbbf24 100%);
          box-shadow: inset 0 -16px 32px rgba(250, 145, 0, 0.25);
        }
        .auth-lion__eyes {
          position: absolute;
          top: 44%;
          left: 50%;
          width: 0;
          height: 14px;
          transform: translateX(-50%);
        }
        .auth-lion__eyes::before,
        .auth-lion__eyes::after {
          content: "";
          position: absolute;
          top: 0;
          width: 14px;
          height: 14px;
          border-radius: 9999px;
          background: #0f172a;
        }
        .auth-lion__eyes::before {
          transform: translateX(-56px);
        }
        .auth-lion__eyes::after {
          transform: translateX(56px);
        }
        .auth-lion__snout {
          position: absolute;
          bottom: 32%;
          width: 120px;
          height: 96px;
          border-radius: 60% 60% 80% 80% / 55% 55% 90% 90%;
          background: radial-gradient(circle at 50% 30%, #fde68a, #f59e0b 72%, rgba(245, 158, 11, 0));
          box-shadow: 0 16px 28px rgba(15, 23, 42, 0.22);
        }
        .auth-lion__snout::before {
          content: "";
          position: absolute;
          top: 26px;
          left: 0;
          right: 0;
          margin: 0 auto;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #0f172a;
          box-shadow: -36px 0 0 #0f172a, 36px 0 0 #0f172a;
        }
        .auth-lion__snout::after {
          content: "";
          position: absolute;
          bottom: 18px;
          left: 50%;
          transform: translateX(-50%);
          width: 70px;
          height: 38px;
          border-bottom-left-radius: 50% 70%;
          border-bottom-right-radius: 50% 70%;
          border: 4px solid rgba(15, 23, 42, 0.6);
          border-top: none;
        }
        .auth-lion__crown {
          position: absolute;
          top: 16%;
          width: 140px;
          height: 80px;
          background: radial-gradient(circle at 50% -40%, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0)),
            linear-gradient(135deg, rgba(250, 145, 0, 0.9), rgba(253, 224, 71, 0.95));
          clip-path: polygon(10% 100%, 22% 0, 38% 55%, 50% 0, 62% 55%, 78% 0, 90% 100%);
          box-shadow: 0 18px 30px rgba(15, 23, 42, 0.32);
        }
        @media (max-width: 640px) {
          .auth-lion {
            width: 320px;
            height: 320px;
            bottom: -140px;
            left: -80px;
            opacity: 0.65;
          }
        }
        .auth-glow {
          position: absolute;
          border-radius: 9999px;
          filter: blur(96px);
        }
        .auth-glow--emerald {
          left: -80px;
          top: 48px;
          width: 256px;
          height: 256px;
          background: rgba(16, 185, 129, 0.3);
        }
        .auth-glow--base {
          left: 50%;
          bottom: 0;
          width: 140%;
          height: 192px;
          transform: translateX(-50%);
          background: linear-gradient(to top, rgba(2, 6, 23, 0.95), rgba(2, 6, 23, 0.4), transparent);
        }
        .auth-card-wrapper {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 540px;
          padding: 0 12px;
          transform-style: preserve-3d;
        }
        .auth-card {
          position: relative;
          border-radius: 32px;
          border: 1px solid rgba(148, 163, 184, 0.25);
          background: linear-gradient(
            160deg,
            rgba(15, 23, 42, 0.88),
            rgba(30, 64, 175, 0.82) 58%,
            rgba(250, 145, 0, 0.3) 100%
          );
          padding: 52px 44px;
          color: #f8fafc;
          box-shadow: 0 50px 110px -45px rgba(2, 6, 23, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.12);
          backdrop-filter: blur(28px);
          transform-style: preserve-3d;
          transform: perspective(1600px)
            rotateX(var(--tilt-x, 0deg))
            rotateY(var(--tilt-y, 0deg))
            translateZ(calc(var(--tilt-intensity, 0) * 18px));
          transition: transform 0.4s ease, box-shadow 0.4s ease;
        }
        .auth-card::before {
          content: "";
          position: absolute;
          inset: -1px;
          border-radius: 32px;
          background: radial-gradient(
            circle at var(--glow-x, 50%) var(--glow-y, 50%),
            rgba(250, 145, 0, 0.28),
            transparent 68%
          );
          opacity: calc(0.25 + var(--tilt-intensity, 0) * 0.35);
          pointer-events: none;
          transition: opacity 0.4s ease;
        }
        .auth-card::after {
          content: "";
          position: absolute;
          inset: 1px;
          border-radius: 30px;
          background: linear-gradient(140deg, rgba(148, 163, 184, 0.12), rgba(15, 118, 110, 0.04));
          mix-blend-mode: screen;
          opacity: calc(0.35 + var(--tilt-intensity, 0) * 0.25);
          pointer-events: none;
        }
        .auth-card:hover {
          box-shadow: 0 55px 130px -50px rgba(2, 6, 23, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.16);
        }
        @media (max-width: 520px) {
          .auth-card {
            padding: 40px 28px;
          }
        }
        .auth-copy {
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .auth-brand-title {
          font-size: 36px;
          line-height: 1.15;
          margin: 0;
          font-weight: 700;
          color: #f8fafc;
          text-shadow: 0 18px 45px rgba(2, 6, 23, 0.4);
          letter-spacing: 0.01em;
        }
        .auth-brand-subtitle {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: rgba(250, 204, 21, 0.92);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .auth-title {
          font-size: 22px;
          margin: 16px 0 0;
          font-weight: 600;
          color: #e2e8f0;
        }
        .auth-subtitle {
          margin-top: 6px;
          font-size: 15px;
          color: rgba(226, 232, 240, 0.78);
        }
        .auth-form {
          margin-top: 32px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .auth-plan-picker {
          margin-top: 32px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .auth-plan-grid {
          display: grid;
          gap: 16px;
        }
        @media (min-width: 768px) {
          .auth-plan-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        .auth-plan {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-start;
          border-radius: 18px;
          padding: 22px;
          text-align: left;
          background: linear-gradient(150deg, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.62));
          border: 1px solid rgba(148, 163, 184, 0.32);
          box-shadow: 0 26px 54px -34px rgba(2, 6, 23, 0.75);
          color: #e2e8f0;
          cursor: pointer;
          transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
          overflow: hidden;
        }
        .auth-plan:hover {
          transform: translateY(-4px) scale(1.01);
          box-shadow: 0 32px 72px -36px rgba(2, 6, 23, 0.85);
        }
        .auth-plan:focus-visible {
          outline: 3px solid rgba(56, 189, 248, 0.4);
          outline-offset: 2px;
        }
        .auth-plan--active {
          border-color: rgba(250, 145, 0, 0.7);
          box-shadow: 0 34px 76px -30px rgba(250, 145, 0, 0.45);
        }
        .auth-plan-headline {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 600;
          color: rgba(226, 232, 240, 0.66);
        }
        .auth-plan-name {
          font-size: 20px;
          font-weight: 700;
          color: #f8fafc;
        }
        .auth-plan-blurb {
          font-size: 13px;
          color: rgba(226, 232, 240, 0.78);
          line-height: 1.45;
        }
        .auth-plan-pill {
          margin-top: auto;
          display: inline-flex;
          align-items: center;
          padding: 6px 12px;
          border-radius: 9999px;
          font-size: 12px;
          font-weight: 600;
          color: #0f172a;
          background: linear-gradient(135deg, rgba(250, 204, 21, 0.9), rgba(250, 145, 0, 0.85));
        }
        .auth-plan-highlight {
          position: absolute;
          inset: auto 0 0 0;
          height: 14px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
          opacity: 0.6;
        }
        .auth-plan-note {
          font-size: 13px;
          color: rgba(226, 232, 240, 0.75);
          text-align: center;
        }
        .auth-plan-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-radius: 16px;
          background: rgba(15, 23, 42, 0.65);
          border: 1px solid rgba(148, 163, 184, 0.32);
          color: #f8fafc;
        }
        .auth-plan-summary-label {
          display: block;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(226, 232, 240, 0.62);
        }
        .auth-plan-summary-name {
          font-size: 16px;
          font-weight: 600;
          color: #f8fafc;
        }
        .auth-plan-summary-change {
          border: none;
          background: transparent;
          font-size: 13px;
          font-weight: 600;
          color: rgba(250, 204, 21, 0.92);
          cursor: pointer;
          text-decoration: underline;
        }
        .auth-plan-summary-change:hover {
          color: rgba(250, 204, 21, 1);
        }
        .auth-plan-summary-change:focus-visible {
          outline: 2px solid rgba(250, 204, 21, 0.8);
          outline-offset: 2px;
        }
        .auth-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 14px;
        }
        .auth-label {
          font-weight: 500;
          color: rgba(226, 232, 240, 0.9);
        }
        .auth-input {
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.45);
          padding: 12px 16px;
          font-size: 14px;
          color: #0f172a;
          background: linear-gradient(145deg, rgba(248, 250, 252, 0.94), rgba(226, 232, 240, 0.92));
          box-shadow: 0 18px 38px -28px rgba(15, 23, 42, 0.45);
          transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        }
        .auth-input:focus {
          outline: none;
          border-color: rgba(0, 74, 173, 0.7);
          box-shadow: 0 0 0 3px rgba(0, 74, 173, 0.25);
          transform: translateY(-1px);
        }
        .auth-message {
          font-size: 14px;
        }
        .auth-message--error {
          color: #dc2626;
        }
        .auth-message--success {
          color: #059669;
        }
        .auth-submit {
          margin-top: 4px;
          width: 100%;
          border: none;
          border-radius: 16px;
          padding: 14px 16px;
          font-size: 16px;
          font-weight: 600;
          background: linear-gradient(135deg, ${BRAND.blue}, ${BRAND.orange});
          color: #fff;
          cursor: pointer;
          transition: transform 0.25s ease, box-shadow 0.25s ease;
          box-shadow: 0 24px 44px -20px rgba(2, 6, 23, 0.82);
        }
        .auth-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .auth-submit:not(:disabled):hover {
          transform: translateY(-2px) scale(1.005);
          box-shadow: 0 32px 60px -22px rgba(2, 6, 23, 0.9);
        }
        .auth-submit:not(:disabled):focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.6);
          outline-offset: 3px;
        }
        .auth-switch {
          text-align: center;
          font-size: 14px;
          color: rgba(226, 232, 240, 0.7);
        }
        .auth-switch button {
          background: none;
          border: none;
          color: rgba(56, 189, 248, 0.95);
          font-weight: 600;
          cursor: pointer;
        }
        .auth-switch button:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
};

type ClientSelectorProps = {
  clients: ClientRow[];
  loading: boolean;
  error: string | null;
  onSelect: (clientId: string) => void;
  onCreate: (name: string) => Promise<ClientRow>;
  onSignOut: () => Promise<void> | void;
  userEmail?: string | null;
};

const ClientSelector: React.FC<ClientSelectorProps> = ({
  clients,
  loading,
  error,
  onSelect,
  onCreate,
  onSignOut,
  userEmail,
}) => {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setLocalError("Please enter a client name.");
      return;
    }
    setCreating(true);
    setLocalError(null);
    try {
      const created = await onCreate(trimmed);
      setNewName("");
      onSelect(created.id);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Unable to create client.";
      setLocalError(text);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <Card title="Select a client workspace">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Choose an existing client or add a new one to start forecasting.
            </p>
            {loading ? (
              <p className="text-sm text-slate-500">Loading clients...</p>
            ) : clients.length ? (
              <ul className="space-y-2">
                {clients.map((client) => (
                  <li key={client.id}>
                    <Button
                      type="button"
                      onClick={() => onSelect(client.id)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <span className="font-medium text-slate-800">{client.name}</span>
                      <span className="text-xs text-slate-500">Open</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                You don&apos;t have any clients yet. Add one below to get started.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </Card>
        <Card title="Add a new client">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label htmlFor="newClientName" className="text-sm font-medium text-slate-700">
                Client name
              </label>
              <input
                id="newClientName"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="e.g. Acme Agency"
              />
            </div>
            {localError && <p className="text-sm text-red-600">{localError}</p>}
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Button
                type="submit"
                disabled={creating}
                className="!bg-[#004aad] !text-white !border-[#004aad] hover:!bg-[#003b8a]"
              >
                {creating ? "Creating..." : "Add client"}
              </Button>
              <p className="text-xs text-slate-500">
                Subscription-based client limits are coming soon. All plans are unlimited during preview.
              </p>
            </div>
          </form>
        </Card>
        <div className="text-center text-sm text-slate-500">
          <p>
            Signed in as{" "}
            <span className="font-medium text-slate-700">{userEmail ?? "unknown user"}</span>.
          </p>
          <div className="mt-3">
            <Button type="button" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ------------------ page ------------------
export default function Page() {
  // auth
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // clients
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientIdState] = useState<string | null>(null);
  const [preferredClientId, setPreferredClientId] = useState<string | null>(null);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);

  const changeClientId = useCallback((nextId: string | null) => {
    setClientIdState(nextId);
    setPreferredClientId(nextId);
    if (typeof window !== "undefined") {
      if (nextId) {
        window.localStorage.setItem("pf-last-client", nextId);
      } else {
        window.localStorage.removeItem("pf-last-client");
      }
    }
  }, []);

  // controls
  const [mode, setMode] = useState<"total" | "accounts">("total");
  const [horizon, setHorizon] = useState<number>(9);
  const [startMonth, setStartMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // dynamic accounts + data
  const [accounts, setAccounts] = useState<PFAccount[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [activity, setActivity] = useState<ActLong[]>([]);
  const [balances, setBalances] = useState<BalLong[]>([]);

  // allocations (settings)
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [allocDate, setAllocDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // drill
  const [drill, setDrill] = useState<{ slug: string; ym: string } | null>(null);
  const [occ, setOcc] = useState<OccRow[]>([]);
  const [coaMap, setCoaMap] = useState<Record<string, string>>({}); // coa_id -> pf_slug

  // ------------ auth & client bootstrap ------------
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setCheckingSession(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setCheckingSession(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setClientIdState(null);
      setPreferredClientId(null);
      setClients([]);
      setClientsError(null);
      setClientsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("pf-last-client");
    if (stored) {
      setPreferredClientId(stored);
    }
  }, [session]);

  useEffect(() => {
    if (!session?.user?.id) return;
    let active = true;
    setClientsLoading(true);
    setClientsError(null);
    const loadClients = async () => {
      try {
        const { data, error } = await supabase.from("clients").select("id, name").order("created_at");
        if (!active) return;
        if (error) {
          setClients([]);
          setClientsError("Unable to load clients. Please check your access permissions.");
        } else {
          setClients(data ?? []);
        }
      } catch (_err) {
        if (!active) return;
        setClients([]);
        setClientsError("Unable to load clients. Please check your access permissions.");
      } finally {
        if (active) setClientsLoading(false);
      }
    };
    loadClients();
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session) return;
    if (clientsLoading) return;
    if (!clients.length) {
      if (clientId !== null) {
        changeClientId(null);
      }
      return;
    }
    if (clientId && clients.some((c) => c.id === clientId)) {
      return;
    }
    if (preferredClientId && clients.some((c) => c.id === preferredClientId)) {
      changeClientId(preferredClientId);
      return;
    }
    changeClientId(clients[0].id);
  }, [changeClientId, clientId, clients, clientsLoading, preferredClientId, session]);

  async function handleCreateClient(name: string): Promise<ClientRow> {
    if (!session) {
      throw new Error("You must be signed in to create clients.");
    }
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Client name is required.");
    }
    const ownerId = session.user?.id;
    if (!ownerId) {
      throw new Error("Unable to determine the current user. Please sign in again.");
    }
    const { data, error } = await supabase
      .from("clients")
      .insert({ name: trimmed, owner_id: ownerId })
      .select()
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Could not add client. Check your access policies.");
    }
    const clientRow = data as ClientRow;
    setClients((prev) => {
      const withoutNew = prev.filter((c) => c.id !== clientRow.id);
      return [...withoutNew, clientRow];
    });
    const coreAccounts = [
      { slug: "operating", name: "Operating", sort_order: 10, color: "#64748b" },
      { slug: "profit", name: "Profit", sort_order: 20, color: "#fa9100" },
      { slug: "owners_pay", name: "Owner's Pay", sort_order: 30, color: "#10b981" },
      { slug: "tax", name: "Tax", sort_order: 40, color: "#ef4444" },
      { slug: "vault", name: "Vault", sort_order: 50, color: "#8b5cf6" },
    ];
    try {
      await supabase
        .from("pf_accounts")
        .insert(coreAccounts.map((acc) => ({ client_id: clientRow.id, ...acc })));
    } catch (seedError) {
      console.error("Failed to seed default PF accounts", seedError);
    }
    return clientRow;
  }

  // ------------ load data for a client ------------
  useEffect(() => {
    if (!clientId || !session) return;
    (async () => {
      // accounts
      const { data: paf } = await supabase
        .from("pf_accounts")
        .select("slug, name, color, sort_order")
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      setAccounts((paf ?? []) as PFAccount[]);

      // mapping for drill
      const { data: mapRows } = await supabase
        .from("coa_to_pf_map")
        .select("coa_account_id, pf_slug")
        .eq("client_id", clientId);
      const cmap: Record<string, string> = {};
      (mapRows ?? []).forEach((r: any) => (cmap[r.coa_account_id] = r.pf_slug));
      setCoaMap(cmap);

      // allocations – most recent
      const { data: latest } = await supabase
        .from("allocation_targets")
        .select("effective_date")
        .eq("client_id", clientId)
        .order("effective_date", { ascending: false })
        .limit(1);
      const eff = latest?.[0]?.effective_date ?? allocDate;
      setAllocDate(eff);
      const { data: arows } = await supabase
        .from("allocation_targets")
        .select("pf_slug, pct")
        .eq("client_id", clientId)
        .eq("effective_date", eff);
      const aMap: Record<string, number> = {};
      (arows ?? []).forEach((r: any) => (aMap[r.pf_slug] = Number(r.pct || 0)));
      setAlloc(aMap);

      // activity + balances (long)
      const { data: act } = await supabase
        .from("v_monthly_activity_long")
        .select("*")
        .eq("client_id", clientId)
        .order("ym");
      const { data: bal } = await supabase
        .from("v_pf_balances_long")
        .select("*")
        .eq("client_id", clientId)
        .order("ym");
      const allMonths = Array.from(new Set((act ?? []).map((r: any) => r.ym)));
      setMonths(filterMonths(allMonths, startMonth, horizon));
      setActivity((act ?? []) as ActLong[]);
      setBalances((bal ?? []) as BalLong[]);
    })();
  }, [clientId]);

  // re-filter months when controls change
  useEffect(() => {
    const all = Array.from(new Set(activity.map((r) => r.ym)));
    setMonths(filterMonths(all, startMonth, horizon));
  }, [startMonth, horizon, activity]);

  // ------------ pivots ------------
  const actByMonth = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    activity.forEach((r) => {
      if (!m.has(r.ym)) m.set(r.ym, {});
      m.get(r.ym)![r.pf_slug] = Number(r.net_amount || 0);
    });
    return m;
  }, [activity]);

  const balByMonth = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    balances.forEach((r) => {
      if (!m.has(r.ym)) m.set(r.ym, {});
      m.get(r.ym)![r.pf_slug] = Number(r.ending_balance || 0);
    });
    return m;
  }, [balances]);

  const chartData = useMemo(() => {
    return months.map((ym) => {
      const row = balByMonth.get(ym) || {};
      const d: any = { month: ym, label: shortYM(ym) };
      let total = 0;
      accounts.forEach((a) => {
        const v = row[a.slug] || 0;
        d[a.name] = v;
        total += v;
      });
      d.Total = total;
      return d;
    });
  }, [months, accounts, balByMonth]);

  // ------------ drill ------------
  async function openDrill(slug: string, ym: string) {
    if (!clientId) return;
    setDrill({ slug, ym });
    const { data } = await supabase
      .from("v_proj_occurrences")
      .select("client_id, month_start, coa_account_id, kind, name, amount")
      .eq("client_id", clientId)
      .eq("month_start", ym + "-01");
    const filtered = (data ?? []).filter((r: any) => coaMap[r.coa_account_id] === slug);
    setOcc(filtered as OccRow[]);
  }

  // ------------ render ------------
  const allocTotal = accounts.reduce((s, a) => s + (alloc[a.slug] || 0), 0);
  const allocOk = Math.abs(allocTotal - 1) < 0.0001;

  const metadataEmail = session?.user?.user_metadata?.email;
  const userEmail = session?.user?.email ?? (typeof metadataEmail === "string" ? metadataEmail : null);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <AppScaffold>
      {checkingSession ? (
        <div className="flex min-h-screen items-center justify-center px-4 py-12">
          <p className="text-sm text-slate-500">Checking your session…</p>
        </div>
      ) : !session ? (
        <AuthView />
      ) : !clientId ? (
        <ClientSelector
          clients={clients}
          loading={clientsLoading}
          error={clientsError}
          onSelect={(id) => changeClientId(id)}
          onCreate={handleCreateClient}
          onSignOut={handleSignOut}
          userEmail={userEmail}
        />
      ) : (
        <div className="max-w-[1200px] mx-auto px-4 py-4">
          {/* top bar */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <select
                value={clientId ?? ""}
                onChange={(e) => changeClientId(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button
                onClick={async () => {
                  const name = prompt("New client name?");
                  if (!name) return;
                  try {
                    const created = await handleCreateClient(name);
                    changeClientId(created.id);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Could not add client. Check policies.");
                  }
                }}
              >
                + Add Client
              </Button>
            </div>

            <div className="flex items-center gap-3 text-sm text-slate-600">
              {userEmail && (
                <span className="hidden sm:inline">
                  Signed in as <span className="font-medium text-slate-800">{userEmail}</span>
                </span>
              )}
              <Button onClick={handleSignOut}>Sign out</Button>
            </div>
      <div className="max-w-[1200px] mx-auto px-4 py-4">
        {/* top bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div className="flex items-center gap-3">
            <select
              value={clientId ?? ""}
              onChange={(e) => changeClientId(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-white"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button
              onClick={async () => {
                const name = prompt("New client name?");
                if (!name) return;
                const { data, error } = await supabase.from("clients").insert({ name }).select().single();
                if (error) return alert("Could not add client. Check policies.");
                setClients((p) => [...p, data as ClientRow]);
                changeClientId((data as any).id);
                // seed core PF accounts for this client so UI works instantly
                const core = [
                  { slug: "operating", name: "Operating", sort_order: 10, color: "#64748b" },
                  { slug: "profit", name: "Profit", sort_order: 20, color: "#fa9100" },
                  { slug: "owners_pay", name: "Owner's Pay", sort_order: 30, color: "#10b981" },
                  { slug: "tax", name: "Tax", sort_order: 40, color: "#ef4444" },
                  { slug: "vault", name: "Vault", sort_order: 50, color: "#8b5cf6" },
                ];
                await supabase.from("pf_accounts").insert(
                  core.map((r) => ({ client_id: (data as any).id, ...r }))
                );
              }}
            >
              + Add Client
            </Button>
            <Button
              className="bg-red-600 text-white border-0 hover:bg-red-700"
              onClick={async () => {
                if (!clientId) return;
                const clientName = clients.find((c) => c.id === clientId)?.name ?? "this client";
                if (
                  !window.confirm(
                    `Delete ${clientName}? This will permanently remove the client and all associated data.`
                  )
                )
                  return;

                const tables = ["allocation_targets", "pf_accounts", "coa_to_pf_map"];
                for (const table of tables) {
                  const { error } = await supabase.from(table).delete().eq("client_id", clientId);
                  if (error) {
                    console.error(error);
                    alert(`Could not delete client data from ${table}. Check policies.`);
                    return;
                  }
                }

                const { error } = await supabase.from("clients").delete().eq("id", clientId);
                if (error) {
                  console.error(error);
                  alert("Could not delete client. Check policies.");
                  return;
                }

                const currentIndex = clients.findIndex((c) => c.id === clientId);
                const remainingClients = clients.filter((c) => c.id !== clientId);
                setClients(remainingClients);
                const nextClientId =
                  remainingClients[currentIndex]?.id ??
                  remainingClients[currentIndex - 1]?.id ??
                  remainingClients[0]?.id ??
                  null;
                changeClientId(nextClientId);

                if (!nextClientId) {
                  const today = new Date().toISOString().slice(0, 10);
                  setAccounts([]);
                  setActivity([]);
                  setBalances([]);
                  setMonths([]);
                  setAlloc({});
                  setAllocDate(today);
                  setCoaMap({});
                  setDrill(null);
                  setOcc([]);
                }
              }}
            >
              Delete Client
            </Button>
          </div>

          {/* controls */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-700">Horizon</label>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            >
              {[6, 9, 12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <label className="ml-2 text-sm text-slate-700">Start</label>
            <input
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            />
            <label className="ml-3 text-sm text-slate-700">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1"
            >
              <option value="total">Total balance</option>
              <option value="accounts">Individual accounts</option>
            </select>
          </div>

          {/* chart */}
          <Card title="Projected Ending Balances">
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis tickFormatter={(v) => money(Number(v))} width={90} />
                  <Tooltip formatter={(v: any) => money(Number(v))} />
                  <Legend />
                  {mode === "total" ? (
                    <Area type="monotone" dataKey="Total" stroke={BRAND.blue} fillOpacity={0.15} />
                  ) : (
                    accounts.map((a) => (
                      <Area
                        key={a.slug}
                        type="monotone"
                        dataKey={a.name}
                        stroke={a.color || "#64748b"}
                        fillOpacity={0.1}
                      />
                    ))
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ending balances table */}
          <div className="mt-4">
            <Card title="Ending Bank Balances (roll-forward)">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-3 py-2 text-left font-semibold">Row</th>
                      {months.map((m) => (
                        <th key={m} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                          {shortYM(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => (
                      <tr key={acc.slug} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{acc.name} (End)</td>
                        {months.map((m) => {
                          const row = balByMonth.get(m) || {};
                          const val = row[acc.slug] || 0;
                          return (
                            <td
                              key={m}
                              className="cursor-pointer px-3 py-2 text-right"
                              onClick={() => openDrill(acc.slug, m)}
                            >
                              {money(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* monthly activity table */}
          <div className="mt-4">
            <Card title="Monthly Activity (net movement)">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-3 py-2 text-left font-semibold">Account (net)</th>
                      {months.map((m) => (
                        <th key={m} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                          {shortYM(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((acc) => (
                      <tr key={acc.slug} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">{acc.name}</td>
                        {months.map((m) => {
                          const row = actByMonth.get(m) || {};
                          const val = row[acc.slug] || 0;
                          return (
                            <td
                              key={m}
                              className="cursor-pointer px-3 py-2 text-right"
                              onClick={() => openDrill(acc.slug, m)}
                            >
                              {money(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Beginning balance + Net activity = Ending balance.
              </p>
            </Card>
          </div>

          {/* settings (minimal — allocations only, dynamic) */}
          <div className="mt-6">
            <Card title="Settings — Allocation Targets">
              <div className="mb-3 flex items-center gap-3">
                <span className="text-sm text-slate-700">Effective date</span>
                <input
                  type="date"
                  className="rounded-md border border-slate-300 bg-white px-2 py-1"
                  value={allocDate}
                  onChange={(e) => setAllocDate(e.target.value)}
                />
                <span
                  className={`ml-auto rounded px-2 py-1 text-xs font-semibold ${
                    allocOk ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"
                  }`}
                >
                  Total: {(allocTotal * 100).toFixed(1)}%
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
                {accounts.map((a) => (
                  <div key={a.slug} className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">{a.name}</label>
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      max={1}
                      value={alloc[a.slug] ?? 0}
                      onChange={(e) =>
                        setAlloc((prev) => ({ ...prev, [a.slug]: Number(e.target.value) }))
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 flex gap-3">
                <Button
                  disabled={!clientId || !allocOk}
                  onClick={async () => {
                    if (!clientId || !allocOk) return;
                    await Promise.all(
                      accounts.map((a) =>
                        supabase.from("allocation_targets").upsert(
                          {
                            client_id: clientId,
                            effective_date: allocDate,
                            pf_slug: a.slug,
                            pct: alloc[a.slug] || 0,
                          },
                          { onConflict: "client_id, effective_date, pf_slug" }
                        )
                      )
                    );
                    alert("Allocations saved.");
                  }}
                  className={`!border-transparent !bg-[${BRAND.blue}] !text-white hover:opacity-90 ${
                    !allocOk ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                >
                  Save Allocations
                </Button>
                <Button
                  className="!border-slate-200"
                  onClick={() => location.reload()}
                >
                  Recalculate
                </Button>
                <Button
                  onClick={async () => {
                    if (!clientId) return;
                    const name = prompt("Add PF account (example: Truck)");
                    if (!name) return;
                    const slug = toSlug(name);
                    const { error } = await supabase.from("pf_accounts").insert({
                      client_id: clientId,
                      slug,
                      name,
                      sort_order: 100,
                      color: "#8b5cf6",
                    });
                    if (error) return alert("Could not add account. Check RLS.");
                    const { data: paf } = await supabase
                      .from("pf_accounts")
                      .select("slug, name, color, sort_order")
                      .eq("client_id", clientId)
                      .order("sort_order", { ascending: true })
                      .order("name", { ascending: true });
                    setAccounts((paf ?? []) as PFAccount[]);
                    setAlloc((p) => ({ ...p, [slug]: 0 }));
                  }}
                >
                  + Add Account
                </Button>
              </div>
            </Card>
          </div>

          {/* drill panel */}
          {drill && (
            <div className="fixed inset-0 z-40">
              <div className="absolute inset-0 bg-black/30" onClick={() => setDrill(null)} />
              <div className="absolute right-0 top-0 h-full w-full overflow-y-auto bg-white p-6 shadow-2xl sm:w-[520px]">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-800">
                    {accounts.find((a) => a.slug === drill.slug)?.name} • {shortYM(drill.ym)}
                  </h3>
                  <button className="text-slate-600" onClick={() => setDrill(null)}>
                    ✕
                  </button>
                </div>

                {/* load occurrences for this account/month */}
                <DrillTable
                  clientId={clientId!}
                  ym={drill.ym}
                  slug={drill.slug}
                  setOcc={setOcc}
                  occ={occ}
                  coaMap={coaMap}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </AppScaffold>
  );

}

// -------- helper components / functions --------
function filterMonths(all: string[], startYM: string, horizon: number) {
  const [y, m] = startYM.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const list = all
    .map((ym) => new Date(ym + "-01"))
    .filter((d) => d >= start)
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, horizon);
  return list.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
}

function DrillTable({
  clientId,
  ym,
  slug,
  setOcc,
  occ,
  coaMap,
}: {
  clientId: string;
  ym: string;
  slug: string;
  setOcc: (r: OccRow[]) => void;
  occ: OccRow[];
  coaMap: Record<string, string>;
}) {
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("v_proj_occurrences")
        .select("client_id, month_start, coa_account_id, kind, name, amount")
        .eq("client_id", clientId)
        .eq("month_start", ym + "-01");
      const filtered = (data ?? []).filter((r: any) => coaMap[r.coa_account_id] === slug);
      setOcc(filtered as OccRow[]);
    })();
  }, [clientId, ym, slug]);

  const inflows = occ.filter((r) => r.amount > 0);
  const outflows = occ.filter((r) => r.amount < 0);

  return (
    <div className="space-y-6">
      <Card title="Inflows">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1">Name</th>
              <th className="text-right py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inflows.length === 0 ? (
              <tr>
                <td className="py-2 text-slate-500" colSpan={2}>
                  No inflows
                </td>
              </tr>
            ) : (
              inflows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1">{r.name}</td>
                  <td className="py-1 text-right">{money(r.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card title="Outflows">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left py-1">Name</th>
              <th className="text-right py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {outflows.length === 0 ? (
              <tr>
                <td className="py-2 text-slate-500" colSpan={2}>
                  No outflows
                </td>
              </tr>
            ) : (
              outflows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1">{r.name}</td>
                  <td className="py-1 text-right">{money(r.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
