/** @odoo-module **/
import { session } from "@web/session";
import { tr } from "./i18n";
import { agentuiFetch, errorText } from "./api";
import { createApiKey, currentLogin, removeNewestKey, removeOlderKeys } from "./api_key";
import { originOf, readSecret, SECRET_MODEL, SETTINGS_MODEL } from "./config";

const CONNECT_MESSAGE = "agentui:odoo-connect";
const WAIT_MS = 10 * 60 * 1000;
const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random URL-safe characters (crypto, never Math.random). */
export function randomState(length = 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (b) => URL_SAFE[b & 63]).join("");
}

/**
 * Open the AgentUI consent page in a popup and wait for its answer.
 * The popup posts { type: "agentui:odoo-connect", code, state } to this
 * window. Accepted only from the AgentUI app origin and with the state this
 * page just made, so no other site or tab can push a code here.
 * Resolves the code, or null when the person closed the window.
 */
export function waitForConnectCode(appUrl) {
    const appOrigin = originOf(appUrl);
    const state = randomState();
    const query = new URLSearchParams({
        odoo_url: window.location.origin,
        database: session.db || "",
        state,
        response_mode: "web_message",
    });
    // Not "noopener": the consent page answers through window.opener.
    const popup = window.open(`${appUrl}/odoo/connect?${query}`, "agentui_connect", "popup,width=560,height=760");
    if (!popup) {
        return Promise.reject(new Error(tr("Your browser blocked the AgentUI window. Allow pop-ups for this page and press Connect to AgentUI again.")));
    }
    return new Promise((resolve, reject) => {
        let closedSince = 0;
        const done = (fn, value) => {
            window.removeEventListener("message", onMessage);
            clearInterval(watch);
            clearTimeout(expire);
            fn(value);
        };
        const onMessage = (event) => {
            const data = event.data;
            if (event.origin !== appOrigin || !data || data.type !== CONNECT_MESSAGE || data.state !== state) return;
            try {
                popup.close();
            } catch {
                // already closed
            }
            if (data.error === "access_denied") return done(reject, new Error(tr("The connection was cancelled in AgentUI.")));
            if (data.error) return done(reject, new Error(tr("AgentUI could not finish the connection. Press Connect to AgentUI again.")));
            if (typeof data.code !== "string" || !data.code || data.code.length > 4096) {
                return done(reject, new Error(tr("AgentUI did not send a connection code. Press Connect to AgentUI again.")));
            }
            done(resolve, data.code);
        };
        // Closed without answering: give a late message a moment, then stop waiting.
        const watch = setInterval(() => {
            if (!popup.closed) return;
            closedSince = closedSince || Date.now();
            if (Date.now() - closedSince > 1500) done(resolve, null);
        }, 500);
        const expire = setTimeout(() => done(reject, new Error(tr("The connection took too long. Press Connect to AgentUI again."))), WAIT_MS);
        window.addEventListener("message", onMessage);
    });
}

/**
 * Trade the code for a connector token, in key mode: this browser creates an
 * Odoo API key for the admin (Odoo Online, Custom plan: external API) and
 * hands it to AgentUI with the code. AgentUI logs in to Odoo with it before
 * answering. Returns false when the admin cancelled the password check.
 */
export async function finishConnect(orm, dialog, settings, code) {
    const key = await createApiKey(orm, dialog);
    if (!key) return false;
    let res;
    try {
        res = await agentuiFetch(settings.api_url, "/odoo-connector/token", {
            method: "POST",
            json: { code, login: currentLogin(), odooApiKey: key },
            timeout: 45000,
        });
    } catch (e) {
        await removeNewestKey(orm);
        throw e;
    }
    const data = res.body?.data || {};
    if (res.status !== 200 || !data.accessToken) {
        await removeNewestKey(orm);
        throw new Error(errorText(res.body, tr("AgentUI could not finish the connection. Press Connect to AgentUI again.")));
    }
    const secret = await readSecret(orm);
    if (!secret.id) throw new Error(tr("The AgentUI module is missing its data. Import the module again."));
    await orm.write(SECRET_MODEL, [secret.id], {
        x_token: data.accessToken,
        x_expires_at: data.expiresAt ? String(data.expiresAt) : false,
        x_email: data.email || false,
    });
    await orm.write(SETTINGS_MODEL, [settings.id], {
        x_connected: true,
        x_needs_reconnect: false,
        x_company_name: data.companyName || false,
        x_integration_id: data.integrationId ? String(data.integrationId) : false,
    });
    // AgentUI now holds the new key: the ones from earlier connects are unused.
    await removeOlderKeys(orm);
    return true;
}
