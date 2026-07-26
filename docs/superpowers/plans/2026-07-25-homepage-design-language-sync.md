# Homepage Design Language Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `raw-proj/frontend` 的锌灰设计语言同步到 lemma-ai：全站 token、短公开落地页、Chat-first `/home`，并复用现有 ChatInput / ActionChip / CircularProgress / HomeUserMenu。

**Architecture:** 以 `frontend/src/index.css` 为事实源，将 shadcn token 从 Units 奶油纸改为源项目 HSL 锌灰；关键页面（Landing、Home、AppLayout、Login）手改构图与类名；`--units-*` 保留短期别名以免 journey/vault 等页炸掉。业务路由与发送链路不变（`/tasks/new` + `agentTaskLaunch`）。

**Tech Stack:** Vite 8 · React 19 · React Router 7 · Tailwind CSS v4 · shadcn/ui · lucide-react · 现有 `@/` 组件

**Spec:** `docs/superpowers/specs/2026-07-25-homepage-design-language-sync-design.md`

## Global Constraints

- 全站 token 对齐源项目锌灰；Units 奶油纸退场；橙 ring 去掉
- `/home`：居中对话为主；右上角 CircularProgress + HomeUserMenu；四枚 chips 作次级入口；不嵌仪表盘
- `/`：短落地（品牌 + 主张 + CTA + 单行流程）；无 Dither / BubbleMenu / 七色大卡 / UnitsWorldMap
- 发送仍走 `navigate('/tasks/new', { state: { agentTaskLaunch } })`，工具 `policy_planning`
- 不搬学习/课程业务；不新建保单看板独立页；不改后端
- 标题文案固定：「想保障什么？」；副文：「描述风险、粘贴事件，或直接问 Agent 开始规划。」
- 验证以 `cd frontend && npm run build` + 手动目视为准（仓库无 UI 单测框架）
- 提交信息用英文 conventional commits；`docs/` 被 gitignore，文档用 `git add -f`

---

## File Map

| 文件 | 职责 |
|---|---|
| `frontend/src/index.css` | 锌灰 token、字体栈、units 别名、`units-app-panel`/`units-cta` 改 zinc |
| `frontend/index.html` | 去掉 Space Grotesk Google Fonts，改 Inter（或仅 Noto Sans SC） |
| `frontend/src/main.tsx` | 去掉 `@fontsource/space-grotesk`；可选加 Inter |
| `frontend/src/layouts/AppLayout.tsx` | 锌灰壳、「发起投保」primary、「首页」标签、移动底栏去橙 |
| `frontend/src/components/ActionChip.tsx` | 去 `units-*`，zinc outline |
| `frontend/src/components/CircularProgress.tsx` | 默认色脱离 `--units-*` |
| `frontend/src/features/home/ChatInput.tsx` | 视觉对齐源项目 zinc（保留 policy_planning） |
| `frontend/src/mock/homeSuggestions.ts` | 投保向四枚 chip 数据 |
| `frontend/src/pages/HomePage.tsx` | Chat-first 重写 |
| `frontend/src/pages/LandingPage.tsx` | 短落地重写 |
| `frontend/src/pages/LoginPage.tsx` | 去掉 Dither，跟 token |
| `frontend/src/features/home/HomeUserMenu.tsx` | 默认头像色脱离 `--units-orange` |

**本轮保留但不在 `/home` 引用：** `HomeHeroSection`、`HomeDashboardMetrics`、`HomePolicyWorkspace`、`HomeDashboardSidebar`（勿删，避免扩大 diff；仅停止 import）。

---

