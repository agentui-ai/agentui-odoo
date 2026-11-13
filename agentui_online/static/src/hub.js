/** @odoo-module **/
import { Component, onWillStart, onWillUnmount, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { browser } from "@web/core/browser/browser";
import { useService } from "@web/core/utils/hooks";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { AgentUIAppList } from "./hub_apps";
import { tr } from "./i18n";
import { ICON_SRC, loadHubInfo, SETTINGS_ACTION_XMLID } from "./config";
import { finishConnect, waitForConnectCode } from "./connect";
import { disconnect, syncApps } from "./sync";

const PROMPT_MAX = 1800;

/** The AgentUI menu: connect, describe a new app, see every app, sync, disconnect. */
export class AgentUIHub extends Component {
    static template = "agentui_online.Hub";
    static components = { Dropdown, DropdownItem, AgentUIAppList };

    setup() {
        this.tr = tr;
        this.iconSrc = ICON_SRC;
        // No t-ref: Odoo 20 (Owl 3) changed refs; the element has a fixed id.
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        this.state = useState({ info: null, busy: false, connecting: false, syncing: null, prompt: "", mode: "apps", error: "" });
        // odoo.debug, not env.debug: Odoo 20 removed env.debug.
        this.debug = Boolean(window.odoo?.debug);
        onWillStart(() => this.load());
        // Back from building in AgentUI: pick up the new app without a click.
        this.onVisible = () => {
            if (document.visibilityState === "visible" && this.state.info?.connected && this.state.info?.is_admin && !this.state.info?.needs_reconnect && !this.state.busy) {
                this.quietSync();
            }
        };
        document.addEventListener("visibilitychange", this.onVisible);
        onWillUnmount(() => document.removeEventListener("visibilitychange", this.onVisible));
    }

    async load() {
        this.state.info = await loadHubInfo(this.orm);
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
                  title: tr("What do you want to automate?"),
                  subtitle: tr("Describe the task in your own words. AgentUI runs it on your Odoo data, on a schedule."),
                  placeholder: tr("Example: every morning, email each customer with an overdue invoice a reminder with the amount due"),
                  after: tr("Your automation runs in AgentUI. You can see each run there."),
              }
            : {
                  title: tr("What app or dashboard do you need?"),
                  subtitle: tr("Describe it in your own words. AgentUI builds it on your Odoo data."),
                  placeholder: tr("Example: a dashboard of this month's sales by salesperson, with overdue invoices per customer"),
                  after: tr("Your new app shows up below and in the Odoo home menu."),
              };
    }

    /** Example requests: a click fills the box, nothing is sent. */
    get ideas() {
        if (this.isAutomation) {
            return [
                { label: tr("Overdue invoice reminders"), prompt: tr("Every morning, email each customer with an overdue invoice a friendly reminder with the amount due") },
                { label: tr("Daily sales summary"), prompt: tr("Every day at 6 PM, email me a summary of today's sales orders by salesperson") },
                { label: tr("Low stock alert"), prompt: tr("Every morning, email the purchasing team the products below their minimum stock") },
                { label: tr("New leads digest"), prompt: tr("Every hour, email the sales team the new CRM leads with their contact details") },
            ];
        }
        return [
            { label: tr("Sales dashboard"), prompt: tr("A dashboard of this month's sales by salesperson, with overdue invoices per customer") },
            { label: tr("Customer portal"), prompt: tr("A portal where my customers see their orders and invoices") },
            { label: tr("Approval flow"), prompt: tr("Purchase approvals: a manager approves or rejects each purchase order, with a comment") },
            { label: tr("Field service form"), prompt: tr("A mobile form for technicians to log each visit with photos, parts used and the customer's signature") },
        ];
    }

    get steps() {
        return [
            { title: tr("Connect"), text: tr("An Odoo administrator connects AgentUI once.") },
            { title: tr("Describe"), text: tr("Write the app you need, like you would to a colleague.") },
            { title: tr("Open it in Odoo"), text: tr("Each app gets its own entry in the Odoo home menu.") },
        ];
    }

    useIdea(idea) {
        this.state.prompt = idea.prompt;
        this.focusPrompt();
    }

    focusPrompt() {
        document.getElementById("agentui_prompt")?.focus();
    }

    /** Admin: approve in an AgentUI window, then trade the code from this browser. */
    async connect() {
        if (this.state.connecting) return;
        this.state.error = "";
        this.state.connecting = true;
        try {
            const settings = this.state.info.settings;
            const code = await waitForConnectCode(settings.app_url);
            if (!code) return; // closed the window: nothing to report
            if (!(await finishConnect(this.orm, this.dialog, settings, code))) return; // password check cancelled
            // Connected: say so, then show the apps arriving (Odoo Online is far
            // away; a silent minute looked like a frozen page).
            this.state.connecting = false;
            await this.load().catch(() => null);
            await this.syncWithProgress().catch(() => null);
            // Home-screen icons changed: reload so the new menus show up.
            browser.location.reload();
        } catch (e) {
            this.state.error = e?.data?.message || e?.message || tr("Something went wrong. Try again.");
            await this.load().catch(() => null);
        } finally {
            this.state.connecting = false;
        }
    }

    openApp(app) {
        if (app.action_id) this.action.doAction(app.action_id);
    }

    /** One of the app's ⋯ options: that panel of the app in the AgentUI builder, inside Odoo. */
    manageApp(app, item) {
        this.action.doAction({
            type: "ir.actions.client",
            tag: "agentui_online.builder",
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
            tag: "agentui_online.builder",
            name: this.isAutomation ? tr("Build an automation") : tr("Build an app"),
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

    syncWithProgress() {
        this.state.syncing = { done: 0, total: 0 };
        return syncApps(this.orm, this.state.info.settings, (done, total) => {
            this.state.syncing = { done, total };
        }).finally(() => {
            this.state.syncing = null;
        });
    }

    async quietSync() {
        try {
            const res = await syncApps(this.orm, this.state.info.settings);
            await this.load();
            if (res.added) {
                this.notification.add(tr("New app added. Reload the page to see it on the home screen."), { type: "info" });
            }
        } catch {
            // The visible Sync apps button reports errors; a background sync stays quiet.
            await this.load().catch(() => null);
        }
    }

    async run(work, successMessage) {
        this.state.busy = true;
        this.state.error = "";
        try {
            await work(this.orm, this.state.info.settings);
            this.notification.add(successMessage, { type: "success" });
            // Home-screen icons changed: reload so the new menus show up.
            browser.location.reload();
        } catch (e) {
            this.state.error = e?.data?.message || e?.message || tr("Something went wrong. Try again.");
            await this.load().catch(() => null);
            this.state.busy = false;
        }
    }

    sync() {
        return this.run(() => this.syncWithProgress(), tr("Apps synced"));
    }

    disconnect() {
        return this.run(disconnect, tr("AgentUI disconnected"));
    }

    /** Developer mode: point the module at another AgentUI (local development). */
    editAddresses() {
        this.action.doAction(SETTINGS_ACTION_XMLID, { onClose: () => browser.location.reload() });
    }
}

registry.category("actions").add("agentui_online.main", AgentUIHub);
