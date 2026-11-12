from odoo import http
from odoo.http import request

from ..models.res_config_settings import DEFAULT_AGENTUI_URL


class AgentUIController(http.Controller):
    @http.route("/agentui_connector/info", type="json", auth="user")
    def info(self):
        params = request.env["ir.config_parameter"].sudo()
        app_url = (params.get_param("agentui_connector.app_url") or "").strip()
        # Only https URLs reach the iframe; anything else (javascript:, http:) is dropped.
        if not app_url.startswith("https://"):
            app_url = ""
        user = request.env.user
        return {
            "odoo_url": params.get_param("web.base.url"),
            "database": request.env.cr.dbname,
            "login": user.login,
            "agentui_url": DEFAULT_AGENTUI_URL,
            "app_url": app_url,
            "is_admin": user.has_group("base.group_system"),
        }
