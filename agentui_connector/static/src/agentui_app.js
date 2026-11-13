/** @odoo-module **/
import { Component, onWillStart, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";

/** One AgentUI app, full screen inside Odoo. */
export class AgentUIApp extends Component {
    static template = "agentui_connector.App";
    static props = ["*"];

    /** Back to the AgentUI menu in Odoo (the hub). */
    goBack() {
        // Through the menu service, so the Odoo navbar shows AgentUI again
        // (a plain doAction keeps the previous app's name in the navbar).
        const menu = this.env.services.menu;
        const hub = menu.getApps().find((app) => app.xmlid === "agentui_connector.menu_agentui_root");
        if (hub) return menu.selectMenu(hub);
        return this.env.services.action.doAction("agentui_connector.action_agentui_main", { clearBreadcrumbs: true });
    }

    setup() {
        this.state = useState({ app: null, loading: true });
        onWillStart(async () => {
            const appId = this.props.action?.params?.app_id;
            this.state.app = await rpc(`/agentui_connector/app/${appId}`, {});
        });
    }
}

registry.category("actions").add("agentui_connector.app", AgentUIApp);
