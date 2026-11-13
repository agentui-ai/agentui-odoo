/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { Dropdown } from "@web/core/dropdown/dropdown";
import { DropdownItem } from "@web/core/dropdown/dropdown_item";
import { tr } from "./i18n";
import { adoptProps } from "./config";

const SEARCH_FROM = 9;
// Soft background + readable text, picked per app name so a tile keeps its color.
const TILE_COLORS = [
    ["#ececf8", "#4f51a0"],
    ["#e5f3ea", "#2f6b3f"],
    ["#fcefdf", "#93560f"],
    ["#e5effa", "#2b5c8a"],
    ["#fae8ee", "#983550"],
    ["#e3f3f3", "#2a6767"],
    ["#f1eafa", "#6b3fa0"],
    ["#efefec", "#55534e"],
];

/** The list of AgentUI apps in the hub: search (when there are many) and cards. */
export class AgentUIAppList extends Component {
    static template = "agentui_online.AppList";
    static components = { Dropdown, DropdownItem };

    /** Each opens that panel of the app in the AgentUI builder, inside Odoo. */
    get manageItems() {
        return [
            { key: "edit", icon: "fa-magic", label: tr("Edit with AI"), intent: "open-panel", panel: "overview" },
            { key: "users", icon: "fa-users", label: tr("Users"), intent: "open-panel", panel: "users" },
            { key: "authentication", icon: "fa-lock", label: tr("Sign-in"), intent: "open-panel", panel: "authentication" },
            { key: "domains", icon: "fa-globe", label: tr("Domains"), intent: "open-panel", panel: "domains" },
            { key: "data", icon: "fa-database", label: tr("Data"), intent: "open-app-data" },
            { key: "data-security", icon: "fa-shield", label: tr("Data security"), intent: "open-panel", panel: "data-security" },
            { key: "integrations", icon: "fa-plug", label: tr("Integrations"), intent: "open-panel", panel: "integrations" },
            { key: "activity", icon: "fa-list-alt", label: tr("Activity"), intent: "open-panel", panel: "activity" },
            { key: "settings", icon: "fa-cog", label: tr("Settings"), intent: "open-panel", panel: "settings" },
        ];
    }

    setup() {
        adoptProps(this);
        this.tr = tr;
        this.state = useState({ query: "" });
    }

    get showSearch() {
        return this.props.apps.length >= SEARCH_FROM;
    }

    get visibleApps() {
        const query = this.state.query.trim().toLowerCase();
        if (!query) return this.props.apps;
        return this.props.apps.filter((app) => `${app.name} ${app.description}`.toLowerCase().includes(query));
    }

    initials(app) {
        const words = (app.name || "").match(/[\p{L}\p{N}]+/gu) || ["?"];
        return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    }

    tileStyle(app) {
        let hash = 0;
        for (const ch of app.name || "") hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
        const [bg, fg] = TILE_COLORS[hash % TILE_COLORS.length];
        return `background-color: ${bg}; color: ${fg};`;
    }
}
