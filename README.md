# xEngine · 差分机

Injective EVM 测试网上的自然语言投保 dApp：诉求 → AI 风险问卷 → 检索 Polymarket →
compose 三档组合 → 钱包付 USDC 保费 → 预言机结算赔付。

本仓库为 monorepo，已**完整引入**本地 [WorldMonitor](worldmonitor/) 源码（非 submodule / 非 ignore），
用于 Agent / 政策页的全球情报上下文。

| 目录 | 说明 |
|------|------|
| `backend/` | FastAPI + Celery + AI / WorldMonitor 客户端 |
| `frontend/` | Vite + React（默认端口 `15432`） |
| `contracts/` | Foundry · PolicyVault |
| `worldmonitor/` | 自托管全球情报栈（Docker + host seed） |

实施计划见 [`PLAN.md`](PLAN.md)。WM 对接细节见 [`backend/ai/worldmonitor/LOCAL.md`](backend/ai/worldmonitor/LOCAL.md)。

---

## 前置依赖

- Docker / Docker Compose
- Node.js 20+（frontend + WM seed）
- Python 3.13+ 与 [uv](https://github.com/astral-sh/uv)
- 可用的 Supabase 项目（Postgres + Auth）
- （可选）Redis：Celery broker；**不要**与 WM 容器内 Redis 端口冲突（lemma 默认 `6379`，WM Redis 不映射到宿主机）

---

## 一键心智模型

```text
worldmonitor (Docker :17300)
        │  HTTP + X-WorldMonitor-Key
        ▼
backend  (uv · :18473)  ←→  Supabase / Celery Redis
        ▲
frontend (vite · :15432)
```

---

## 1. 克隆与配置

```bash
git clone <this-repo> lemma-ai
cd lemma-ai
```

### 1.1 Backend

```bash
cp backend/.env.example backend/.env
# 必填：SUPABASE_URL / DATABASE_URL / DEEPSEEK_API_KEY / REDIS_URL 等（见 .env.example）
# StepFun Realtime 语音代理另需 STEPFUN_API_KEY（见 backend/STEPFUN.md）

# 本地 WorldMonitor（推荐，免云端 Pro key）— 取消注释或写入：
# WORLDMONITOR_API_BASE_URL=http://localhost:17300
# WORLDMONITOR_API_KEY=lemma-local-dev-key
# WORLDMONITOR_TIMEOUT_SECONDS=15
# WORLDMONITOR_CACHE_TTL_SECONDS=120

cd backend && uv sync && uv run alembic upgrade head && cd ..
```

### 1.2 Frontend

```bash
cp frontend/.env.example frontend/.env
# VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_API_BASE_URL=http://127.0.0.1:18473

cd frontend && npm install && cd ..
```

### 1.3 WorldMonitor

```bash
cd worldmonitor
npm install
# 若 Docker 构建因 blog-site/node_modules 符号链接失败：rm -rf blog-site/node_modules

# 首次生成密钥（已有 .env 可跳过）
if [ ! -f .env ]; then
  cat > .env <<EOF
RELAY_SHARED_SECRET=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)
REDIS_TOKEN=$(openssl rand -hex 32)
WM_PORT=17300
WM_REDIS_REST_PORT=18079
UPSTASH_REDIS_REST_URL=http://127.0.0.1:18079
# P2 可选免费 key（仅 WM host seed；lemma backend 不使用）
FRED_API_KEY=
EIA_API_KEY=
FINNHUB_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
ALPHA_VANTAGE_API_KEY=
EOF
fi

# docker-compose.override.yml 已随仓提供：精简栈 + lemma-local-dev-key
cd ..
```

`WORLDMONITOR_API_KEY`（lemma）必须等于 `worldmonitor/docker-compose.override.yml` 里的 `WORLDMONITOR_VALID_KEYS`。

---

## 2. 启动 WorldMonitor（精简栈）

只起数采所需三个服务（**不要**默认起全家桶 / ais-relay）：

```bash
cd worldmonitor
docker compose up -d --build redis redis-rest worldmonitor
docker compose ps
# 仪表盘 / API: http://127.0.0.1:17300
```

| 服务 | 宿主机端口 |
|------|------------|
| WM HTTP | **17300** |
| Redis REST | **18079**（仅 127.0.0.1） |

### 2.1 Host 侧 seed（写入 Redis，供 bootstrap / RPC）

```bash
cd worldmonitor
set -a; . ./.env; set +a
export UPSTASH_REDIS_REST_URL=http://127.0.0.1:18079
export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"

# P1：无需第三方 key
node scripts/seed-fear-greed.mjs
node scripts/seed-prediction-markets.mjs
node scripts/seed-market-quotes.mjs
node scripts/seed-commodity-quotes.mjs
node scripts/seed-economy.mjs   # 无 FRED/EIA 时部分失败属预期；macroSignals 仍可能写入
```

验证：

```bash
curl -sS 'http://127.0.0.1:17300/api/health?compact=1' | head -c 200
curl -sS -H 'X-WorldMonitor-Key: lemma-local-dev-key' \
  'http://127.0.0.1:17300/api/market/v1/get-fear-greed-index' | head -c 300
```

`docker compose down -v` 会清空缓存，需重新 seed。

### 2.2（可选）P2 免费 API Key

写入 `worldmonitor/.env` 后重跑对应 seed：

| 变量 | 申请 | 解锁 |
|------|------|------|
| `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html | economy / FRED |
| `EIA_API_KEY` | https://www.eia.gov/opendata/ | 原油库存、气、SPR |
| `FINNHUB_API_KEY` | https://finnhub.io/ | 行情更稳（P1 Yahoo 已可用） |
| `GROQ_API_KEY` | https://console.groq.com/ | `seed-insights` |
| `OPENROUTER_API_KEY` | https://openrouter.ai/ | WM `seed-insights` 备用（非 lemma backend `AI_ROUTES_JSON`） |
| `ALPHA_VANTAGE_API_KEY` | https://www.alphavantage.co/support/#api-key | 行情 fallback |

```bash
node scripts/seed-economy.mjs
node scripts/seed-insights.mjs
```

可选实时船讯：在 `.env` 配 `AISSTREAM_API_KEY` 后  
`docker compose --profile full up -d ais-relay`（lemma 当前不依赖 AIS）。

---

## 3. 启动 lemma Backend + Worker

需要本机/远端 Redis（`REDIS_URL`，默认 `redis://localhost:6379/0`）：

```bash
cd backend
uv run python main.py
# 另开终端（worker 处理任务；beat 每 5 分钟扫描到期保单并触发预言机结算/赔付）：
uv run celery -A tasks.celery_app worker -l info
uv run celery -A tasks.celery_app beat -l info
```

API：http://127.0.0.1:18473 · Docs：http://127.0.0.1:18473/docs

校验 WM 接入：

```bash
cd backend
uv run python -c "import asyncio; from ai.worldmonitor import fetch_world_context as f; c=asyncio.run(f(force=True)); print(c.source, len(c.signals), c.fear_greed)"
# 期望：source=live，signals 明显大于 0
```

前端/Agent 经登录后调用 `GET /api/v1/world-context`（需 JWT）。

### 3.1 A2A Remote Agent

Public Agent Card + JSON-RPC（无鉴权）。在 `backend/.env` 配置：

```bash
export DEEPSEEK_API_KEY=...
export A2A_URL=http://127.0.0.1:18473/a2a
export A2A_SYSTEM_USER_ID=<uuid>   # full_system_task 用的服务账号
```

按上文启动 API + Celery worker。Card：`http://127.0.0.1:18473/.well-known/agent-card.json` · RPC：`POST /a2a`。

```bash
curl -sS http://127.0.0.1:18473/.well-known/agent-card.json | head
```

Skills：`factor_analysis` / `strategy_backtest` / `full_system_task` / `market_intelligence`（可用 `[skill:…]` 提示）。

---

## 4. 启动 Frontend

```bash
cd frontend
npm run dev
# http://127.0.0.1:15432
```

政策规划页的「全球上下文」面板会拉取 WorldMonitor 快照。

---

## 5. 常用端口一览

| 服务 | 端口 |
|------|------|
| Frontend (Vite) | 15432 |
| Backend API | 18473 |
| WorldMonitor HTTP | 17300 |
| WorldMonitor Redis REST | 18079 |
| Celery Redis（宿主机） | 6379 |

---

## 6. 合约（可选）

见 `contracts/` 与 [`PLAN.md`](PLAN.md)。Foundry 工具链可装在 `/.foundry/`（已 gitignore）。

---

## 上游与许可

- `worldmonitor/` 源自 https://github.com/koala73/worldmonitor （导入记录见 `worldmonitor/UPSTREAM.md`），遵循其仓库 LICENSE。
- lemma-ai 业务代码按本仓约定维护；升级 WM 时对比上游 commit，手工合并进 `worldmonitor/`。
