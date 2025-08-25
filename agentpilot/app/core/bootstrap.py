from ..core.registry import registry
from ..connectors.mock_email import MockEmailConnector
from ..actions.email_action import EmailAction
from ..actions.log_action import LogAction


def register_plugins() -> None:
	registry.register_connector("mock_email", lambda: MockEmailConnector())
	registry.register_action("email", lambda: EmailAction())
	registry.register_action("log", lambda: LogAction())