### Task 1: 全站 Token + 字体栈

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/index.html`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: 源项目 `raw-proj/frontend/src/index.css` `:root` / `.dark` / `@theme`（HSL 分量）
- Produces: shadcn 变量为 HSL 分量；`@theme` 用 `hsl(var(--*))`；`--units-*` 短期别名仍可用

- [ ] **Step 1: 记录当前破版基线（应失败的检查）**

在 `frontend/` 运行：

```bash
rg -n "f4e9e1|--ring: var\\(--units-orange\\)" src/index.css | head
```

Expected: 能命中奶油纸 / 橙 ring（证明尚未迁移）。

- [ ] **Step 2: 替换 `:root` / `.dark` shadcn token 为源项目 HSL**

在 `frontend/src/index.css`，将映射到 Units 的 `--background` 等改为源项目值。保留上方强调色变量作 chip/chart，但 **切断** shadcn 对 cream 的依赖。

`:root` 核心（写入文件时与源项目一致）：

```css
:root {
  /* 强调色：仅 chip / chart 点缀，不作页面主背景 */
  --units-blue: #1677df;
  --units-yellow: #ffb20f;
  --units-orange: #ff5a18;
  --units-red: #ef3f3f;
  --units-green: #00ae45;
  --units-lilac: #b785ef;
  --units-gutter: clamp(0.65rem, 1vw, 1rem);
  --units-radius: 0.875rem;
  --units-radius-sm: calc(var(--units-radius) - 2px);
  --units-radius-lg: calc(var(--units-radius) + 4px);
  --units-ease: cubic-bezier(0.19, 1, 0.22, 1);
  --units-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --units-duration: 0.7s;
  --units-duration-fast: 0.35s;
  --units-duration-med: 0.5s;
  --units-stroke: 1px;
  --units-on-accent: #ffffff;

  /* 短期别名 → 锌灰，降低旧 var(--units-*) 炸掉 */
  --units-cream: hsl(0 0% 100%);
  --units-black: hsl(224 71% 4%);
  --units-soft: hsl(220 14% 96%);
  --units-brand-plate: hsl(0 0% 100%);
  --units-wash: hsl(220 14% 96% / 0.45);
  --units-wash-strong: hsl(220 14% 96% / 0.72);
  --units-ink-muted: hsl(220 9% 46%);
  --units-inverse-fg: hsl(210 20% 98%);
  --units-inverse-bg: hsl(220 13% 14%);
  --units-stroke-color: hsl(220 13% 91%);
  --units-stroke-strong: hsl(220 13% 84%);

  --background: 0 0% 100%;
  --foreground: 224 71% 4%;
  --card: 0 0% 100%;
  --card-foreground: 224 71% 4%;
  --popover: 0 0% 100%;
  --popover-foreground: 224 71% 4%;
  --primary: 220 13% 14%;
  --primary-foreground: 210 20% 98%;
  --secondary: 220 14% 96%;
  --secondary-foreground: 220 13% 14%;
  --muted: 220 14% 96%;
  --muted-foreground: 220 9% 46%;
  --accent: 220 14% 96%;
  --accent-foreground: 220 13% 14%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 210 20% 98%;
  --border: 220 13% 91%;
  --input: 220 13% 91%;
  --ring: 220 13% 14%;
  --sidebar: 220 14% 96%;
  --sidebar-foreground: 220 13% 14%;
  --sidebar-border: 220 13% 91%;
  --radius: 0.875rem;
  --chart-1: var(--units-blue);
  --chart-2: var(--units-orange);
  --chart-3: var(--units-green);
  --chart-4: var(--units-yellow);
  --chart-5: var(--units-lilac);
  --sidebar-primary: 220 13% 14%;
  --sidebar-primary-foreground: 210 20% 98%;
  --sidebar-accent: 220 14% 96%;
  --sidebar-accent-foreground: 220 13% 14%;
  --sidebar-ring: 220 13% 14%;
  --shadow-card: none;
  color-scheme: light;
}
```

`.dark` 使用源项目 `.dark` 的 HSL 表；把 `--units-cream` / `--units-black` / `--units-soft` / stroke 别名改成暗色等价（cream→近黑面板，black→浅字），**不要**再把 `--background` 指回 cream hex。

- [ ] **Step 3: 修正 `@theme inline` 为 `hsl(var(--*))`**

把：

```css
--color-background: var(--background);
```

改为：

```css
--color-background: hsl(var(--background));
```

对 `foreground` / `card` / `primary` / `secondary` / `muted` / `accent` / `destructive` / `border` / `input` / `ring` / `sidebar*`（HSL 分量项）全部同样处理。`chart-*` 若仍是 hex/`var(--units-*)` 颜色，保持 `var(--chart-1)` 即可。

字体：

```css
--font-sans: "Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", ui-sans-serif, system-ui, sans-serif;
--font-display: "Inter", "Noto Sans SC", "Microsoft YaHei UI", ui-sans-serif, system-ui, sans-serif;
```

- [ ] **Step 4: 改 base 层 + 面板工具类**

```css
@layer base {
  * {
    @apply border-border;
  }

  html {
    scroll-behavior: smooth;
    background: hsl(var(--background));
  }

  body {
    @apply bg-background text-foreground antialiased;
    font-family: var(--font-sans);
    font-variant-numeric: tabular-nums;
    margin: 0;
  }

  h1,
  h2,
  h3,
  .font-display {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }

  #root {
    @apply min-h-screen;
  }

  ::selection {
    color: hsl(var(--primary-foreground));
    background: hsl(var(--primary));
  }
}

