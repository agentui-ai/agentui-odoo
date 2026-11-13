import hmac
import logging
import secrets
import time
from urllib.parse import urlencode, urlsplit

import werkzeug

from odoo import _, http
from odoo.exceptions import AccessDenied, UserError
from odoo.http import request

_logger = logging.getLogger(__name__)

CALLBACK_PATH = "/agentui_connector/oauth/callback"
HUB_PATH = "/odoo/action-agentui_connector.action_agentui_main"
STATE_TTL = 1800
MAX_STATES = 5


def _odoo_origin():
    base = request.env["ir.config_parameter"].sudo().get_param("web.base.url") or request.httprequest.host_url
    parts = urlsplit(base)
    return "%s://%s" % (parts.scheme, parts.netloc)


def _require_admin():
    if not request.env.user.has_group("base.group_system"):
        raise AccessDenied(_("Only an Odoo administrator can connect or disconnect AgentUI."))


def _back_to_hub(error=None, connecting=False):
    query = {}
    if error:
        query["agentui_error"] = error[:300]
    if connecting:
        query["agentui_connecting"] = "1"
    return werkzeug.utils.redirect(HUB_PATH + ("?" + urlencode(query) if query else ""), 303)


def _take_state(state):
    """Single-use check of a Connect started in this browser session.
    Several tabs may each have one pending (up to MAX_STATES)."""
    now = int(time.time())
    states = {k: v for k, v in (request.session.get("agentui_states") or {}).items() if now - int(v) <= STATE_TTL}
    match = next((k for k in states if state and hmac.compare_digest(k, state)), None)
    if match:
        states.pop(match)
    request.session["agentui_states"] = states
    return bool(match)


class AgentUIController(http.Controller):
    @http.route("/agentui_connector/info", type="json", auth="user")
    def info(self):
        Apps = request.env["agentui.app"]
        apps = Apps.search([])
        is_admin = request.env.user.has_group("base.group_system")
        return {
            "connected": bool(Apps._agentui_token()),
            "needs_reconnect": bool(Apps._agentui_param("needs_reconnect")),
            "connecting": bool(Apps._agentui_param("pending_code")),
            "connect_error": (Apps._agentui_param("connect_error") or "") if is_admin else "",
            "connected_email": Apps._agentui_param("connected_email") or "",
            "connected_company": Apps._agentui_param("connected_company") or "",
            "is_admin": is_admin,
            "agentui_url": Apps._agentui_app_url(),
            "odoo_host": urlsplit(_odoo_origin()).netloc,
            "apps": [
                {
                    "id": a.id,
                    "agentui_id": a.agentui_id,
                    "name": a.name,
                    "description": a.description or "",
                    "action_id": a.action_id.id,
                    "has_icon": bool(a.icon),
                    "icon_src": "/web/image/agentui.app/%d/icon" % a.id if a.icon
                    else "/agentui_connector/static/description/icon.png",
                }
                for a in apps
            ],
        }

    @http.route("/agentui_connector/app/<int:app_id>", type="json", auth="user")
    def app(self, app_id):
        record = request.env["agentui.app"].browse(app_id).exists()
        if not record:
            raise UserError(_("This AgentUI app is no longer available. Open the AgentUI menu and press Sync apps."))
        return {"name": record.name, "url": record._agentui_sign_in_url(request.env.user)}

    @http.route("/agentui_connector/oauth/start", type="http", auth="user")
    def oauth_start(self):
        _require_admin()
        state = secrets.token_urlsafe(32)
        now = int(time.time())
        states = {k: v for k, v in (request.session.get("agentui_states") or {}).items() if now - int(v) <= STATE_TTL}
        states[state] = now
        request.session["agentui_states"] = dict(sorted(states.items(), key=lambda kv: kv[1])[-MAX_STATES:])
        origin = _odoo_origin()
        query = urlencode({
            "odoo_url": origin,
            "database": request.env.cr.dbname,
            "redirect_uri": origin + CALLBACK_PATH,
            "state": state,
        })
        url = request.env["agentui.app"]._agentui_app_url() + "/odoo/connect?" + query
        return werkzeug.utils.redirect(url, 303)

    @http.route(CALLBACK_PATH, type="http", auth="user")
    def oauth_callback(self, code=None, state=None, error=None, **kw):
        _require_admin()
        if not _take_state(state):
            return _back_to_hub(_("The connection request expired or did not start here. Press Connect to AgentUI again."))
        if error:
            return _back_to_hub(_("The connection was cancelled in AgentUI."))
        if not code:
            return _back_to_hub(_("AgentUI did not send a connection code. Press Connect to AgentUI again."))

        Apps = request.env["agentui.app"]
        Keys = request.env["res.users.apikeys"].sudo()
        api_key = Keys._generate(None, "AgentUI", None)
        key_id = Keys.search([("user_id", "=", request.env.uid), ("name", "=", "AgentUI")], order="id desc", limit=1).id
        # A cron worker finishes the exchange: AgentUI logs in to this Odoo
        # while it answers, which would wait behind this very request on an
        # Odoo with one HTTP worker. Values live a few seconds, admins only.
        for key, value in (("pending_code", code), ("pending_key", api_key), ("pending_key_id", str(key_id)),
                           ("pending_login", request.env.user.login), ("pending_at", str(int(time.time()))),
                           ("connect_error", False)):
            Apps._agentui_set(key, value)
        request.env.ref("agentui_connector.ir_cron_agentui_finish_connect").sudo()._trigger()
        return _back_to_hub(connecting=True)

    @http.route("/agentui_connector/sync", type="json", auth="user")
    def sync(self):
        _require_admin()
        try:
            return {"count": request.env["agentui.app"]._agentui_sync()}
        except UserError as e:
            # Returned, not raised: raising would roll back the reconnect flag.
            return {"error": str(e.args[0] if e.args else e)}

    @http.route("/agentui_connector/disconnect", type="json", auth="user")
    def disconnect(self):
        _require_admin()
        request.env["agentui.app"]._agentui_disconnect()
        return {"disconnected": True}
