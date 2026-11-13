#!/usr/bin/env node
// agentui_online translations.
//
// Odoo loads JavaScript translations only from .po files on the server's disk,
// and an imported data module (Odoo Online) has none. So the module ships its
// Spanish strings in static/src/i18n_es.js, generated from i18n/es.po.
//
//   node tools/online_i18n.mjs          # rewrite .pot, add new msgids to es.po, regenerate i18n_es.js
//   node tools/online_i18n.mjs --check  # exit 1 when a string has no Spanish translation
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "agentui_online");
const src = path.join(root, "static", "src");
const check = process.argv.includes("--check");

function unescape(s, quote) {
    return s.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c)).replace(new RegExp(`\\\\${quote}`, "g"), quote);
}

// 1. Every tr("...") / tr('...') in the JS and XML sources, with where it is.
const found = new Map();
for (const file of fs.readdirSync(src).sort()) {
    if (!/\.(js|xml)$/.test(file) || file === "i18n_es.js") continue;
    const text = fs.readFileSync(path.join(src, file), "utf8");
    const re = /\btr\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
    let m;
    while ((m = re.exec(text))) {
        const id = unescape(m[2], m[1]).replace(/&amp;/g, "&");
        if (!found.has(id)) found.set(id, new Set());
        found.get(id).add(`static/src/${file}`);
    }
}

// 2. Existing translations (ours first, then agentui_connector's for shared copy).
function readPo(file) {
    const out = new Map();
    if (!fs.existsSync(file)) return out;
    const blocks = fs.readFileSync(file, "utf8").split(/\n\s*\n/);
    const str = (block, key) => {
        const m = block.match(new RegExp(`^${key} ((?:".*"\\n?)+)`, "m"));
        if (!m) return null;
        return m[1].trim().split("\n").map((l) => JSON.parse(l.trim())).join("");
    };
    for (const block of blocks) {
        const id = str(block + "\n", "msgid");
        const value = str(block + "\n", "msgstr");
        if (id) out.set(id, value || "");
    }
    return out;
}
const ours = readPo(path.join(root, "i18n", "es.po"));
const connector = readPo(path.join(root, "..", "agentui_connector", "i18n", "es.po"));

const q = (s) => JSON.stringify(s);
const header = (lang) => `# Translation of Odoo Server.
# This file contains the translation of the following modules:
# \t* agentui_online
#
msgid ""
msgstr ""
"Project-Id-Version: Odoo Server 18.0\\n"
"Report-Msgid-Bugs-To: \\n"
"Last-Translator: \\n"
"Language-Team: \\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: \\n"
"Language: ${lang}\\n"
"Plural-Forms: \\n"
`;
const ids = [...found.keys()].sort((a, b) => a.localeCompare(b));
const entry = (id, value) =>
    `\n#. module: agentui_online\n#. odoo-javascript\n${[...found.get(id)].map((f) => `#: code:addons/agentui_online/${f}:0`).join("\n")}\nmsgid ${q(id)}\nmsgstr ${q(value)}\n`;

const missing = [];
const es = new Map();
for (const id of ids) {
    const value = ours.get(id) || connector.get(id) || "";
    if (!value) missing.push(id);
    es.set(id, value);
}
if (check) {
    if (missing.length) {
        console.error(`Missing Spanish for:\n${missing.map((m) => `  ${m}`).join("\n")}`);
        process.exit(1);
    }
    console.log(`OK: ${ids.length} strings translated`);
    process.exit(0);
}
fs.writeFileSync(path.join(root, "i18n", "agentui_online.pot"), header("") + ids.map((id) => entry(id, "")).join(""));
fs.writeFileSync(path.join(root, "i18n", "es.po"), header("es") + ids.map((id) => entry(id, es.get(id))).join(""));
const dict = ids.filter((id) => es.get(id)).map((id) => `    ${q(id)}: ${q(es.get(id))},`).join("\n");
fs.writeFileSync(
    path.join(src, "i18n_es.js"),
    `/** @odoo-module **/\n// Generated from i18n/es.po by tools/online_i18n.mjs. Do not edit by hand.\n// Odoo does not load JavaScript translations for imported (data) modules.\nexport const ES = {\n${dict}\n};\n`
);
console.log(`${ids.length} strings, ${missing.length} without Spanish`);
if (missing.length) console.log(missing.map((m) => `  ${m}`).join("\n"));
