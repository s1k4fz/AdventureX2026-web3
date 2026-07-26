# 首页与对话页重设计 + 导航精修 + 应用内去背景

## 概述
移除登录后应用页的装饰背景层（`ThemeVeil` 光晕/颗粒、`PixelBackdrop` 浮点），保留 `units-app-panel` 浅色面板与 1.5px 描边体系；首页转为"输入优先 + 精简保单列表"；对话页空态精简；侧栏与移动底栏导航精修。**落地页 `LandingPage`、登录页 `LoginPage` 保持不变。**

## 一、去除应用内装饰背景
保留 [ThemeVeil.tsx](file:///home/mirahikari/lemma-ai/frontend/src/components/ThemeVeil.tsx) / [PixelBackdrop.tsx](file:///home/mirahikari/lemma-ai/frontend/src/components/pixel/PixelBackdrop.tsx) 组件本身（落地/登录页仍用），仅从以下登录后界面移除其使用与相关 import：

- 页面氛围层（移除 `<ThemeVeil>`；ConversationPage 同时移除 `<PixelBackdrop>`）：`HomePage`、`ConversationPage` 空态、`PolicyDetailPage`
- 等待/加载态装饰（移除 `<PixelBackdrop>`，**保留前景 `PixelArt` 加载图形**）：`GlobalContextPanel`(L319)、`RequireAuth`(L18) 启动态、`AgentWaitingState`(L134)、`QuestionnaireGeneratingState`(L93)
- 顺带清理仅为叠在背景之上而存在的 `relative z-[1]` 包裹（随重排处理，不改变布局效果）

## 二、首页重设计（输入优先 + 精简列表）
文件：[HomePage.tsx](file:///home/mirahikari/lemma-ai/frontend/src/pages/HomePage.tsx)

- 顶栏：保留右上 `HomeUserMenu`；删除原并排 260px "Chain readiness" 大卡，改为其旁一个紧凑钱包状态 chip（复用对话页右上样式：已就绪 / 网络未就绪 / 未连接 + `WalletConnectButton`）
- 英雄区（核心）：单列居中，eyebrow 品牌行 + 标题 + 大号 `AgentInput`（作为主入口，限定最大宽度约 48rem）+ 一行建议动作 chips（保留"开始风险问卷 / 查看待处理 / 结算日程 / 承保池"快捷入口）
- 列表区：保留筛选 `Tabs`(line 变体) + 保单列表，单列铺开限定阅读宽度；原 4 张彩色 `StatCard` 降级为列表标题旁一条纤细统计摘要行（如"生效 3 · 保障额 $X · 待结算 1"，小字无色块）
- 移除：`UnitsWorldMap` 侧栏、`PolicyEventsCalendar` 侧栏（保留跳转 `/schedule` 的日历入口链接）；原两列 `lg:grid-cols-[1fr_300px]` 改为单列

## 三、对话页重设计
文件：[ConversationPage.tsx](file:///home/mirahikari/lemma-ai/frontend/src/pages/ConversationPage.tsx)

- 空态 `renderEmptyState`：移除 `ThemeVeil` + `PixelBackdrop`；精简为 图标徽标 + eyebrow + 标题 + 副标题 + 建议 prompts；将原"3 张能力卡 + 独立流程条"合并压缩为一条纤细流程行（描述风险 → 完成问卷 → 审阅方案 → 连接钱包 → 签名出资 → 等待确认），删除 3 张 feature 卡降噪
- 顶部右上状态簇与底部悬浮 composer 维持、微调间距；`units-composer-fade` 依赖面板底色 `--units-soft`，保留面板后不受影响

## 四、导航精修
文件：[AppLayout.tsx](file:///home/mirahikari/lemma-ai/frontend/src/layouts/AppLayout.tsx)、[SidebarItem.tsx](file:///home/mirahikari/lemma-ai/frontend/src/components/SidebarItem.tsx)

- 侧栏：header 下方把"发起投保"提升为醒目主 CTA 按钮（描边/填充强调，类似"新建"），与其余导航项分组留白；主导航项激活态增强（激活加左侧 2px 橙色强调条 + 更明确选中底色/字重）
- 对话记录区：维持可折叠，微调标题与项间距
- 移动底栏：`Link` 改为 `NavLink` 支持激活态（当前项高亮为前景色 + 轻底色），强化中间"新任务"入口，优化触达区与间距

## 测试计划
- `cd frontend && npm run build` 确保无 TS/构建错误
- `npm run dev` 走查：首页（输入优先、无氛围背景、钱包 chip、精简列表 + 统计摘要行）、对话页空态与进行态、保单详情（无 veil）、加载/等待态（无 backdrop、`PixelArt` 仍在）、侧栏与移动底栏激活态
- 确认落地页/登录页氛围背景不变；深浅色主题与 `prefers-reduced-motion` 无回归

## 假设
- "全站背景"= `ThemeVeil` + `PixelBackdrop` 装饰层；`units-app-panel` 浅色面板与描边体系保留
- 首页统计以纤细摘要行"弱化"保留（信息不丢失）；世界地图/日历侧栏从首页移除（日历经 `/schedule` 访问）
- 等待态组件的 `PixelBackdrop` 一并移除以保证应用内背景一致