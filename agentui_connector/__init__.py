import logging

from odoo.exceptions import UserError

from . import controllers
from . import models

_logger = logging.getLogger(__name__)


def uninstall_hook(env):
    """Revoke the AgentUI token and remove the per-app menus and actions
    (they have no XML id). An unreachable AgentUI never blocks uninstalling."""
    Apps = env["agentui.app"].sudo()
    try:
        Apps._agentui_disconnect(timeout=(3, 5))
    except UserError as e:
        _logger.warning("AgentUI token not revoked on uninstall: %s", e)
        Apps._agentui_forget_connection()
