#!/usr/bin/env node
// Build the agentui_online zip for one Odoo series (Odoo Online customers sit
// on different versions):  node tools/build_online.mjs 18|19|20 [out.zip]
// - manifest version gets the series prefix (18.0.x / 20.0.x)
// - Odoo 20+ replaced ir.model.access + ir.rule with ir.access: ship
//   security/access_ir_access.xml instead of security/access.xml.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const series = Number(process.argv[2]);
if (![18, 19, 20].includes(series)) {
    console.error("usage: node tools/build_online.mjs 18|19|20 [out.zip]");
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

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync("zip", ["-qr", out, "agentui_online"], { cwd: work });
fs.rmSync(work, { recursive: true });
console.log(`built ${out} (Odoo ${series}, ${keep})`);
