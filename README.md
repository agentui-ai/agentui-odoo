# AI App Builder for Odoo | AgentUI (Odoo 16)

**Build custom apps, dashboards and customer portals on your Odoo data. Describe what you need and AgentUI builds it. No code.**

This branch (`16.0`) holds **`agentui_online`** for **Odoo 16** on Odoo.sh or on-premise: a data module with no Python. (Odoo Online no longer runs Odoo 16; Odoo Online customers use the 18, 19 or 20 branch.)

## Requirements
- Odoo 16 on Odoo.sh or on-premise.
- An Odoo administrator to connect it once.

## Install
1. Install it from the Odoo Apps Store, or download this folder as a zip.
2. Zip install: activate developer mode, then **Apps → Import Module**, upload the zip, Install.
3. Open **AgentUI** on the Odoo home screen and press **Connect to AgentUI**. Approve in the AgentUI window and confirm your Odoo password: the module creates the API key for you.

## Source
The source lives on branch [`18.0`](https://github.com/agentui-ai/agentui-odoo/tree/18.0) (`agentui_online/`); this branch is built from it with `node tools/build_online.mjs 16` (it swaps in a stand-in for `@web/core/user`, the older Dropdown markup, and `owl="1"` on templates).

License: LGPL-3.
