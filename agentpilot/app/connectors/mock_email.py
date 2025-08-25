from typing import Any, List, Dict

from ..core.registry import Connector


class MockEmailConnector(Connector):
    def __init__(self, messages: List[Dict[str, Any]] | None = None) -> None:
        self._messages = messages or []

    async def fetch(self, **kwargs: Any) -> Any:
        return list(self._messages)
