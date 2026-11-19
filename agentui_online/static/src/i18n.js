/** @odoo-module **/
import { _t } from "@web/core/l10n/translation";
import { user } from "./compat_user";
import { ES } from "./i18n_es";

/**
 * Odoo loads JavaScript translations from .po files on the server's disk
 * (CodeTranslations). An imported data module has no files on disk, so _t()
 * never finds ours: the Spanish strings ship in i18n_es.js, generated from
 * i18n/es.po (tools/online_i18n.mjs). Placeholders: %(name)s.
 */
export function tr(source, values = null) {
    const lang = String(user.lang || "en_US");
    let text = lang.startsWith("es") && ES[source] ? ES[source] : String(_t(source));
    if (values) {
        for (const [key, value] of Object.entries(values)) {
            text = text.split(`%(${key})s`).join(String(value ?? ""));
        }
    }
    return text;
}
