/** @odoo-module **/
// Odoo 15-17 stand-in for @web/core/user (Odoo 18+), from the session info.
import { session } from "@web/session";

export const user = {
    get userId() { return session.uid; },
    get login() { return session.username; },
    get lang() { return (session.user_context || {}).lang; },
    async hasGroup(group) {
        if (group === "base.group_system") return Boolean(session.is_system);
        throw new Error("compat_user: unsupported group " + group);
    },
};
