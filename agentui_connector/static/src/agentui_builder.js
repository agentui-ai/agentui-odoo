/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";

/**
 * The AgentUI builder (chat + preview) inside Odoo. The first time, AgentUI
 * asks to confirm in a small AgentUI window; Odoo never sees AgentUI
 * credentials.
 */
export class AgentUIBuilder extends Component {
    static template = "agentui_connector.Builder";
    static props = ["*"];

    setup() {
        // AgentUI takes a few seconds to load: show it is coming, not a blank page.
        this.state = useState({ loading: true });
    }

    onLoad() {
        this.state.loading = false;
    }

    /** Back to the AgentUI menu in Odoo (the hub). */
    goBack() {
        // Through the menu service, so the Odoo navbar shows AgentUI again
        // (a plain doAction keeps the previous app's name in the navbar).
        const menu = this.env.services.menu;
        const hub = menu.getApps().find((app) => app.xmlid === "agentui_connector.menu_agentui_root");
        if (hub) return menu.selectMenu(hub);
        return this.env.services.action.doAction("agentui_connector.action_agentui_main", { clearBreadcrumbs: true });
    }

    get src() {
        const params = this.props.action?.params || {};
        const base = String(params.agentui_url || "https://app.agentui.ai").replace(/\/$/, "");
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

registry.category("actions").add("agentui_connector.builder", AgentUIBuilder);
