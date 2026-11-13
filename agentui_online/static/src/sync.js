/** @odoo-module **/
import { tr } from "./i18n";
import { agentuiFetch, AgentUIUnreachable, errorText, REVOKED_CODES } from "./api";
import { APP_MODEL, ICON_SRC, readApps, readSecret, SECRET_MODEL, SETTINGS_MODEL, SIGNIN_MODEL } from "./config";

const SYNC_CONCURRENCY = 4;
const MAX_APPS = 200;
const MAX_ICON_BYTES = 512 * 1024;
const ICON_BUDGET_MS = 15000;
const ICON_TIMEOUT_MS = 5000;

export class SyncError extends Error {}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || false);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/** An image as base64, or false (CORS, not an image, too big, too slow). */
async function fetchIcon(url) {
    if (!url || !/^https?:\/\//.test(url)) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ICON_TIMEOUT_MS);
    try {
        const res = await fetch(url, { credentials: "omit", redirect: "error", signal: controller.signal });
        if (!res.ok || !(res.headers.get("Content-Type") || "").startsWith("image/")) return false;
        const blob = await res.blob();
        return blob.size && blob.size <= MAX_ICON_BYTES ? await blobToBase64(blob) : false;
    } catch {
        return false; // most often CORS: the default icon is used
    } finally {
        clearTimeout(timer);
    }
}

async function groupUserId(orm) {
    const [row] = await orm.searchRead("ir.model.data", [["module", "=", "base"], ["name", "=", "group_user"]], ["res_id"], { limit: 1 });
    return row?.res_id;
}

/** Forget the connection: token, settings, every app with its menu and action. */
export async function forgetConnection(orm, settings) {
    const secret = await readSecret(orm);
    await removeApps(orm, await readApps(orm));
    if (secret.id) await orm.write(SECRET_MODEL, [secret.id], { x_token: false, x_email: false, x_expires_at: false });
    await orm.write(SETTINGS_MODEL, [settings.id], { x_connected: false, x_needs_reconnect: false, x_company_name: false, x_integration_id: false });
}

async function removeApps(orm, apps) {
    if (!apps.length) return;
    const menus = apps.map((a) => a.x_menu_id && a.x_menu_id[0]).filter(Boolean);
    const actions = apps.map((a) => a.x_action_id && a.x_action_id[0]).filter(Boolean);
    if (menus.length) await orm.unlink("ir.ui.menu", menus);
    if (actions.length) await orm.unlink("ir.actions.client", actions);
    await orm.unlink(APP_MODEL, apps.map((a) => a.id));
}

/**
 * AgentUI refused the token. Only a definite answer ends the connection;
 * anything else (an outage, a failover) asks an admin to reconnect and keeps
 * every app icon in place.
 */
async function markRejected(orm, settings, body) {
    if (REVOKED_CODES.includes(body?.code)) await forgetConnection(orm, settings);
    else await orm.write(SETTINGS_MODEL, [settings.id], { x_needs_reconnect: true });
}

/** A unique, xmlid-like name so uninstalling the module also removes this record. */
async function tagForUninstall(orm, model, resId, name) {
    try {
        await orm.create("ir.model.data", [{ module: "agentui_online", name, model, res_id: resId, noupdate: true }]);
    } catch {
        // Cosmetic: Disconnect removes these records anyway.
    }
}

/** Odoo 18 calls the menu's groups field groups_id; Odoo 19+ group_ids. */
async function menuGroupField(orm) {
    const fields = await orm.call("ir.ui.menu", "fields_get", [["group_ids", "groups_id"]], { attributes: ["type"] });
    return fields.group_ids ? "group_ids" : "groups_id";
}

async function ensureMenu(orm, app, item, ctx) {
    let actionId = app.x_action_id && app.x_action_id[0];
    if (!actionId) {
        [actionId] = await orm.create("ir.actions.client", [{ name: item.name, tag: "agentui_online.app", params: { app_id: app.id } }]);
        await tagForUninstall(orm, "ir.actions.client", actionId, `app_action_${app.id}`);
    } else if (ctx.renamed) {
        await orm.write("ir.actions.client", [actionId], { name: item.name });
    }
    let menuId = app.x_menu_id && app.x_menu_id[0];
    const iconData = ctx.icon || (!app.x_has_icon && !menuId ? ctx.defaultIcon : null);
    if (!menuId) {
        [menuId] = await orm.create("ir.ui.menu", [{
            name: item.name,
            action: `ir.actions.client,${actionId}`,
            sequence: item.sequence,
            web_icon_data: iconData || false,
            [ctx.menuGroupField]: [[6, 0, [ctx.groupId]]],
        }]);
        await tagForUninstall(orm, "ir.ui.menu", menuId, `app_menu_${app.id}`);
    } else {
        // Writing a menu flushes Odoo's caches on every worker: only what changed.
        const changed = {};
        if (ctx.renamed) changed.name = item.name;
        if (ctx.resequenced) changed.sequence = item.sequence;
        if (ctx.icon) changed.web_icon_data = ctx.icon;
        if (Object.keys(changed).length) await orm.write("ir.ui.menu", [menuId], changed);
    }
    const links = {};
    if (!app.x_action_id || app.x_action_id[0] !== actionId) links.x_action_id = actionId;
    if (!app.x_menu_id || app.x_menu_id[0] !== menuId) links.x_menu_id = menuId;
    if (ctx.icon) links.x_has_icon = true;
    if (Object.keys(links).length) await orm.write(APP_MODEL, [app.id], links);
    return Boolean(links.x_menu_id || ctx.renamed || ctx.resequenced || ctx.icon);
}

/** Sign-in proofs AgentUI never picked up (it deletes the ones it uses). */
async function removeStaleProofs(orm) {
    try {
        const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
        const ids = await orm.silent.search(SIGNIN_MODEL, [["create_date", "<", cutoff]], { limit: 1000 });
        if (ids.length) await orm.silent.unlink(SIGNIN_MODEL, ids);
    } catch {
        // housekeeping only
    }
}

async function defaultIcon() {
    try {
        const res = await fetch(ICON_SRC);
        return res.ok ? await blobToBase64(await res.blob()) : false;
    } catch {
        return false;
    }
}

/**
 * Mirror the AgentUI app list as x_agentui_app records + one home-screen
 * menu and client action each. Returns { count, added, menusChanged }.
 */
export async function syncApps(orm, settings, onProgress = null) {
    const secret = await readSecret(orm);
    if (!secret.x_token) throw new SyncError(tr("Odoo is not connected to AgentUI yet. Press Connect to AgentUI."));
    let res;
    try {
        res = await agentuiFetch(settings.api_url, "/odoo-connector/apps", { token: secret.x_token });
    } catch (e) {
        throw new SyncError(e instanceof AgentUIUnreachable ? e.message : String(e));
    }
    if (res.status === 401 || res.status === 403) {
        await markRejected(orm, settings, res.body);
        throw new SyncError(tr("AgentUI no longer accepts this connection. Press Connect to AgentUI to connect again."));
    }
    if (res.status !== 200) {
        throw new SyncError(tr("AgentUI answered %(status)s while listing apps: %(error)s", { status: res.status, error: errorText(res.body, "") }));
    }
    if (settings.x_needs_reconnect) await orm.write(SETTINGS_MODEL, [settings.id], { x_needs_reconnect: false });
    const items = Array.isArray(res.body?.data?.apps) ? res.body.data.apps.slice(0, MAX_APPS) : [];
    const existing = await readApps(orm);
    const byAgentUIId = new Map(existing.map((a) => [a.x_agentui_id, a]));
    const ctx = { groupId: await groupUserId(orm), menuGroupField: await menuGroupField(orm), defaultIcon: await defaultIcon() };
    const seen = new Set();
    const iconDeadline = Date.now() + ICON_BUDGET_MS;
    let added = 0;
    let menusChanged = false;
    // Filtered up front (synchronously), so parallel workers never see a duplicate.
    const work = [];
    for (const [index, raw] of items.entries()) {
        const url = typeof raw?.url === "string" ? raw.url : "";
        const id = typeof raw?.id === "string" || typeof raw?.id === "number" ? String(raw.id) : "";
        // Only web addresses ever reach an iframe src.
        if (!id || seen.has(id) || !(url.startsWith("https://") || url.startsWith("http://"))) continue;
        seen.add(id);
        work.push({ raw, id, index, url });
    }
    const syncOne = async ({ raw, id, index, url }) => {
        const item = {
            name: String(raw.name || "AgentUI app").slice(0, 120),
            url: url.slice(0, 2000),
            description: raw.description ? String(raw.description).slice(0, 500) : false,
            sequence: 100 + index,
        };
        let app = byAgentUIId.get(id);
        const vals = { x_name: item.name, x_url: item.url, x_description: item.description, x_sequence: item.sequence };
        let renamed = false;
        let resequenced = false;
        if (!app) {
            const [newId] = await orm.create(APP_MODEL, [{ ...vals, x_agentui_id: id }]);
            app = { id: newId, x_agentui_id: id, x_has_icon: false, x_menu_id: false, x_action_id: false };
            added += 1;
        } else {
            const changed = Object.fromEntries(Object.entries(vals).filter(([k, v]) => (app[k] || false) !== v));
            if (Object.keys(changed).length) await orm.write(APP_MODEL, [app.id], changed);
            renamed = "x_name" in changed;
            resequenced = "x_sequence" in changed;
        }
        // Icons are cosmetic. Each icon address is tried once: most image hosts
        // refuse cross-origin reads (CORS), and retrying on every sync would
        // only add console noise. A new address is tried again; one that ran
        // out of time is tried on the next sync.
        const iconUrl = typeof raw.iconUrl === "string" ? raw.iconUrl.slice(0, 2000) : "";
        let icon = false;
        if (iconUrl && iconUrl !== (app.x_icon_url || "") && Date.now() < iconDeadline) {
            icon = await fetchIcon(iconUrl);
            await orm.write(APP_MODEL, [app.id], { x_icon_url: iconUrl });
        }
        menusChanged = (await ensureMenu(orm, app, item, { ...ctx, icon, renamed, resequenced })) || menusChanged;
    };
    // A few apps at a time: each one is several round trips to Odoo, and Odoo
    // Online is far away. One by one, 45 apps took over a minute.
    let done = 0;
    onProgress?.(0, work.length);
    const queue = work.slice();
    const worker = async () => {
        while (queue.length) {
            await syncOne(queue.shift());
            onProgress?.(++done, work.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, queue.length) }, worker));
    await removeStaleProofs(orm);
    const gone = existing.filter((a) => !seen.has(a.x_agentui_id));
    await removeApps(orm, gone);
    return { count: seen.size, added, menusChanged: menusChanged || gone.length > 0 };
}

/** Revoke the token in AgentUI, then forget everything. Keeps it all on a 5xx / no answer. */
export async function disconnect(orm, settings) {
    const secret = await readSecret(orm);
    if (secret.x_token) {
        const res = await agentuiFetch(settings.api_url, "/odoo-connector/disconnect", { method: "POST", token: secret.x_token, json: {} }).catch((e) => {
            throw new SyncError(`${e.message} ${tr("Nothing was disconnected.")}`);
        });
        if (res.status >= 500) {
            throw new SyncError(tr("AgentUI answered %(status)s. Nothing was disconnected; try again in a minute.", { status: res.status }));
        }
    }
    await forgetConnection(orm, settings);
}
