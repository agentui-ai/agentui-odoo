/** @odoo-module **/
import * as owl from "@odoo/owl";
import { user } from "@web/core/user";

export const MODULE = "agentui_online";
export const HUB_MENU_XMLID = "agentui_online.menu_agentui_root";
export const HUB_ACTION_XMLID = "agentui_online.action_agentui_main";
export const SETTINGS_ACTION_XMLID = "agentui_online.action_x_agentui_settings";
export const ICON_SRC = "/agentui_online/static/description/icon.png";
export const DEFAULT_API_URL = "https://api.agentui.ai";
export const DEFAULT_APP_URL = "https://app.agentui.ai";

export const APP_MODEL = "x_agentui_app";
export const SETTINGS_MODEL = "x_agentui_settings";
export const SECRET_MODEL = "x_agentui_secret";
export const SIGNIN_MODEL = "x_agentui_signin";
const APP_FIELDS = ["x_name", "x_agentui_id", "x_url", "x_description", "x_has_icon", "x_icon_url", "x_menu_id", "x_action_id", "x_sequence"];
const SETTINGS_FIELDS = ["x_connected", "x_needs_reconnect", "x_company_name", "x_integration_id", "x_api_url", "x_app_url"];

/** "https://x.y/" -> "https://x.y"; anything that is not http(s) -> fallback. */
export function cleanBaseUrl(value, fallback) {
    try {
        const url = new URL(String(value || ""));
        if (url.protocol === "https:" || url.protocol === "http:") return url.href.replace(/\/+$/, "");
    } catch {
        // fall through
    }
    return fallback;
}

export function originOf(value) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

export async function isAdmin() {
    return user.hasGroup("base.group_system");
}

export async function readSettings(orm) {
    const [row] = await orm.searchRead(SETTINGS_MODEL, [], SETTINGS_FIELDS, { limit: 1, order: "id" });
    const settings = row || { id: false };
    settings.api_url = cleanBaseUrl(settings.x_api_url, DEFAULT_API_URL);
    settings.app_url = cleanBaseUrl(settings.x_app_url, DEFAULT_APP_URL);
    return settings;
}

/** Administrators only: employees get an AccessError here, by design. */
export async function readSecret(orm) {
    const [row] = await orm.searchRead(SECRET_MODEL, [], ["x_token", "x_email", "x_expires_at"], { limit: 1, order: "id" });
    return row || { id: false };
}

export function readApps(orm) {
    return orm.searchRead(APP_MODEL, [], APP_FIELDS, { limit: 500 });
}

/** Everything the hub shows. */
export async function loadHubInfo(orm) {
    const admin = await isAdmin();
    const [settings, apps, secret] = await Promise.all([readSettings(orm), readApps(orm), admin ? readSecret(orm) : null]);
    return {
        is_admin: admin,
        settings,
        connected: Boolean(settings.x_connected),
        needs_reconnect: Boolean(settings.x_needs_reconnect),
        connected_company: settings.x_company_name || "",
        connected_email: secret?.x_email || "",
        agentui_url: settings.app_url,
        odoo_host: window.location.host,
        apps: apps.map((a) => ({
            id: a.id,
            agentui_id: a.x_agentui_id,
            name: a.x_name,
            description: a.x_description || "",
            action_id: a.x_action_id && a.x_action_id[0],
            has_icon: Boolean(a.x_has_icon && a.x_menu_id),
            icon_src: a.x_has_icon && a.x_menu_id ? `/web/image/ir.ui.menu/${a.x_menu_id[0]}/web_icon_data` : ICON_SRC,
        })),
    };
}

/** Back to the AgentUI hub, through the menu service so the navbar shows AgentUI. */
/** services = { menu, action } from useService in setup (Odoo 20 has no this.env). */
export function goToHub(services) {
    const menu = services.menu;
    const hub = menu.getApps().find((app) => app.xmlid === HUB_MENU_XMLID);
    if (hub) return menu.selectMenu(hub);
    return services.action.doAction(HUB_ACTION_XMLID, { clearBreadcrumbs: true });
}

/**
 * The component's props on Odoo 18 (Owl 2: this.props is built in) and Odoo
 * 20 (Owl 3: a component only gets props by calling useProps() in setup).
 * Call it first thing in setup().
 */
export function adoptProps(component) {
    if (!component.props && typeof owl.useProps === "function") component.props = owl.useProps();
    return component.props;
}