@utility units-app-panel {
  border-radius: var(--radius);
  border: 1px solid hsl(var(--border) / 0.8);
  background: hsl(220 14% 98%); /* zinc-50 近似；dark 下见下 */
  box-shadow: none;
}

.dark .units-app-panel {
  background: hsl(var(--card));
  border-color: hsl(var(--border));
}
```

将 `.units-cta` 改为深锌灰实心（无黄扫光）：

```css
.units-cta {
  position: relative;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.units-cta:hover {
  background: hsl(220 13% 20%);
}
```

（若原文件有 `::before` 黄扫光，删除。）

`units-plate-hover` 保留结构，但 hover 边框改用 `hsl(var(--border))` / 略深 zinc，去掉奶油纸强对比依赖。

- [ ] **Step 5: 更新 `index.html` 与 `main.tsx` 字体加载**

`frontend/index.html` 的 Google Fonts link 改为：

```html
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

`frontend/src/main.tsx`：删除全部 `@fontsource/space-grotesk/*` import；保留 Noto Sans SC。若希望离线一致，可 `npm i @fontsource/inter` 并 import 400/500/600/700——可选，不强制（CDN + 系统回退即可）。

- [ ] **Step 6: 验证 token 迁移**

```bash
cd frontend
rg -n "f4e9e1|--ring: var\\(--units-orange\\)" src/index.css
npm run build
```

Expected:
- `rg` 无奶油纸 / 橙 ring 命中（或仅出现在注释）
- `build` 成功（`tsc -b && vite build` exit 0）

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/index.html frontend/src/main.tsx
# 若安装了 @fontsource/inter：
# git add frontend/package.json frontend/package-lock.json
git commit -m "$(cat <<'EOF'
feat(ui): switch global tokens to zinc palette

Replace Units cream-paper shadcn tokens with source HSL zinc
values and Inter/Noto stack, keeping units-* aliases for compat.
EOF
)"
```

---

### Task 2: App 壳层锌灰化

**Files:**
- Modify: `frontend/src/layouts/AppLayout.tsx`

**Interfaces:**
- Consumes: Task 1 的 `primary` / `border` / `background` token
- Produces: 锌灰外框；侧栏「首页」；主 CTA 与移动底栏无橙强调

- [ ] **Step 1: 改 `SidebarHeader` 与「发起投保」按钮**

将品牌行去掉 `text-units-orange`；「发起投保」改为：

```tsx
<Button
  asChild
  variant="default"
  className="w-full justify-center gap-2 font-semibold shadow-none"
>
  <Link to="/tasks/new">
    <PlusCircle className="size-[18px]" strokeWidth={2} />
    发起投保
  </Link>
