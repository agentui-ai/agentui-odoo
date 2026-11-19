/** @odoo-module **/
import { user } from "./compat_user";
import { tr } from "./i18n";
import { AgentUIPasswordDialog } from "./password_dialog";

const KEY_NAME = "AgentUI";

/** The key, from make_key's "API Key Ready" action. Never displayed. */
function keyFrom(action) {
    return action?.res_model === "res.users.apikeys.show" ? action.context?.default_key || null : null;
}

function rpcMessage(e) {
    return e?.data?.message || e?.message || tr("Something went wrong. Try again.");
}

/**
 * Odoo asks for the password again (check_identity) when it was not checked
 * in the last 10 minutes. Resolves the identity-check result, or null when the
 * admin cancelled.
 */
function confirmPassword(orm, dialog, wizardId) {
    return new Promise((resolve) => {
        let done = false;
        dialog.add(
            AgentUIPasswordDialog,
            {
                onConfirm: async (password) => {
                    try {
                        // Odoo 18 reads the password from the wizard's field;
                        // Odoo 19+ from the call's context. Send it both ways.
                        await orm.silent.write("res.users.identitycheck", [wizardId], { password }).catch(() => null);
                        const result = await orm.silent.call("res.users.identitycheck", "run_check", [[wizardId]], { context: { password } });
                        done = true;
                        resolve(result);
                        return null;
                    } catch (e) {
                        return rpcMessage(e);
                    }
                },
            },
            { onClose: () => !done && resolve(null) }
        );
    });
}

/**
 * Create a persistent Odoo API key for the current admin, named "AgentUI".
 * Returns the key, or null if the admin cancelled the password check.
 */
export async function createApiKey(orm, dialog) {
    const [descriptionId] = await orm.silent.create("res.users.apikeys.description", [{ name: KEY_NAME }]);
    let result = await orm.silent.call("res.users.apikeys.description", "make_key", [[descriptionId]]);
    if (result?.res_model === "res.users.identitycheck" && result.res_id) {
        result = await confirmPassword(orm, dialog, result.res_id);
        if (!result) return null;
    }
    const key = keyFrom(result);
    if (!key) throw new Error(tr("Odoo did not create the API key. Press Connect to AgentUI again."));
    return key;
}

/** This user's "AgentUI" keys, newest first. */
async function agentuiKeys(orm) {
    const [me] = await orm.silent.read("res.users", [user.userId], ["api_key_ids"]);
    const ids = me?.api_key_ids || [];
    if (!ids.length) return [];
    const keys = await orm.silent.read("res.users.apikeys", ids, ["name", "create_date"]);
    return keys.filter((k) => k.name === KEY_NAME).sort((a, b) => (a.create_date < b.create_date ? 1 : a.create_date > b.create_date ? -1 : b.id - a.id));
}

/**
 * remove() is also behind check_identity; it was just checked while creating
 * the key, so it runs directly. Best effort: a key left over is harmless and
 * the admin can delete it in Preferences > Account Security.
 */
async function removeKeys(orm, ids) {
    if (!ids.length) return;
    try {
        await orm.silent.call("res.users.apikeys", "remove", [ids]);
    } catch {
        // see above
    }
}

/** The connection failed: delete the key just made (the newest "AgentUI" key). */
export async function removeNewestKey(orm) {
    const keys = await agentuiKeys(orm).catch(() => []);
    await removeKeys(orm, keys.slice(0, 1).map((k) => k.id));
}

/** Connected: AgentUI holds the newest key, older "AgentUI" keys are unused. */
export async function removeOlderKeys(orm) {
    const keys = await agentuiKeys(orm).catch(() => []);
    await removeKeys(orm, keys.slice(1).map((k) => k.id));
}

export function currentLogin() {
    return user.login;
}
