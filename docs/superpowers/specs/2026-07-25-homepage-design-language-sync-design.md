# 首页设计语言同步（源 frontend → lemma-ai）

**日期：** 2026-07-25  
**状态：** 已批准（待实现计划）  
**源项目：** `/home/mirahikari/raw-proj/frontend`  
**目标项目：** `/home/mirahikari/lemma-ai/frontend`

## 背景与目标

将源项目产品首页的设计语言（锌灰中性壳层、大圆角对话输入、克制阴影）同步到差分机（lemma-ai），并做合理业务改造。公开落地页与登录后首页一并改造；全站 shadcn token 切换为源项目锌灰体系。

### 已确认决策

| 项 | 选择 |
|---|---|
| 改造范围 | `/` 落地页 + `/home` 产品首页 |
| 配色 | **全站 token** 替换为锌灰（Units 奶油纸退场） |
| `/home` 结构 | 以源项目 Chat-first 为主；右上角保留日程进度 + 用户菜单；看板经 chips / 侧栏触达 |
| `/` 结构 | 短落地：品牌 + 一句主张 + CTA；服务/流程压缩或下沉 |
| 实现路径 | **方案 A**：Token 整体替换 + 关键面按源项目构图重写；积极复用现成组件，不整仓硬拷学习产品业务 |

## 1. 全站 Token / 设计系统

### 1.1 事实源

`frontend/src/index.css` 的 `:root` / `.dark` / `@theme inline` 对齐源项目 `raw-proj/frontend/src/index.css`。

### 1.2 Light token（HSL，与源项目一致）

- `--background` / `--card` / `--popover`：白
- `--foreground`：近黑 `224 71% 4%`
- `--primary`：深锌灰 `220 13% 14%`（非品牌彩）
- `--secondary` / `--muted` / `--accent` / `--sidebar`：浅锌灰 `220 14% 96%`
- `--muted-foreground`：`220 9% 46%`
- `--border` / `--input`：`220 13% 91%`
- `--ring`：跟 primary（去掉橙色 ring）
- `--destructive`：红系（源项目值）
- `--radius`：`0.875rem`

`.dark` 同步源项目暗色表。

### 1.3 壳层与签名语汇

- 外框：`bg-zinc-100` + `p-2 gap-2`
- 主面板：`bg-zinc-50` + `border-zinc-200/80` + `rounded-md`
- 输入签名：`rounded-[26px]` 白底卡、圆形发送/加号按钮
- 浮层：克制投影（常见 `shadow-none`），层次靠边框与背景阶梯
- 彩色：仅用于 suggestion chips / 图表点缀（如 `#EA8444`、`#4A90D9`、`#4CAF50`、`#9C5EC7`），不作大面积背景板

### 1.4 Units 遗留

- 切断奶油纸 → shadcn 的映射路径
- `--units-*` 强调色不再作为页面主背景；可短期保留为兼容别名或仅供 chips/chart
- `units-cta`、`units-plate-hover`、`units-app-panel` 等：改为 zinc 等价样式，或逐步替换为 `bg-zinc-*` / `border-border`
- 字体：保留 Noto Sans SC（中文）；display 从 Space Grotesk 收束为 Inter / 系统无衬线栈，避免强 display 奶油纸气质

### 1.5 本轮不做

- 后端 / 合约 / API
- 政策旅程等内部复杂 UI 的视觉精修（token 跟色即可；坏掉处个案修）
- 登录页营销重设计（跟 token 自然变色；Dither 若刺眼可顺手移除）

## 2. 登录后 `/home`

### 2.1 构图

```
AppLayout（锌灰壳）
└── 主面板 bg-zinc-50 + border + rounded-md
    ├── 右上角：CircularProgress（日程进度）+ HomeUserMenu
    └── 垂直居中 max-w-2xl
        ├── 标题（问候/主张，中文）
        ├── ChatInput（rounded-[26px]）
        └── ActionChip 行（投保向 suggestions）
```

不在首屏嵌入仪表盘（无 `HomeDashboardMetrics` / `HomePolicyWorkspace` / `HomeDashboardSidebar` / scroll-blur）。

### 2.2 行为

