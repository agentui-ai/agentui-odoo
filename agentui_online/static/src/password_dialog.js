/** @odoo-module **/
import { Component, useState, onMounted } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { tr } from "./i18n";
import { adoptProps } from "./config";

// No t-ref: Odoo 20 (Owl 3) changed refs; the input has a fixed id.
const input = () => document.getElementById("agentui_password");

/**
 * Asks the admin to confirm their Odoo password, which Odoo requires before it
 * creates an API key. The password goes straight to Odoo's own identity check
 * (res.users.identitycheck) and is never kept: the field is cleared as soon as
 * it is handed over.
 */
export class AgentUIPasswordDialog extends Component {
    static template = "agentui_online.PasswordDialog";
    static components = { Dialog };

    setup() {
        adoptProps(this);
        this.tr = tr;
        this.state = useState({ busy: false, error: "" });
        onMounted(() => input()?.focus());
    }

    async confirm() {
        const password = input()?.value || "";
        if (!password) return input()?.focus();
        this.state.busy = true;
        this.state.error = "";
        if (input()) input().value = "";
        const error = await this.props.onConfirm(password);
        if (error) {
            this.state.error = error;
            this.state.busy = false;
            input()?.focus();
            return;
        }
        this.props.close();
    }

    /** The dialog service's onClose resolves the request as cancelled. */
    cancel() {
        this.props.close();
    }

    onKeydown(ev) {
        if (ev.key === "Enter") this.confirm();
    }
}
