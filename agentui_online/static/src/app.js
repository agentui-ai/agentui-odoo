/** @odoo-module **/
import { Component, onWillStart, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { session } from "@web/session";
import { tr } from "./i18n";
import { agentuiFetch } from "./api";
import { APP_MODEL, ICON_SRC, SIGNIN_MODEL, adoptProps, goToHub, originOf, readSettings } from "./config";
import { randomState } from "./connect";

const SIGN_IN_TIMEOUT_MS = 3000;

/**
 * App URL that opens already signed in as this Odoo user, when AgentUI allows
 * it; the plain app URL otherwise.
 *
 * Odoo Online has no server of ours to vouch for the user, so this browser
 * writes a one-time proof record (x_agentui_signin: a random nonce + the app).
 * Odoo stamps who created it. AgentUI reads that record with the connected
 * admin's API key, so the user it signs in is the one Odoo says, not one the
 * browser claims. AgentUI only signs in plain app users whose email is the
 * Odoo login; anyone else gets the app's own sign-in screen.
 */
async function signInUrl(orm, app) {
    try {
        const settings = await readSettings(orm);
        if (!settings.x_integration_id) return app.url;
        const nonce = randomState(48);
        const [proofId] = await orm.silent.create(SIGNIN_MODEL, [{ x_nonce: nonce, x_workflow_id: app.agentui_id }]);
        const { status, body } = await agentuiFetch(settings.api_url, "/odoo-connector/online-sign-in", {
            method: "POST",
            json: {
                odooUrl: window.location.origin,
                database: session.db || "",
                integrationId: settings.x_integration_id,
                proofId,
                nonce,
                workflowId: app.agentui_id,
            },
            timeout: SIGN_IN_TIMEOUT_MS,
        });
        const url = status === 200 && typeof body?.data?.url === "string" ? body.data.url : "";
        // Same app origin only: never let a response steer the iframe elsewhere.
        return url.startsWith(`${originOf(app.url)}/`) ? url : app.url;
    } catch {
        return app.url;
    }
}

/** One AgentUI app, full screen inside Odoo. */
export class AgentUIApp extends Component {
    static template = "agentui_online.App";

    setup() {
        adoptProps(this);
        this.nav = { menu: useService("menu"), action: useService("action") };
        this.tr = tr;
        this.iconSrc = ICON_SRC;
        this.orm = useService("orm");
        this.state = useState({ app: null, loading: true, error: "" });
        onWillStart(async () => {
            const appId = Number(this.props.action?.params?.app_id);
            const [row] = appId ? await this.orm.read(APP_MODEL, [appId], ["x_name", "x_url", "x_agentui_id"]).catch(() => []) : [];
            const url = row?.x_url || "";
            if (!row || !(url.startsWith("https://") || url.startsWith("http://"))) {
                this.state.error = tr("This AgentUI app is no longer available. Ask an Odoo administrator to open the AgentUI menu and press Sync apps.");
                return;
            }
            const app = { name: row.x_name, url, agentui_id: row.x_agentui_id };
            this.state.app = { name: app.name, url: await signInUrl(this.orm, app) };
        });
    }

    goBack() {
        return goToHub(this.nav);
    }
}

registry.category("actions").add("agentui_online.app", AgentUIApp);
