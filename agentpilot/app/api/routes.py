from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.runtime import run_agent
from ..db import Agent, Run, get_session

router = APIRouter()


class RunAgentRequest(BaseModel):
	kind: str
	config: Dict[str, Any]


@router.post("/run")
async def run_ad_hoc(req: RunAgentRequest) -> Dict[str, Any]:
	return await run_agent(req.kind, req.config)


class AgentCreate(BaseModel):
	name: str
	kind: str
	config: Dict[str, Any]
	schedule_seconds: int = 300
	enabled: bool = True


@router.post("/agents", response_model=Dict[str, Any])
async def create_agent(payload: AgentCreate, session: AsyncSession = Depends(get_session)):
	agent = Agent(
		name=payload.name,
		kind=payload.kind,
		config=payload.config,
		schedule_seconds=payload.schedule_seconds,
		enabled=payload.enabled,
	)
	session.add(agent)
	await session.commit()
	await session.refresh(agent)
	return {"id": agent.id, "name": agent.name, "kind": agent.kind}


@router.get("/agents", response_model=List[Dict[str, Any]])
async def list_agents(session: AsyncSession = Depends(get_session)):
	res = await session.execute(select(Agent))
	agents = res.scalars().all()
	return [
		{"id": a.id, "name": a.name, "kind": a.kind, "enabled": a.enabled, "schedule_seconds": a.schedule_seconds}
		for a in agents
	]


class RunCreate(BaseModel):
	agent_id: int


@router.post("/runs", response_model=Dict[str, Any])
async def create_run(payload: RunCreate, session: AsyncSession = Depends(get_session)):
	run = Run(agent_id=payload.agent_id, status="queued")
	session.add(run)
	await session.commit()
	await session.refresh(run)
	return {"id": run.id, "status": run.status}