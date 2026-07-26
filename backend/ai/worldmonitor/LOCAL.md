# 本地 WorldMonitor 数采对接（精简栈）

lemma-ai 通过 HTTP 消费 WorldMonitor（WM），**不必**购买云端 Pro `wm_` key。  
推荐旁路启动 **最小 Docker 服务**（不含 `ais-relay`），用 host 侧 seed 写入 Redis，再用本地 enterprise key 解锁 Fear&Greed / risk RPC。

WM 源码已完整引入本仓：`worldmonitor/`（上游说明见该目录 `SELF_HOSTING.md` / `UPSTREAM.md`）。  
仓库级启动流程见根目录 [`README.md`](../../../README.md)。

## 结论速览

| 能力 | 云端无 key | 本地精简 Docker + seed | 本地 + `WORLDMONITOR_VALID_KEYS` |
|------|------------|------------------------|----------------------------------|
| `/api/health` | ✅ | ✅ | ✅ |
| `/api/bootstrap?tier=fast&public=1` | ✅（云端缓存） | ✅（依赖本地 seed） | ✅ |
| Fear & Greed RPC | ❌ | ❌（仍需 key） | ✅ |
| `get-risk-scores` RPC | ❌ | ❌（bootstrap 可有 stale 快照） | ✅ |

## 端口约定（非常用）

| 服务 | 宿主机端口 | 说明 |
|------|------------|------|
| WM HTTP（nginx→API） | **17300** | `WM_PORT`（勿用 3000） |
| Redis REST（仅 127.0.0.1） | **18079** | `WM_REDIS_REST_PORT`（勿用 8079） |

## 精简原则：只启数采所需容器

| 服务 | 是否启动 | 原因 |
|------|----------|------|
| `redis` | ✅ 必需 | 缓存 |
| `redis-rest` | ✅ 必需 | host seed / 容器 API 读写 |
| `worldmonitor` | ✅ 必需 | HTTP：health / bootstrap / RPC |
| `ais-relay` | ❌ 默认不启 | 需 `AISSTREAM_API_KEY`；lemma 不依赖 AIS 实时流 |

`ais-relay` 挂在 compose profile `full`；需要时再：

```bash
docker compose --profile full up -d ais-relay
```

## 1. 启动精简栈

```bash
cd worldmonitor   # 仓库根目录下
npm install
# 若 Docker Desktop/WSL 构建因 blog-site/node_modules 符号链接失败：
#   rm -rf blog-site/node_modules

# 首次：从示例生成 .env（已有则跳过）
# 详见仓库根 README「WorldMonitor」一节

docker compose up -d --build redis redis-rest worldmonitor
```

仪表盘 / API：http://127.0.0.1:17300

## 2. Host 侧精简 seed

```bash
cd worldmonitor
set -a; . ./.env; set +a
export UPSTASH_REDIS_REST_URL=http://127.0.0.1:18079
export UPSTASH_REDIS_REST_TOKEN="$REDIS_TOKEN"

# P1 — 无第三方 key（Yahoo / Polymarket / Kalshi）
node scripts/seed-fear-greed.mjs
node scripts/seed-prediction-markets.mjs
node scripts/seed-market-quotes.mjs
node scripts/seed-commodity-quotes.mjs
node scripts/seed-economy.mjs   # 无 FRED/EIA 时部分 FAIL，macroSignals 仍可写入

# P2 — 配齐免费 key 后
# node scripts/seed-economy.mjs
# node scripts/seed-insights.mjs
```

## 3. 配置 lemma-ai

`backend/.env`：

```bash
WORLDMONITOR_API_BASE_URL=http://localhost:17300
WORLDMONITOR_API_KEY=lemma-local-dev-key
WORLDMONITOR_TIMEOUT_SECONDS=15
WORLDMONITOR_CACHE_TTL_SECONDS=120
```

须与 `worldmonitor/docker-compose.override.yml` 中 `WORLDMONITOR_VALID_KEYS` 一致。

## 3b. P2 API Key

| 变量 | 用途 | 申请地址 |
|------|------|----------|
| `FRED_API_KEY` | `seed-economy` FRED | https://fred.stlouisfed.org/docs/api/api_key.html |
| `EIA_API_KEY` | 原油库存、气、SPR | https://www.eia.gov/opendata/ |
| `FINNHUB_API_KEY` | 行情更稳（可选） | https://finnhub.io/ |
| `GROQ_API_KEY` | `seed-insights` 主 LLM | https://console.groq.com/ |
| `OPENROUTER_API_KEY` | insights 备用 | https://openrouter.ai/ |
| `ALPHA_VANTAGE_API_KEY` | 行情 fallback（可选） | https://www.alphavantage.co/support/#api-key |

写入：`worldmonitor/.env`（gitignored）。填好后重跑 `seed-economy.mjs` / `seed-insights.mjs`。

## 4. 架构要点

- 本地 `WORLDMONITOR_VALID_KEYS`：operator enterprise key（非云端 `wm_`）。
- 数采：host `scripts/seed-*.mjs` → Redis REST(`:18079`) → `worldmonitor` HTTP。
- lemma **不要**直连 Redis，走 `ai/worldmonitor/client.py`。

## 5. 验证

```bash
curl -sS 'http://127.0.0.1:17300/api/health?compact=1' | head -c 200
curl -sS -H 'X-WorldMonitor-Key: lemma-local-dev-key' \
  'http://127.0.0.1:17300/api/market/v1/get-fear-greed-index' | head -c 300

cd backend && uv run python -c \
  "import asyncio; from ai.worldmonitor import fetch_world_context as f; print(asyncio.run(f(force=True)))"
```

## 6. 限制

- 首次 Docker build 较重；WSL 需排除 `blog-site/node_modules` 符号链接。
- 不启 `ais-relay` 则无 AIS 实时船讯；定期重跑精简 seed 即可。
- `docker compose down -v` 会丢缓存，需重新 seed。