</Button>
```

外层壳：

```tsx
<div className="flex h-[100dvh] gap-2 overflow-hidden bg-zinc-100 p-2 pb-[4.75rem] text-foreground [--sidebar-width:240px] md:pb-2">
```

侧栏 sticky 背景用 `bg-zinc-100`（与源项目一致），或 `bg-transparent` 露出外框色。

- [ ] **Step 2: 侧栏文案「保单看板」→「首页」**

```tsx
<SidebarItem icon={Home} label="首页" to="/home" end badge={attentionCount} />
```

- [ ] **Step 3: 移动底栏去橙**

`primary` 中心钮：

```tsx
<span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-none">
  <item.icon className="size-5" strokeWidth={2.4} />
</span>
```

底栏容器：

```tsx
className="fixed inset-x-2 bottom-2 z-50 grid h-16 grid-cols-4 items-center rounded-xl border border-zinc-200/80 bg-background/95 px-1.5 shadow-none backdrop-blur-xl md:hidden"
```

活跃态：`text-foreground`（或 `text-primary`），不要 `text-[var(--units-orange)]`。

- [ ] **Step 4: 验证**

```bash
cd frontend
rg -n "units-orange" src/layouts/AppLayout.tsx
npm run build
```

Expected: `AppLayout.tsx` 无 `units-orange`；build 通过。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/layouts/AppLayout.tsx
git commit -m "$(cat <<'EOF'
feat(ui): align AppLayout shell with zinc chrome

Use zinc-100 frame, primary CTAs, and rename sidebar home label.
EOF
)"
```

---

### Task 3: 共享控件去 Units 硬编码

**Files:**
- Modify: `frontend/src/components/ActionChip.tsx`
- Modify: `frontend/src/components/CircularProgress.tsx`
- Modify: `frontend/src/features/home/ChatInput.tsx`
- Modify: `frontend/src/features/home/HomeUserMenu.tsx`

**Interfaces:**
- Consumes: Task 1 tokens
- Produces: zinc 风格 ActionChip / CircularProgress / ChatInput；HomeUserMenu 默认头像色中性

- [ ] **Step 1: 改写 `ActionChip`**

```tsx
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ActionChipProps {
  icon: LucideIcon
  iconColor: string
  label: string
  onClick?: () => void
  badge?: number
  accent?: string
}

export function ActionChip({
  icon: Icon,
  iconColor,
  label,
  onClick,
  badge,
  accent,
}: ActionChipProps) {
  const showBadge = typeof badge === 'number' && badge > 0
  const badgeColor = accent ?? iconColor

  return (
    <Button
      variant="outline"
      onClick={onClick}
      className={cn(
        'h-8 gap-1.5 rounded-full border-zinc-200 bg-white px-4 font-normal text-zinc-900 shadow-none hover:bg-zinc-50',
        showBadge && 'pr-2.5'
      )}
    >
      <Icon className="size-4" style={{ color: iconColor }} />
      {label}
      {showBadge ? (
        <span
          className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: badgeColor }}
        >
          {badge}
        </span>
      ) : null}
    </Button>
  )
}
```

- [ ] **Step 2: 改 `CircularProgress` 默认色**

```tsx
trackColor = 'transparent',
progressColor = '#10b981',
```

（与源项目首页日程环一致；调用方可覆盖。）

- [ ] **Step 3: 对齐 `ChatInput` 视觉到源项目 zinc**

保留 `policy_planning` 与差分机徽章；边框/发送钮用显式 zinc：

```tsx
'flex flex-col rounded-[26px] border border-zinc-200 bg-white'
```

textarea：`text-zinc-900` / `placeholder:text-zinc-400`

发送钮：

```tsx
hasContent
  ? 'bg-zinc-900 text-white hover:bg-zinc-800'
  : 'cursor-default bg-zinc-200 text-zinc-400'
```

- [ ] **Step 4: `HomeUserMenu` 默认色**

```tsx
const displayColor = currentUser?.avatarColor ?? '#71717a' // zinc-500
```

扫掉该文件中剩余 `var(--units-orange)`（若有）。

- [ ] **Step 5: 验证**

