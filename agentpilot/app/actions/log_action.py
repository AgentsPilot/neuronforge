from typing import Any

from ..core.registry import Action


class LogAction(Action):
    async def run(self, **kwargs: Any) -> Any:
        # Minimal logging action; would persist to DB in a real implementation
        return {"logged": kwargs}
