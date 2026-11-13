import base64
import logging
import time

import requests

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

PARAM = "agentui_connector."
DEFAULT_API_URL = "https://api.agentui.ai"
DEFAULT_APP_URL = "https://app.agentui.ai"
MAX_APPS = 200
MAX_ICON_BYTES = 512 * 1024
ICON_BUDGET_SECONDS = 30
# (connect, read). Short on paths a person waits on, so a slow AgentUI never
# pins an Odoo worker.
TIMEOUT = (5, 20)
SIGN_IN_TIMEOUT = (3, 5)
PENDING_TTL = 300
# Answers from AgentUI that mean this exact connection is gone for good.
REVOKED_CODES = ("CONNECTOR_COMPANY_CHANGED", "NOT_A_CONNECTOR_TOKEN")


class AgentUIError(UserError):
    pass


class AgentUIApp(models.Model):
    """One AgentUI app, shown as its own icon on the Odoo home screen."""

    _name = "agentui.app"
    _description = "AgentUI app"
    _order = "sequence, name"

    name = fields.Char(required=True)
    agentui_id = fields.Char(required=True, index=True)
    url = fields.Char(required=True)
    description = fields.Text()
    icon = fields.Binary(attachment=True)
    sequence = fields.Integer(default=100)
    menu_id = fields.Many2one("ir.ui.menu", ondelete="set null")
    action_id = fields.Many2one("ir.actions.client", ondelete="set null")

    _sql_constraints = [("agentui_id_unique", "unique(agentui_id)", "Each AgentUI app is listed once.")]

    # ---- configuration -------------------------------------------------
    @api.model
    def _agentui_param(self, key, default=None):
        return self.env["ir.config_parameter"].sudo().get_param(PARAM + key, default)

    @api.model
    def _agentui_set(self, key, value):
        self.env["ir.config_parameter"].sudo().set_param(PARAM + key, value or False)

    @api.model
    def _agentui_api_url(self):
        return (self._agentui_param("api_url") or DEFAULT_API_URL).rstrip("/")

    @api.model
    def _agentui_app_url(self):
        return (self._agentui_param("app_url") or DEFAULT_APP_URL).rstrip("/")

    @api.model
    def _agentui_token(self):
        return self._agentui_param("access_token")

    @api.model
    def _agentui_request(self, method, path, timeout=TIMEOUT, **kwargs):
        token = self._agentui_token()
        if not token:
            raise AgentUIError(_("Odoo is not connected to AgentUI yet. Open the AgentUI menu and press Connect to AgentUI."))
        headers = {"Authorization": "Bearer %s" % token}
        return requests.request(method, self._agentui_api_url() + path, headers=headers, timeout=timeout, **kwargs)

    # ---- connection ----------------------------------------------------
    @api.model
    def _agentui_store_connection(self, data, api_key_id):
        previous_key_id = int(self._agentui_param("api_key_id") or 0)
        self._agentui_set("access_token", data.get("accessToken"))
        self._agentui_set("connected_email", data.get("email"))
        self._agentui_set("connected_company", data.get("companyName"))
        self._agentui_set("api_key_id", str(api_key_id))
        self._agentui_set("needs_reconnect", False)
        # AgentUI now holds the new key: the one from the previous connect is unused.
        if previous_key_id and previous_key_id != api_key_id:
            self.env["res.users.apikeys"].sudo().browse(previous_key_id).exists().unlink()

    @api.model
    def _agentui_forget_connection(self):
        for key in ("access_token", "connected_email", "connected_company", "needs_reconnect"):
            self._agentui_set(key, False)
        self.sudo().search([]).unlink()

    @api.model
    def _agentui_disconnect(self, timeout=TIMEOUT):
        if self._agentui_token():
            try:
                res = self._agentui_request("POST", "/odoo-connector/disconnect", timeout=timeout, json={})
            except requests.RequestException as e:
                raise AgentUIError(_("AgentUI did not answer (%s). Nothing was disconnected; try again in a minute.", e)) from e
            if res.status_code >= 500:
                raise AgentUIError(_("AgentUI answered %s. Nothing was disconnected; try again in a minute.", res.status_code))
        self._agentui_forget_connection()

    @api.model
    def _agentui_mark_rejected(self, res):
        """AgentUI refused the token. Only a definite answer ends the connection;
        anything else (an outage, a failover) just asks an admin to reconnect,
        keeping every app icon in place."""
        code = ""
        try:
            code = (res.json() or {}).get("code") or ""
        except ValueError:
            pass
        if code in REVOKED_CODES:
            self._agentui_forget_connection()
        else:
            self._agentui_set("needs_reconnect", "1")

    # ---- connect (finished by a cron job, never inside the HTTP request) ---
    @api.model
    def _agentui_finish_connect(self):
        """Trade the pending connect code with AgentUI.

        Runs in a cron worker: AgentUI logs in to this Odoo over XML-RPC while
        it answers, and that must not wait behind the browser's own request on
        an Odoo with a single HTTP worker."""
        code = self._agentui_param("pending_code")
        if not code:
            return
        key_id = int(self._agentui_param("pending_key_id") or 0)
        login = self._agentui_param("pending_login")
        api_key = self._agentui_param("pending_key")
        at = int(self._agentui_param("pending_at") or 0)
        for key in ("pending_code", "pending_key", "pending_key_id", "pending_login", "pending_at"):
            self._agentui_set(key, False)
        Keys = self.env["res.users.apikeys"].sudo()
        if time.time() - at > PENDING_TTL or not (key_id and login and api_key):
            Keys.browse(key_id).exists().unlink()
            self._agentui_set("connect_error", _("The connection took too long. Press Connect to AgentUI again."))
            return
        try:
            res = requests.post(
                self._agentui_api_url() + "/odoo-connector/token",
                json={"code": code, "login": login, "odooApiKey": api_key},
                timeout=(5, 45),
            )
            body = res.json() if res.headers.get("Content-Type", "").startswith("application/json") else {}
        except requests.RequestException as e:
            # Unknown outcome: AgentUI may hold this key. Keep it; the next
            # connect replaces it.
            self._agentui_set("connect_error", _("AgentUI did not answer (%s). Press Connect to AgentUI again.", e))
            return
        if res.status_code != 200:
            Keys.browse(key_id).exists().unlink()
            self._agentui_set("connect_error", body.get("error") or _("AgentUI could not finish the connection. Press Connect to AgentUI again."))
            return
        self._agentui_store_connection(body.get("data") or {}, key_id)
        self._agentui_set("connect_error", False)
        self.env.cr.commit()
        self._agentui_sync_cron()

    # ---- app sync ------------------------------------------------------
    @api.model
    def _agentui_fetch_icon(self, icon_url):
        if not icon_url or not icon_url.startswith("https://"):
            return False
        try:
            res = requests.get(icon_url, timeout=(3, 5), stream=True, allow_redirects=False)
            if res.status_code != 200 or not res.headers.get("Content-Type", "").startswith("image/"):
                return False
            body = res.raw.read(MAX_ICON_BYTES + 1, decode_content=True)
            return base64.b64encode(body) if len(body) <= MAX_ICON_BYTES else False
        except requests.RequestException:
            return False

    @api.model
    def _agentui_sync(self):
        """Pull the app list from AgentUI and mirror it as home-screen menus."""
        res = self._agentui_request("GET", "/odoo-connector/apps")
        if res.status_code in (401, 403):
            self._agentui_mark_rejected(res)
            raise AgentUIError(_("AgentUI no longer accepts this connection. Press Connect to AgentUI to connect again."))
        if res.status_code != 200:
            raise AgentUIError(_("AgentUI answered %(status)s while listing apps: %(error)s", status=res.status_code, error=res.text[:300]))
        if self._agentui_param("needs_reconnect"):
            self._agentui_set("needs_reconnect", False)
        apps = (res.json().get("data") or {}).get("apps") or []
        Apps = self.sudo()
        seen = set()
        icon_deadline = time.monotonic() + ICON_BUDGET_SECONDS
        for index, item in enumerate(apps[:MAX_APPS]):
            if not (item.get("id") and item.get("url", "").startswith(("https://", "http://"))):
                continue
            seen.add(item["id"])
            vals = {
                "name": (item.get("name") or "AgentUI app")[:120],
                "url": item["url"],
                "description": item.get("description") or False,
                "sequence": 100 + index,
            }
            record = Apps.search([("agentui_id", "=", item["id"])], limit=1)
            if record:
                changed = {k: v for k, v in vals.items() if record[k] != v}
                if changed:
                    record.write(changed)
            else:
                record = Apps.create(dict(vals, agentui_id=item["id"]))
            # Icons are cosmetic: a later sync fetches the ones that ran out of time.
            if not record.icon and time.monotonic() < icon_deadline:
                record.icon = self._agentui_fetch_icon(item.get("iconUrl"))
            record._agentui_ensure_menu()
        Apps.search([("agentui_id", "not in", list(seen))]).unlink()
        return len(seen)

    @api.model
    def _agentui_sync_cron(self):
        if not self._agentui_token():
            return
        try:
            self._agentui_sync()
        except (UserError, requests.RequestException) as e:
            _logger.warning("AgentUI app sync failed: %s", e)

    def _agentui_sign_in_url(self, user):
        """App URL that signs this Odoo user in, when AgentUI allows it.

        Sends the Odoo LOGIN, never the email: every Odoo user can edit their
        own email in Preferences, only an administrator can change a login.
        AgentUI only signs in plain app users with that email; anyone else gets
        the app's own sign-in screen."""
        self.ensure_one()
        login = (user.login or "").strip()
        if "@" not in login:
            return self.url
        try:
            res = self._agentui_request(
                "POST", "/odoo-connector/app-sign-in", timeout=SIGN_IN_TIMEOUT,
                json={"workflowId": self.agentui_id, "email": login},
            )
        except (UserError, requests.RequestException) as e:
            _logger.info("AgentUI sign-in link unavailable: %s", e)
            return self.url
        if res.status_code != 200:
            return self.url
        url = ((res.json() or {}).get("data") or {}).get("url") or ""
        # Same app origin only: never let a response steer the iframe elsewhere.
        return url if url.startswith(self.url.rstrip("/") + "/") else self.url

    def _agentui_ensure_menu(self):
        default_icon = "agentui_connector,static/description/icon.png"
        group_ids = [self.env.ref("base.group_user").id]
        for record in self:
            if not record.action_id:
                record.action_id = self.env["ir.actions.client"].sudo().create({
                    "name": record.name,
                    "tag": "agentui_connector.app",
                    "params": {"app_id": record.id},
                })
            elif record.action_id.name != record.name:
                record.action_id.name = record.name
            menu_vals = {
                "name": record.name,
                "action": "ir.actions.client,%d" % record.action_id.id,
                "sequence": record.sequence,
                "web_icon_data": record.icon or False,
                "web_icon": False if record.icon else default_icon,
            }
            menu = record.menu_id.sudo()
            if not menu:
                record.menu_id = self.env["ir.ui.menu"].sudo().create(dict(menu_vals, groups_id=[(6, 0, group_ids)]))
                continue
            # Writing a menu flushes Odoo's caches on every worker: only write
            # what actually changed.
            changed = {}
            for key, value in menu_vals.items():
                current = menu[key]
                if key == "action":
                    current = "%s,%d" % (current._name, current.id) if current else False
                if current != value:
                    changed[key] = value
            if changed:
                menu.write(changed)

    def unlink(self):
        menus = self.mapped("menu_id")
        actions = self.mapped("action_id")
        result = super().unlink()
        menus.sudo().unlink()
        actions.sudo().unlink()
        return result