- 发送：沿用现有 → `navigate('/tasks/new', { state: { agentTaskLaunch } })`，工具 `policy_planning`
- 日程环：跳转 `/schedule`（进度可接真实数据或占位）
- chips：次级入口（固定四枚）
  - 新建保障 → `/tasks/new`
  - NFT 藏品 → `/collection`
  - 承保池 → `/vault`
  - 日程 → `/schedule`（有待结算时可带 badge）

### 2.3 文案方向

- 标题：**想保障什么？**
- 副文：**描述风险、粘贴事件，或直接问 Agent 开始规划。**

### 2.4 组件复用（优先改样式，不重写）

| 组件 | 作用 |
|---|---|
| `ChatInput` | 主输入；视觉对齐源项目 zinc 边框/发送钮 |
| `ActionChip` | suggestions / 看板入口；去掉 `units-*` |
| `CircularProgress` | 右上角日程 |
| `HomeUserMenu` + Settings* | 保留；默认头像色脱离 `--units-orange` |
| `InputAddMenu` | 若 ChatInput 需要加号菜单则对齐 |

源项目学习向 mock suggestions **不直接拷贝**；改为差分机投保向文案与路由。

## 3. 公开落地页 `/`

### 3.1 结构（短落地）

```
轻量顶栏：品牌「差分机」| 登录
Hero：
  Difference Engine（eyebrow）
  差分机（品牌级标题）
  把一句担忧变成可执行的链上保障。
  [登录开始] → /login
次级短段（压缩，单行流程即可）：
  诉求 → 问卷 → 检索 → 方案 → 链上 → NFT → 结算
```

### 3.2 视觉

- 背景：`bg-background` / 浅锌灰；**去掉** `DitherBackground` 作为主视觉
- 导航：简单顶栏；**不**用 `BubbleMenu` 作为短页主导航
- CTA：`bg-primary text-primary-foreground`（深锌灰实心），非 `units-cta` 暖色胶囊
- 无 `UnitsWorldMap`、无 7 色服务大卡

### 3.3 行为

- 已登录访问 `/` → 保持 redirect `/home`

### 3.4 组件处理

落地页不再引用：`BubbleMenu`、`DitherBackground`、`UnitsWorldMap`。其他页面若仍依赖再个案处理。

## 4. App 壳层

- `AppLayout` 外框对齐源项目：`bg-zinc-100 p-2 gap-2`
- 「发起投保」主按钮：由橙色实心改为深锌灰 `primary`
- 移动底栏：高亮/描边从 `--units-orange` 改为 `primary` / `foreground`
- 侧栏「保单看板」改为 **「首页」**（指向 `/home`）；看板能力由 chips + 其他侧栏项兜底
- `/home` 必须使用圆角 bordered 主面板；其他认证页逐步统一同一面板语汇

## 5. 错误处理与兼容

- Token 切换时，对广泛使用的 `--units-*` 可做 **短期别名**（映射到锌灰等价），降低全站炸掉风险；关键路径（Landing、Home、AppLayout、ActionChip、ChatInput）手改
- 无新后端错误路径；前端导航失败沿用现有 toast/空态

## 6. 验收标准

1. 未登录 `/`：短品牌页 + CTA；无 Dither / BubbleMenu / 七色服务大卡
2. 登录 `/home`：居中输入 + chips + 右上日程/菜单；锌灰壳与 `rounded-[26px]` 输入
3. 任意认证页：背景/边框/主按钮/ring 不再是奶油纸 + 橙 ring
4. 发送输入仍能正确进入 `/tasks/new` 投保任务流
5. chips 与侧栏能到达日程、金库、藏品等既有能力

## 7. 测试要点

- 手动：未登录落地 → 登录 → `/home` 发送一条消息 → 进入任务流
- 手动：chips / 日程环 / 用户菜单 / 侧栏「首页」与「发起投保」
- 视觉：light（及若启用 dark）下对比度与边框可读
- 回归：登录页、vault、schedule 在新 token 下无严重破版（明显坏掉再修）

## 8. 非目标

- 不把源项目课程/学习业务搬入差分机
- 不新建完整「保单看板」独立产品页（除非实现中发现 chip 无可用落地，再开最小路由）
- 不删除所有 Units CSS 工具类定义（可留一轮兼容）
- 不改动后端、链上合约、情报子系统（worldmonitor）
