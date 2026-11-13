# AI App Builder for Odoo Online | AgentUI (Odoo 20)

**Build custom apps, dashboards and customer portals on your Odoo data. Describe what you need and AgentUI builds it. No code.**

This branch (`20.0`) holds **`agentui_online`**, the AgentUI module for **Odoo Online** (odoo.com) on Odoo 20: a data module with no Python, so Odoo Online accepts it.

## Requirements
- Odoo Online on the **Custom** plan (Odoo only allows connecting other apps, its external API, on that plan). Odoo.sh and on-premise work too.
- An Odoo administrator to connect it once.

## Install
1. Install it from the Odoo Apps Store, or download this folder as a zip.
2. Zip install: activate developer mode, then **Apps → Import Module**, upload the zip, Install.
3. Open **AgentUI** on the Odoo home screen and press **Connect to AgentUI**. Approve in the AgentUI window and confirm your Odoo password: the module creates the API key for you.

If you sign in to Odoo with Google or Odoo.com, the password Odoo asks for is your odoo.com account password (reset it on odoo.com if you never set one).

## Source
The source lives on branch [`18.0`](https://github.com/agentui-ai/agentui-odoo/tree/18.0) (`agentui_online/`); this branch is built from it with `node tools/build_online.mjs 20` (Odoo 20 uses `ir.access` instead of `ir.model.access` + `ir.rule`).

License: LGPL-3.
