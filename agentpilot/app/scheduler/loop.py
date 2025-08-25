from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from ..db import AsyncSessionLocal, Agent
from ..core.executor import execute_agent_by_id


class AgentScheduler:
	def __init__(self) -> None:
		self.scheduler = AsyncIOScheduler()

	async def load_jobs(self) -> None:
		async with AsyncSessionLocal() as session:
			res = await session.execute(select(Agent).where(Agent.enabled == True))  # noqa: E712
			agents = res.scalars().all()
			for agent in agents:
				self.add_or_update_job(agent.id, agent.schedule_seconds)

	def add_or_update_job(self, agent_id: int, seconds: int) -> None:
		job_id = f"agent-{agent_id}"
		if self.scheduler.get_job(job_id):
			self.scheduler.remove_job(job_id)
		self.scheduler.add_job(
			lambda: execute_agent_by_id(agent_id),
			trigger=IntervalTrigger(seconds=seconds),
			id=job_id,
			replace_existing=True,
		)

	def start(self) -> None:
		self.scheduler.start()

	def shutdown(self) -> None:
		self.scheduler.shutdown(wait=False)


scheduler = AgentScheduler()