```bash
cd frontend
rg -n "units-" src/components/ActionChip.tsx src/components/CircularProgress.tsx src/features/home/ChatInput.tsx src/features/home/HomeUserMenu.tsx
npm run build
```

Expected: 上述文件无 `units-` 命中；build 通过。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ActionChip.tsx \
  frontend/src/components/CircularProgress.tsx \
  frontend/src/features/home/ChatInput.tsx \
  frontend/src/features/home/HomeUserMenu.tsx
git commit -m "$(cat <<'EOF'
feat(ui): restyle home shared controls in zinc

Align ActionChip, CircularProgress, ChatInput, and avatar
defaults with the source homepage vocabulary.
EOF
)"
```

---

### Task 4: Chat-first `/home`

**Files:**
- Create: `frontend/src/mock/homeSuggestions.ts`
- Modify: `frontend/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `ChatInput.onSend(text, options?)`；`ActionChip`；`CircularProgress`；`HomeUserMenu`；`usePoliciesQuery`（仅供日程 badge）
- Produces: 居中首页；chips 导航到 `/tasks/new` | `/collection` | `/vault` | `/schedule`

- [ ] **Step 1: 新建投保向 suggestions**

创建 `frontend/src/mock/homeSuggestions.ts`：

```ts
import {
  CalendarDays,
  Gem,
  ShieldPlus,
  Vault,
} from 'lucide-react'

export const homeSuggestions = [
  {
    id: 'new-policy',
    icon: ShieldPlus,
    iconColor: '#EA8444',
    label: '新建保障',
    to: '/tasks/new',
  },
  {
    id: 'collection',
    icon: Gem,
    iconColor: '#4A90D9',
    label: 'NFT 藏品',
    to: '/collection',
  },
  {
    id: 'vault',
    icon: Vault,
    iconColor: '#4CAF50',
    label: '承保池',
    to: '/vault',
  },
  {
    id: 'schedule',
    icon: CalendarDays,
    iconColor: '#9C5EC7',
    label: '日程',
    to: '/schedule',
  },
] as const
```

- [ ] **Step 2: 重写 `HomePage.tsx`**

完整替换为 Chat-first（保留发送链路与待结算 badge）：

```tsx
import { CalendarCheck2, CalendarClock } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { ActionChip } from '@/components/ActionChip'
import { CircularProgress } from '@/components/CircularProgress'
import { Button } from '@/components/ui/button'
import { ChatInput } from '@/features/home/ChatInput'
import { HomeUserMenu } from '@/features/home/HomeUserMenu'
import { usePoliciesQuery } from '@/features/policy/policyApi'
import {
  isCoverageExpired,
  useReferenceTime,
} from '@/features/policy/policyStatus'
import { homeSuggestions } from '@/mock/homeSuggestions'

export function HomePage() {
  const navigate = useNavigate()
  const policiesQuery = usePoliciesQuery()
  const nowMs = useReferenceTime()

  const pendingSettle = useMemo(() => {
    const policies = policiesQuery.data ?? []
    return policies.filter(
      (policy) =>
        policy.status === 'active' && isCoverageExpired(policy.coverageEnd, nowMs)
    ).length
  }, [nowMs, policiesQuery.data])

  // Placeholder until schedule completion API exists.
  const todayTaskProgress = 40
  const isAllTasksDone = todayTaskProgress >= 100
  const TaskIcon = isAllTasksDone ? CalendarCheck2 : CalendarClock

  const handleSend = (text: string) => {
    navigate('/tasks/new', {
      state: {
        agentTaskLaunch: {
          goalText: text,
          displayText: text,
          clientRequestId: crypto.randomUUID(),
        },
      },
    })
  }

  return (
    <div className="relative h-full overflow-y-auto rounded-md border border-zinc-200/80 bg-zinc-50">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <Button
          variant="ghost"
          aria-label="今日日程进度"
          className="relative size-8 rounded-full p-0"
          onClick={() => navigate('/schedule')}
        >
          <CircularProgress
            value={todayTaskProgress}
            size={32}
            strokeWidth={1.5}
            trackColor="transparent"
            className="pointer-events-none absolute inset-0 size-8"
          />
          <TaskIcon className="size-[18px]" />
        </Button>
        <HomeUserMenu />
      </div>

      <div className="flex h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              想保障什么？
            </h1>
            <p className="text-sm text-zinc-500">
              描述风险、粘贴事件，或直接问 Agent 开始规划。
            </p>
          </div>

          <ChatInput onSend={handleSend} />

          <div className="flex flex-wrap justify-center gap-2">
            {homeSuggestions.map((item) => (
              <ActionChip
                key={item.id}
                icon={item.icon}
                iconColor={item.iconColor}
                label={item.label}
                badge={item.id === 'schedule' ? pendingSettle : undefined}
                onClick={() => navigate(item.to)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
```

