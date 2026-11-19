#!/usr/bin/env node
// Build the agentui_online zip for one Odoo series (Odoo Online customers sit
// on different versions):  node tools/build_online.mjs 15..20 [out.zip]
// - manifest version gets the series prefix (18.0.x / 20.0.x)
// - Odoo 20+ replaced ir.model.access + ir.rule with ir.access: ship
//   security/access_ir_access.xml instead of security/access.xml.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const COMPAT_USER = `/** @odoo-module **/
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
`;

const series = Number(process.argv[2]);
if (!(series >= 15 && series <= 20)) {
    console.error("usage: node tools/build_online.mjs 15..20 [out.zip]");
    process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "agentui_online");
const out = path.resolve(process.argv[3] || path.join(root, "dist", `agentui_online-${series}.0.zip`));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "agentui_online-"));
const dest = path.join(work, "agentui_online");
fs.cpSync(src, dest, { recursive: true, filter: (p) => !p.includes("__pycache__") });

const useIrAccess = series >= 20;
const keep = useIrAccess ? "security/access_ir_access.xml" : "security/access.xml";
const drop = useIrAccess ? "security/access.xml" : "security/access_ir_access.xml";
fs.rmSync(path.join(dest, drop));
const manifestPath = path.join(dest, "__manifest__.py");
let manifest = fs.readFileSync(manifestPath, "utf8");
manifest = manifest.replace(/"version": "\d+\.0\.([\d.]+)"/, `"version": "${series}.0.$1"`);
manifest = manifest.replace('"security/access.xml"', `"${keep}"`);
if (!manifest.includes(`"${keep}"`)) throw new Error("manifest has no security file entry");
fs.writeFileSync(manifestPath, manifest);

// Odoo 15-17 have no @web/core/user (added in 18): ship a tiny stand-in
// built on @web/session and point every import at it.
if (series < 18) {
    const srcDir = path.join(dest, "static", "src");
    fs.writeFileSync(path.join(srcDir, "compat_user.js"), COMPAT_USER);
    for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".js"))) {
        const p = path.join(srcDir, file);
        const js = fs.readFileSync(p, "utf8");
        if (js.includes('from "@web/core/user"')) fs.writeFileSync(p, js.replace('from "@web/core/user"', 'from "./compat_user"'));
    }
    // No "duration" on res.users.apikeys.description before 18: keys never expire there.
    const apiKeyJs = path.join(srcDir, "api_key.js");
    const withDuration = '{ name: KEY_NAME, duration: "0" }';
    const keyJs = fs.readFileSync(apiKeyJs, "utf8");
    if (!keyJs.includes(withDuration)) throw new Error("api_key.js changed: cannot drop duration");
    fs.writeFileSync(apiKeyJs, keyJs.replace(withDuration, "{ name: KEY_NAME }"));
    // Dropdown before 18: it renders its own toggler <button> (togglerClass, title,
    // disabled props + "toggler" slot) and the items go in the default slot.
    for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".xml"))) {
        const p = path.join(srcDir, file);
        const xml = fs.readFileSync(p, "utf8");
        const re = /<Dropdown([^>]*)>\s*<button([^>]*)>([\s\S]*?)<\/button>\s*<t t-set-slot="content">([\s\S]*?)<\/t>\s*<\/Dropdown>/g;
        const next = xml.replace(re, (_m, ddAttrs, btnAttrs, inner, items) => {
            const attr = (name) => (btnAttrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)) || [])[1];
            const props = [ddAttrs.trim()];
            if (attr("class")) props.push(`togglerClass="'${attr("class")}'"`);
            if (attr("t-att-title")) props.push(`title="${attr("t-att-title")}"`);
            if (attr("t-att-disabled")) props.push(`disabled="${attr("t-att-disabled")}"`);
            return `<Dropdown ${props.join(" ")}><t t-set-slot="toggler">${inner}</t>${items}</Dropdown>`;
        });
        if (xml.includes("<Dropdown") && next === xml) throw new Error(`${file}: Dropdown markup changed, cannot convert for Odoo ${series}`);
        fs.writeFileSync(p, next);
    }
    // Odoo 16 compiles a template with Owl 2 only when it says owl="1".
    if (series < 17) {
        for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".xml"))) {
            const p = path.join(srcDir, file);
            fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/<t t-name="([^"]+)"/g, '<t t-name="$1" owl="1"'));
        }
    }
    // Odoo Online never runs 15-17: those builds are for Odoo.sh and on-premise.
    const onlineName = '"name": "AI App Builder for Odoo Online | AgentUI"';
    const onlineSummary = /"summary": "[^"]*"/;
    if (!manifest.includes(onlineName)) throw new Error("manifest name changed");
    manifest = manifest.replace(onlineName, '"name": "AI App Builder for Odoo | AgentUI (no Python)"');
    manifest = manifest.replace(onlineSummary, '"summary": "Build custom apps, dashboards and customer portals on your Odoo data. No Python: install it from the Apps Store or Apps > Import Module."');
    const first = '"agentui_online/static/src/agentui.scss",';
    if (!manifest.includes(first)) throw new Error("manifest assets moved: cannot add compat_user.js");
    manifest = manifest.replace(first, `${first}\n            "agentui_online/static/src/compat_user.js",`);
    fs.writeFileSync(manifestPath, manifest);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync("zip", ["-qr", out, "agentui_online"], { cwd: work });
fs.rmSync(work, { recursive: true });
console.log(`built ${out} (Odoo ${series}, ${keep})`);
