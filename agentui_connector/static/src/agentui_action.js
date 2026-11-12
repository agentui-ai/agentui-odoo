/** @odoo-module **/
import { Component, onWillStart, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

export class AgentUIAction extends Component {
    static template = "agentui_connector.AgentUIAction";
    static props = ["*"];

    setup() {
        this.notification = useService("notification");
        this.state = useState({ info: null });
        onWillStart(async () => {
            this.state.info = await rpc("/agentui_connector/info", {});
        });
    }

    get connectUrl() {
        const params = new URLSearchParams({
            ns: "platform",
            intent: "connect-integration",
            provider: "odoo",
        });
        return `${this.state.info.agentui_url}/dl?${params}`;
    }

    get fields() {
        const info = this.state.info;
        return [
            { key: "url", label: _t("Odoo URL"), value: info.odoo_url },
            { key: "db", label: _t("Database"), value: info.database },
            { key: "login", label: _t("Username"), value: info.login },
        ];
    }

    async copy(value) {
        try {
            await navigator.clipboard.writeText(value);
            this.notification.add(_t("Copied"), { type: "success" });
        } catch {
            this.notification.add(_t("Couldn't copy. Select the text and copy it by hand."), {
                type: "warning",
            });
        }
    }
}

registry.category("actions").add("agentui_connector.main", AgentUIAction);