确认：不再 import `HomeHeroSection` / Metrics / Workspace / Sidebar / `AgentInputPayload`。

- [ ] **Step 3: 验证**

```bash
cd frontend
rg -n "HomeHeroSection|HomeDashboardMetrics|HomePolicyWorkspace|HomeDashboardSidebar|units-app-panel" src/pages/HomePage.tsx
npm run build
```

Expected: 无上述命中；build 通过。

手动（`npm run dev`，已登录）：
1. `/home` 居中标题 + 大圆角输入 + 四 chips
2. 输入发送 → 进入 `/tasks/new` 且带 launch state
3. 点「日程」/ 圆环 → `/schedule`；点「承保池」→ `/vault`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/mock/homeSuggestions.ts frontend/src/pages/HomePage.tsx
git commit -m "$(cat <<'EOF'
feat(home): rebuild /home as chat-first zinc entry

Center ChatInput with insurance suggestion chips and keep
schedule progress plus user menu in the top-right.
EOF
)"
```

---

### Task 5: 短落地页 `/`

**Files:**
- Modify: `frontend/src/pages/LandingPage.tsx`

**Interfaces:**
- Consumes: `useAuth`、`Link`/`Navigate`
- Produces: 短品牌落地；无 Dither / BubbleMenu / UnitsWorldMap / 七色卡

- [ ] **Step 1: 用以下结构替换 `LandingPage.tsx`**

```tsx
import { Link, Navigate, useLocation } from 'react-router-dom'

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
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5 md:px-10">
        <span className="text-sm font-semibold tracking-tight">差分机</span>
        <Link
          to="/login"
          state={location.state}
          className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
        >
          登录
        </Link>
      </header>

      <section className="mx-auto flex min-h-[72vh] w-full max-w-5xl flex-col justify-center px-6 py-16 md:px-10">
        <p className="text-xs font-medium tracking-wide text-zinc-500">
          Difference Engine
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
          差分机
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

      <section className="border-t border-zinc-200/80 bg-white">
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
```

- [ ] **Step 2: 验证**

```bash
cd frontend
rg -n "DitherBackground|BubbleMenu|UnitsWorldMap|units-|SERVICES" src/pages/LandingPage.tsx
npm run build
```

Expected: 无命中；build 通过。

手动（未登录）：打开 `/` 见短品牌页；点「登录开始」→ `/login`；已登录访问 `/` → `/home`。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LandingPage.tsx
git commit -m "$(cat <<'EOF'
feat(landing): replace marketing page with short zinc hero

Drop Dither, BubbleMenu, and service plates for a brand-first
landing with a single flow strip.
EOF
)"
```

---

### Task 6: 登录页去 Dither + 跟色

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/features/auth/LoginForm.tsx`（仅当仍有 `units-cta` / 橙硬编码时）

**Interfaces:**
- Consumes: Task 1 tokens
- Produces: 无 Dither 的简洁登录页

- [ ] **Step 1: 从 `LoginPage` 移除 `DitherBackground`**

loading 与主视图都只用 `bg-background`（或 `bg-zinc-50`）。标题用：

```tsx
<Link to="/" className="text-xl font-semibold tracking-tight text-foreground">
  差分机
