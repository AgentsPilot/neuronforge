from typing import Any, List, Dict

from ..core.registry import registry


class InvoiceEmailAgent:
    kind = "invoice_email"

    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config

    async def run(self) -> Dict[str, Any]:
        # Fetch emails
        connector_name = self.config.get("connector", "mock_email")
        email_connector = registry.connector(connector_name)
        messages: List[Dict[str, Any]] = await email_connector.fetch()

        # Filter invoices (very simple heuristic)
        invoices = [m for m in messages if "invoice" in m.get("subject", "").lower()]

        # Send to accounting
        action_name = self.config.get("action", "email")
        action = registry.action(action_name)
        results = []
        for inv in invoices:
            res = await action.run(
                to=self.config.get("accounting_email"),
                subject=f"FWD: {inv.get('subject', '')}",
                body=inv.get("body", ""),
            )
            results.append(res)

        return {"inputs": len(messages), "invoices": len(invoices), "sent": len(results)}
