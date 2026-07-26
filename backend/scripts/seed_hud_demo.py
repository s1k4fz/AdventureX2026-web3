"""HUD 演示数据种子：给直通测试用户插盯盘/Agent 任务/保单,点亮全部六类卡片。

跑法(backend/ 目录下):
    uv run python scripts/seed_hud_demo.py

幂等:按固定标题清旧插新,可反复执行。
用户:HUD_DEV_USER_ID(auth.users 中真实存在的测试账号)。
"""

import asyncio
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select

from core.config import settings
from core.database import AsyncSessionLocal
from models.agent_task import AgentRun, AgentStep, AgentTask
from models.policy import Policy
from models.profile import Profile
from models.schedule_watch_item import ScheduleWatchItem

WATCH_TITLES = ["美联储利率决议", "台风路径确认"]
TASK_RUNNING_TITLE = "关税保单研究"
TASK_WAITING_TITLE = "台风对冲方案确认"
POLICY_TITLE = "台风损失对冲"


async def main() -> None:
    user_id = uuid.UUID(settings.hud_dev_user_id)
    now = datetime.now(UTC)
    today = now.date()

    async with AsyncSessionLocal() as db:
        # 1) profile 兑底(auth.users 已存在,profiles 可能没建)；独立事务先提交,
        #    避免与后续 FK 依赖的插入同批 flush 时顺序不确定
        profile = await db.get(Profile, user_id)
        if profile is None:
            db.add(Profile(
                id=user_id,
                email="hud.rokid.test@gmail.com",
                nickname="HUD Demo",
                avatar_color="green",
            ))
            await db.commit()
            print("profile: created")
        else:
            print("profile: exists")
    
    async with AsyncSessionLocal() as db:
        # 验证 profile 确实落库(FK 前置条件)
        check = await db.get(Profile, user_id)
        if check is None:
            raise SystemExit("profile 未落库,中止")
    
        # 2) 清旧演示数据(按固定标题,幂等)
        await db.execute(delete(ScheduleWatchItem).where(
            ScheduleWatchItem.user_id == user_id,
            ScheduleWatchItem.title.in_(WATCH_TITLES),
        ))
        old_tasks = (await db.execute(select(AgentTask.id).where(
            AgentTask.user_id == user_id,
            AgentTask.title.in_([TASK_RUNNING_TITLE, TASK_WAITING_TITLE]),
        ))).scalars().all()
        if old_tasks:
            await db.execute(delete(AgentTask).where(AgentTask.id.in_(old_tasks)))
        await db.execute(delete(Policy).where(
            Policy.user_id == user_id,
            Policy.title == POLICY_TITLE,
        ))

        # 3) 盯盘到期提醒 ×2(今天到期 → high 卡)
        for i, title in enumerate(WATCH_TITLES):
            db.add(ScheduleWatchItem(
                user_id=user_id,
                title=title,
                notes="HUD 演示数据",
                due_on=today,
                color="red" if i == 0 else "orange",
            ))

        # 4) Agent 任务:running(带 3/5 步进度)
        task_running = AgentTask(
            user_id=user_id,
            kind="policy_planning",
            status="running",
            title=TASK_RUNNING_TITLE,
            goal_text="研究关税上调对出口保单的影响并生成对冲方案",
        )
        db.add(task_running)
        await db.flush()
        run = AgentRun(task_id=task_running.id, status="running",
                       trigger="create", started_at=now)
        db.add(run)
        await db.flush()
        step_names = ["intake", "market_search", "research", "compose", "confirm"]
        step_status = ["succeeded", "succeeded", "succeeded", "running", "pending"]
        for seq, (name, st) in enumerate(zip(step_names, step_status)):
            db.add(AgentStep(run_id=run.id, name=name, seq=seq, status=st))

        # 5) Agent 任务:waiting_user(→ urgent 弹现 + 滚动冻结)
        db.add(AgentTask(
            user_id=user_id,
            kind="policy_planning",
            status="waiting_user",
            title=TASK_WAITING_TITLE,
            goal_text="台风对冲组合已生成,等待用户选择方案",
        ))

        # 6) 在保保单(opened 未结算 → 保单状态卡)
        db.add(Policy(
            user_id=user_id,
            need_text="担心 8 月台风导致门店停业损失",
            title=POLICY_TITLE,
            status="active",
            search_status="searched",
            opened_at=now - timedelta(days=3),
            coverage_end=now + timedelta(days=36),
            premium=120,
            payout=1000,
        ))

        await db.commit()
        print("seeded: 2 watch items, 2 agent tasks (running + waiting_user), 1 active policy")


if __name__ == "__main__":
    asyncio.run(main())
