from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable, Dict, Protocol


class Connector(Protocol):
    async def fetch(self, **kwargs: Any) -> Any: ...


class Action(Protocol):
    async def run(self, **kwargs: Any) -> Any: ...


@dataclass(frozen=True)
class RegisteredConnector:
    name: str
    factory: Callable[[], Connector]


@dataclass(frozen=True)
class RegisteredAction:
    name: str
    factory: Callable[[], Action]


class Registry:
    def __init__(self) -> None:
        self._connectors: Dict[str, RegisteredConnector] = {}
        self._actions: Dict[str, RegisteredAction] = {}

    def register_connector(self, name: str, factory: Callable[[], Connector]) -> None:
        self._connectors[name] = RegisteredConnector(name=name, factory=factory)

    def register_action(self, name: str, factory: Callable[[], Action]) -> None:
        self._actions[name] = RegisteredAction(name=name, factory=factory)

    def connector(self, name: str) -> Connector:
        return self._connectors[name].factory()

    def action(self, name: str) -> Action:
        return self._actions[name].factory()


registry = Registry()
