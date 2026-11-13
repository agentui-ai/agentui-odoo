/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { tr } from "./i18n";
import { DEFAULT_APP_URL, ICON_SRC, adoptProps, cleanBaseUrl, goToHub } from "./config";

/**
 * The AgentUI builder (chat + preview) inside Odoo. The first time, AgentUI
 * asks to confirm in a small AgentUI window; Odoo never sees AgentUI
 * credentials.
 */
export class AgentUIBuilder extends Component {
    static template = "agentui_online.Builder";

    setup() {
        adoptProps(this);
        this.nav = { menu: useService("menu"), action: useService("action") };
        this.tr = tr;
        this.iconSrc = ICON_SRC;
        // AgentUI takes a few seconds to load: show it is coming, not a blank page.
        this.state = useState({ loading: true });
    }

    onLoad() {
        this.state.loading = false;
    }

    goBack() {
        return goToHub(this.nav);
    }

    get src() {
        const params = this.props.action?.params || {};
        const base = cleanBaseUrl(params.agentui_url, DEFAULT_APP_URL);
        const query = new URLSearchParams();
        if (params.intent && params.project_id) {
            // An app's ⋯ option: open that panel of the app (AgentUI allowlists it).
            query.set("intent", params.intent);
            query.set("projectId", params.project_id);
            if (params.panel) query.set("panel", params.panel);
        } else {
            query.set("prompt", params.prompt || "");
            if (params.mode === "automations") query.set("mode", "automations");
        }
        return `${base}/embed/builder/?${query}`;
    }
}

registry.category("actions").add("agentui_online.builder", AgentUIBuilder);
