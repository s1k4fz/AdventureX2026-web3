# 能力冒烟测试报告

**测试时间**：2026-07-24  
**运行环境**：Linux a2 6.18.33.1-microsoft-standard-WSL2 x86_64 (Python 3.14.4)  
**测试目的**：验证 Agent 隔离运行环境中实际可调用的工具能力

---

## 总结表格

| # | 能力项 | 状态 | 证据摘要 |
|---|--------|------|----------|
| 1 | 文件读取 (Read) | ✅ 可用 | 成功读取 `chain_service.py` 前15行 |
| 1 | 代码库检索 (Glob) | ✅ 可用 | 找到 `backend/services/` 下 23 个 `.py` 文件 |
| 1 | 代码库检索 (Grep) | ✅ 可用 | 成功搜索 `def read_pool_snapshot`，定位到第12行 |
| 1 | 代码库检索 (SearchSymbol) | ✅ 可用 | 成功解析 `read_pool_snapshot` 符号及完整函数体 |
| 1 | 代码库检索 (SearchCodebase) | ⚠️ 工具可调用，但索引未就绪 | 返回 `state=not_started`，语义搜索无结果 |
| 2 | Shell 执行 (Bash) | ✅ 可用 | `uname -a` / `git status` / `python3 --version` 均正常返回 |
| 3 | 文件写入 (Write) | ✅ 可用 | 本报告文件即为证据 |
| 4 | 网络访问 (WebFetch) | ✅ 可用 | 成功抓取 https://example.com 内容 |
| 4 | 网络访问 (WebSearch) | ✅ 可用 | 搜索 "Injective testnet 2026" 返回6条结果 |
| 5 | 技能 (Skills) | ❌ 不可用 | 当前工具列表中无 skills 相关调用接口 |
| 6 | MCP 服务 | ❌ 不可用 | 无 `mcp_*` 工具函数；已读到 schema 但无法实际调用 |
| 7 | 子代理委派 | ❌ 不可用 | 无 `delegate` / `spawn_agent` 等工具函数 |

---

## 详细证据

### 1. 文件读取 + 代码库检索

#### Glob 结果
`backend/services/` 下共 **23 个 `.py` 文件**，部分列举：
- `chain_service.py` (53 lines)
- `chat_service.py` (447 lines)
- `companion_service.py` (244 lines)
- `conversation_service.py` (280 lines)
- `course_service.py` (335 lines)
- `video_asset_service.py` (531 lines)

#### Read 结果 — `chain_service.py` 开头
```python
"""M3 — requires `uv add web3`; not wired into M1.

On-chain read helpers for the 差分机 (Difference Engine) settlement relayer.
Functions lazily import web3 INSIDE their body so the module can be imported
safely without web3 installed (M1 boots clean). If web3 is missing a clear
RuntimeError is raised at call time.
"""

from core.config import settings


def read_pool_snapshot() -> dict:
    """Read the current PolicyVault pool state from Injective EVM testnet.

    Returns a dict with pool balances / policy count. Requires web3.
```

#### Grep 结果
```
backend/services/chain_service.py:12: def read_pool_snapshot() -> dict:
```

#### SearchSymbol 结果
成功解析 `read_pool_snapshot` 符号，返回完整函数体（12-29行）。

#### SearchCodebase 结果
工具可调用但索引未建立 (`state=not_started`)，返回空结果。

---

### 2. Shell 执行

#### `uname -a`
```
Linux a2 6.18.33.1-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Fri Jun  5 01:12:21 UTC 2026 x86_64 GNU/Linux
```

#### `git status --short` (前5行)
```
 M backend/.env.example
 M backend/ai/agents.py
 M backend/ai/types.py
 M backend/api/v1/router.py
 M backend/core/config.py
```

#### `python3 --version`
```
Python 3.14.4
```

---

### 3. 文件写入

本报告文件 (`/home/mirahikari/lemma-ai/.capability-smoke-test/report.md`) 的存在即为写入能力的证据。

使用 `Write` 工具创建，使用 `mkdir -p` 创建目录。

---

### 4. 网络访问

#### WebFetch (https://example.com)
```
# Example Domain
This domain is for use in documentation examples without needing permission.
Avoid use in operations. Learn more
```

#### WebSearch ("Injective testnet 2026")
返回 6 条搜索结果，包括：
- Injective EVM Testnet (thirdweb.com)
- Injective Launches Native EVM (injective.com)
- Injective Testnet Faucet (cloud.google.com)
- Injective in 2026: The Convergence of On-Chain Finance (coingecko.com)

---

### 5. 技能 (Skills)

**状态：❌ 不可用**

当前环境中的完整工具列表如下：
- `Bash` — Shell 命令执行
- `GetTerminalOutput` — 获取后台进程输出
- `Write` — 创建/覆盖文件
- `DeleteFile` — 删除文件
- `SearchReplace` — 文件内文本替换
- `Glob` — 文件名模式匹配
- `list_dir` — 列出目录内容
- `SearchCodebase` — 语义代码搜索
- `SearchSymbol` — 符号关系搜索
- `Grep` — 正则内容搜索
- `Read` — 读取文件
- `WebFetch` — 抓取网页
- `WebSearch` — 网络搜索
- `GetProblems` — 获取文件编译/lint 错误

**没有任何 `skill`、`create-skill`、`run-skill` 等相关工具。**

---

### 6. MCP 服务

**状态：❌ 不可用**

已确认 MCP schema 目录存在并可读取：
- `/mcps/genui/tools/load_guidelines.json` — 需要参数 `modules: string[]`
- `/mcps/genui/tools/show_widget.json`
- `/mcps/browser-use/` — 存在
- `/mcps/schedule/` — 存在

但当前工具列表中**没有 `mcp_genui_load_guidelines`、`mcp_browser_use_*` 等动态注入的 MCP 工具函数**。说明 MCP 工具未被注入到本次运行实例的工具集中。

---

### 7. 子代理委派

**状态：❌ 不可用**

当前工具列表中没有任何子代理相关工具（如 `delegate`、`spawn_agent`、`create_subtask` 等）。本实例为叶节点执行器，无法再向下委派。

---

## 额外发现

| 工具 | 备注 |
|------|------|
| `GetProblems` | ✅ 可用，对 chain_service.py 返回 "No errors found" |
| `list_dir` | ✅ 可用，成功列出 MCP schema 目录 |
| `DeleteFile` | 存在但未测试（测试会违反"不删除文件"约束） |
| `SearchReplace` | 存在但未测试（需要已有文件，不在本次范围） |

---

## 关键假设与风险

1. **假设**：工具列表中看不到的能力 = 不可用。没有隐藏的工具别名或延迟加载机制。
2. **风险点**：`SearchCodebase` 语义搜索索引未就绪，可能是新项目首次加载，后续使用时可能恢复正常。
3. **配置放开后仍受限的能力**：
   - Skills 能力不可用（可能需要在 frontmatter 中显式配置 skill 入口）
   - MCP 工具未注入（schema 文件存在但工具函数未绑定到本次运行环境）
   - 子代理委派不可用（本实例是终端执行器，无递归委派机制）
4. **安全性**：所有测试均为只读或限定范围写入，未触碰项目文件。
