/** @odoo-module **/
import { Component, onWillStart, onWillUnmount, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { browser } from "@web/core/browser/browser";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { AgentUIAppList } from "./agentui_hub_apps";

const PROMPT_MAX = 1800;

/** The AgentUI menu: connect, describe a new app, see every app, sync, disconnect. */
export class AgentUIHub extends Component {
    static template = "agentui_connector.Hub";
    static props = ["*"];
    static components = { Dropdown, DropdownItem, AgentUIAppList };

    setup() {
        this.promptRef = useRef("prompt");
        this.action = useService("action");
        this.notification = useService("notification");
        const params = new URLSearchParams(browser.location.search);
        this.state = useState({ info: null, busy: false, prompt: "", mode: "apps", error: params.get("agentui_error") || "" });
        this.connecting = params.get("agentui_connecting") === "1";
        onWillStart(() => this.load());
        // Back from AgentUI after approving: a cron job finishes the connection.
        if (this.connecting) this.pollConnect(0);
        // Back from building in AgentUI: pick up the new app without a click.
        this.onVisible = () => {
            if (document.visibilityState === "visible" && this.state.info?.connected && this.state.info?.is_admin) {
                this.quietSync();
            }
        };
        document.addEventListener("visibilitychange", this.onVisible);
        onWillUnmount(() => document.removeEventListener("visibilitychange", this.onVisible));
    }

    async load() {
        this.state.info = await rpc("/agentui_connector/info", {});
    }

    async pollConnect(attempt) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await this.load();
        if (this.state.info.connecting && attempt < 45) return this.pollConnect(attempt + 1);
        this.state.error = this.state.info.connect_error || (this.state.info.connecting ? _t("AgentUI is taking longer than usual. Reload this page in a minute.") : "");
        if (this.state.info.connected && !this.state.error) {
            // The cron syncs too, but may still be fetching icons: sync before
            // reloading so the home screen shows every app at once.
            await rpc("/agentui_connector/sync", {}).catch(() => null);
            browser.location.assign(browser.location.pathname);
        }
    }

    get isAutomation() {
        return this.state.mode === "automations";
    }

    /** Same toggle as the AgentUI chat: an app/dashboard, or an automation. */
    setMode(mode) {
        this.state.mode = mode;
        this.focusPrompt();
    }

    get copy() {
        return this.isAutomation
            ? {
                  title: _t("What do you want to automate?"),
                  subtitle: _t("Describe the task in your own words. AgentUI runs it on your Odoo data, on a schedule."),
                  placeholder: _t("Example: every morning, email each customer with an overdue invoice a reminder with the amount due"),
                  after: _t("Your automation runs in AgentUI. You can see each run there."),
              }
            : {
                  title: _t("What app or dashboard do you need?"),
                  subtitle: _t("Describe it in your own words. AgentUI builds it on your Odoo data."),
                  placeholder: _t("Example: a dashboard of this month's sales by salesperson, with overdue invoices per customer"),
                  after: _t("Your new app shows up below and in the Odoo home menu."),
              };
    }

    /** Example requests: a click fills the box, nothing is sent. */
    get ideas() {
        if (this.isAutomation) {
            return [
                { label: _t("Overdue invoice reminders"), prompt: _t("Every morning, email each customer with an overdue invoice a friendly reminder with the amount due") },
                { label: _t("Daily sales summary"), prompt: _t("Every day at 6 PM, email me a summary of today's sales orders by salesperson") },
                { label: _t("Low stock alert"), prompt: _t("Every morning, email the purchasing team the products below their minimum stock") },
                { label: _t("New leads digest"), prompt: _t("Every hour, email the sales team the new CRM leads with their contact details") },
            ];
        }
        return [
            { label: _t("Sales dashboard"), prompt: _t("A dashboard of this month's sales by salesperson, with overdue invoices per customer") },
            { label: _t("Customer portal"), prompt: _t("A portal where my customers see their orders and invoices") },
            { label: _t("Approval flow"), prompt: _t("Purchase approvals: a manager approves or rejects each purchase order, with a comment") },
            { label: _t("Field service form"), prompt: _t("A mobile form for technicians to log each visit with photos, parts used and the customer's signature") },
        ];
    }

    get steps() {
        return [
            { title: _t("Connect"), text: _t("An Odoo administrator connects AgentUI once.") },
            { title: _t("Describe"), text: _t("Write the app you need, like you would to a colleague.") },
            { title: _t("Open it in Odoo"), text: _t("Each app gets its own entry in the Odoo home menu.") },
        ];
    }

    useIdea(idea) {
        this.state.prompt = idea.prompt;
        this.focusPrompt();
    }

    focusPrompt() {
        this.promptRef.el?.focus();
    }

    connect() {
        browser.location.assign("/agentui_connector/oauth/start");
    }

    openApp(app) {
        this.action.doAction(app.action_id);
    }

    /** One of the app's ⋯ options: that panel of the app in the AgentUI builder, inside Odoo. */
    manageApp(app, item) {
        this.action.doAction({
            type: "ir.actions.client",
            tag: "agentui_connector.builder",
            name: `${app.name} · ${item.label}`,
            params: { agentui_url: this.state.info.agentui_url, intent: item.intent, panel: item.panel, project_id: app.agentui_id },
        });
    }

    buildPrompt() {
        const request = this.state.prompt.trim();
        return request ? `${request}\n\nUse my Odoo data (${this.state.info.odoo_host}).`.slice(0, PROMPT_MAX) : "";
    }

    /** The AgentUI builder, chat and preview, inside Odoo. */
    build() {
        const prompt = this.buildPrompt();
        if (!prompt) return this.focusPrompt();
        this.action.doAction({
            type: "ir.actions.client",
            tag: "agentui_connector.builder",
            name: this.isAutomation ? _t("Build an automation") : _t("Build an app"),
            params: { prompt, mode: this.state.mode, agentui_url: this.state.info.agentui_url },
        });
    }

    buildInNewTab() {
        const prompt = this.buildPrompt();
        if (!prompt) return this.focusPrompt();
        const query = new URLSearchParams({ ns: "platform", intent: "start-app", prompt, mode: this.state.mode });
        browser.open(`${this.state.info.agentui_url}/dl?${query}`, "_blank", "noopener");
        this.state.prompt = "";
    }

    async quietSync() {
        try {
            const before = this.state.info.apps.length;
            const res = await rpc("/agentui_connector/sync", {});
            await this.load();
            if (res?.error) return;
            if (this.state.info.apps.length > before) {
                this.notification.add(_t("New app added. Reload the page to see it on the home screen."), { type: "info" });
            }
        } catch {
            // The visible Sync apps button reports errors; a background sync stays quiet.
        }
    }

    async run(route, successMessage) {
        this.state.busy = true;
        this.state.error = "";
        try {
            const res = await rpc(route, {});
            if (res?.error) {
                this.state.error = res.error;
                await this.load();
                this.state.busy = false;
                return;
            }
            this.notification.add(successMessage, { type: "success" });
            // Home-screen icons changed: reload so the new menus show up.
            browser.location.reload();
        } catch (e) {
            this.state.error = e?.data?.message || e?.message || _t("Something went wrong. Try again.");
            this.state.busy = false;
        }
    }

    sync() {
        return this.run("/agentui_connector/sync", _t("Apps synced"));
    }

    disconnect() {
        return this.run("/agentui_connector/disconnect", _t("AgentUI disconnected"));
    }
}

registry.category("actions").add("agentui_connector.main", AgentUIHub);