</Link>
<p className="mt-2 text-sm text-muted-foreground">
  登录后继续把风险变成链上保障
</p>
```

删除 `DitherBackground` import。

- [ ] **Step 2: 检查 `LoginForm` CTA**

若提交按钮使用 `units-cta`，改为：

```tsx
className="w-full bg-zinc-900 text-white hover:bg-zinc-800"
```

或 `variant="default"`（依赖 Task 1 primary）。

- [ ] **Step 3: 验证**

```bash
cd frontend
rg -n "DitherBackground|units-" src/pages/LoginPage.tsx src/features/auth/LoginForm.tsx
npm run build
```

Expected: LoginPage 无 Dither；LoginForm 无 units 硬编码（或仅可接受的中性类）；build 通过。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/features/auth/LoginForm.tsx
git commit -m "$(cat <<'EOF'
feat(auth): drop login dither and follow zinc tokens

Keep a calm centered login that matches the new landing shell.
EOF
)"
```

---

### Task 7: 回归扫尾 + 验收

**Files:**
- Modify only if build/visual 暴露破版：优先改仍写死奶油纸/`#f4e9e1`/`units-orange` 作主背景的关键壳层；**不要**为本任务大面积重写 journey

**Interfaces:**
- Consumes: Tasks 1–6
- Produces: 满足 spec 验收清单

- [ ] **Step 1: 全仓危险模式扫描**

```bash
cd frontend
rg -n "#f4e9e1|units-orange|units-cream" src --glob '!**/index.css' | head -60
npm run build
```

对 **明显破主背景** 的页面（如仍 `bg-[var(--units-cream)]` 且别名不够）做最小 class 替换为 `bg-background` / `bg-zinc-50`。Vault 的 Dither **本轮可不删**（spec 非目标），除非严重刺眼再关。

- [ ] **Step 2: 手工验收清单（对照 spec §6）**

| # | 检查 | 期望 |
|---|---|---|
| 1 | 未登录 `/` | 短品牌 + CTA + 单行流程；无 Dither/BubbleMenu/七色卡 |
| 2 | 登录 `/home` | 居中输入 + 4 chips + 右上日程/菜单；锌灰面板 |
| 3 | 侧栏 | 「首页」；「发起投保」深锌灰 |
| 4 | `/home` 发送 | 进入 `/tasks/new` 带 `agentTaskLaunch` |
| 5 | chips | 藏品/金库/日程可达 |
| 6 | 任意认证页 | 无奶油纸底 + 橙 ring 主调 |

- [ ] **Step 3: 若有扫尾改动则 Commit**

```bash
git add -u frontend/src
git commit -m "$(cat <<'EOF'
fix(ui): mop up remaining cream/orange shell leftovers

Minimal class remaps so auth routes stay readable after the
zinc token cutover.
EOF
)"
```

若无改动则跳过 commit。

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|---|---|
| 全站 HSL 锌灰 token + ring | Task 1 |
| Units 短期别名 | Task 1 |
| 字体 Inter + Noto Sans SC | Task 1 |
| AppLayout 锌灰壳 / 首页标签 / primary CTA | Task 2 |
| ActionChip / CircularProgress / ChatInput / HomeUserMenu | Task 3 |
| `/home` Chat-first + chips + 右上角 | Task 4 |
| 发送 → `/tasks/new` | Task 4 |
| 短落地 `/` | Task 5 |
| 登录去 Dither | Task 6 |
| 验收 / 回归 | Task 7 |
| 不删 dashboard 文件、不新建看板页、不搬课程 | 显式非目标（File Map + Global Constraints） |

## Self-Review Notes

- 无 TBD/TODO 占位；各任务含可运行命令与期望结果
- `ChatInput.onSend` 在 Task 4 只传 `text`（组件内部仍附带 `policy_planning`）——与现有 `ChatInput` 签名一致
- Token 从 hex 改为 HSL 分量时，**必须**同步改 `@theme` 为 `hsl(var(--*))`，否则颜色全坏
- `docs/` 提交需 `git add -f`（本计划文件同）
