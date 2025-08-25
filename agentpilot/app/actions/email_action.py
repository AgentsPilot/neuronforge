from typing import Any

from ..core.registry import Action


class EmailAction(Action):
    async def run(self, **kwargs: Any) -> Any:
        # Placeholder that simulates sending email
        to = kwargs.get("to")
        subject = kwargs.get("subject", "")
        body = kwargs.get("body", "")
        return {"sent": True, "to": to, "subject": subject, "body_len": len(body)}
