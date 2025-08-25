from typing import Any, Dict

from ..agents.invoice_email_agent import InvoiceEmailAgent


AGENT_KIND_TO_CLASS = {
	InvoiceEmailAgent.kind: InvoiceEmailAgent,
}


async def run_agent(kind: str, config: Dict[str, Any]) -> Dict[str, Any]:
	agent_cls = AGENT_KIND_TO_CLASS[kind]
	agent = agent_cls(config)
	return await agent.run()