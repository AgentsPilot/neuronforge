from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict

from sqlalchemy import select

from ..db import AsyncSessionLocal, Agent, Run
from .runtime import run_agent


async def execute_agent_by_id(agent_id: int) -> Dict[str, Any]:
    async with AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        if agent is None:
            return {"error": f"Agent {agent_id} not found"}

        run = Run(
            agent_id=agent.id,
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        session.add(run)
        await session.flush()
        try:
            result = await run_agent(agent.kind, agent.config)
            run.status = "success"
            run.logs = json.dumps(result)
            return result
        except Exception as exc:  # noqa: BLE001
            run.status = "error"
            run.logs = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            run.finished_at = datetime.now(timezone.utc)
            await session.commit()


async def execute_run(run_id: int) -> Dict[str, Any]:
    async with AsyncSessionLocal() as session:
        run = await session.get(Run, run_id)
        if run is None:
            return {"error": f"Run {run_id} not found"}
        agent = await session.get(Agent, run.agent_id)
        if agent is None:
            return {"error": f"Agent {run.agent_id} not found"}

        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        await session.flush()
        try:
            result = await run_agent(agent.kind, agent.config)
            run.status = "success"
            run.logs = json.dumps(result)
            return result
        except Exception as exc:  # noqa: BLE001
            run.status = "error"
            run.logs = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            run.finished_at = datetime.now(timezone.utc)
            await session.commit()