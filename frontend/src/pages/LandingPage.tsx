import { Link, Navigate, useLocation } from 'react-router-dom'

import { SideRays } from '@/components/backgrounds/SideRays'
import { useAuth } from '@/features/auth/useAuth'

const FLOW = ['诉求', '问卷', '检索', '方案', '链上', 'NFT', '结算'] as const

export function LandingPage() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <div aria-busy="true" className="min-h-screen bg-background" />
  }

  if (status === 'authed') {
    return <Navigate to="/home" replace />
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-50 text-zinc-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[72vh] motion-reduce:hidden"
      >
        <SideRays
          speed={0.6}
          rayColor1="#EAB308"
          rayColor2="#96c8ff"
          intensity={0.5}
          spread={1.4}
          origin="top-right"
          saturation={1.1}
          blend={0.6}
          falloff={1.8}
          opacity={0.35}
        />
      </div>
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 md:px-10">
        <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <img src="/logo.svg" alt="" className="size-6 rounded-[6px]" />
          xEngine
        </span>
        <Link
          to="/login"
          state={location.state}
          className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
        >
          登录
        </Link>
      </header>

      <section className="relative mx-auto flex min-h-[72vh] w-full max-w-5xl flex-col justify-center px-6 py-16 md:px-10">
        <img
          src="/logo.svg"
          alt=""
          className="size-14 rounded-[14px] md:size-16 md:rounded-[16px]"
        />
        <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
          xEngine
        </h1>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-zinc-500">
          把一句担忧变成可执行的链上保障。
        </p>
        <div className="mt-8">
          <Link
            to="/login"
            state={location.state}
            className="inline-flex h-11 items-center rounded-full bg-zinc-900 px-6 text-sm font-semibold text-white transition-colors hover:bg-zinc-800"
          >
            登录开始
          </Link>
        </div>
      </section>

      <section className="relative border-t border-zinc-200/80 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-12 md:px-10">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
            投保闭环
          </h2>
          <ol className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
            {FLOW.map((step, index) => (
              <li key={step} className="flex list-none items-center gap-2">
                <span className="inline-flex h-9 items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 font-medium text-zinc-800">
                  <span className="mr-2 text-zinc-400">{index + 1}</span>
                  {step}
                </span>
                {index < FLOW.length - 1 ? (
                  <span aria-hidden className="text-zinc-300">
                    →
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  )
}
