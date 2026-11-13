/** @odoo-module **/
import { tr } from "./i18n";

const TIMEOUT_MS = 20000;
// Answers from AgentUI that mean this exact connection is gone for good.
export const REVOKED_CODES = ["CONNECTOR_COMPANY_CHANGED", "NOT_A_CONNECTOR_TOKEN"];

export class AgentUIUnreachable extends Error {}

/**
 * Call the AgentUI API from this browser (Odoo Online runs no Python, so
 * there is no server to call from). Never throws on an HTTP status: returns
 * { status, body }. Throws AgentUIUnreachable when nothing answered.
 */
export async function agentuiFetch(apiUrl, path, { method = "GET", token = null, json = undefined, timeout = TIMEOUT_MS } = {}) {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
        res = await fetch(apiUrl + path, {
            method,
            headers,
            body: json === undefined ? undefined : JSON.stringify(json),
            // The bearer token is the credential: no AgentUI cookies.
            credentials: "omit",
            signal: controller.signal,
        });
    } catch (e) {
        throw new AgentUIUnreachable(
            tr("AgentUI did not answer (%(reason)s). Check your internet connection and try again.", {
                reason: e?.name === "AbortError" ? tr("timed out") : e?.message || "network error",
            })
        );
    } finally {
        clearTimeout(timer);
    }
    let body = {};
    try {
        body = (await res.json()) || {};
    } catch {
        body = {};
    }
    return { status: res.status, body };
}

/** The error AgentUI wrote for people, or a plain fallback. */
export function errorText(body, fallback) {
    const text = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : "";
    return text.slice(0, 400) || fallback;
}
