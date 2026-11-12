from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

DEFAULT_AGENTUI_URL = "https://app.agentui.ai"


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    agentui_app_url = fields.Char(
        string="AgentUI app URL",
        config_parameter="agentui_connector.app_url",
        help="Published AgentUI app to show under the AgentUI menu. Must start with https://.",
    )

    @api.constrains("agentui_app_url")
    def _check_agentui_app_url(self):
        for record in self:
            url = (record.agentui_app_url or "").strip()
            if url and not url.startswith("https://"):
                raise ValidationError(_("The AgentUI app URL must start with https://"))
