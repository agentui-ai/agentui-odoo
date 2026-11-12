{
    "name": "AI App Builder for Odoo | AgentUI",
    "summary": "Build custom apps, dashboards, customer portals and AI agents on your Odoo data. Describe what you need and AI builds it. No code.",
    "version": "18.0.1.0.2",
    "category": "Productivity",
    "author": "AgentUI",
    "website": "https://agentui.ai",
    "license": "LGPL-3",
    "depends": ["base", "web"],
    "data": [
        "views/res_config_settings_views.xml",
        "views/agentui_menus.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "agentui_connector/static/src/**/*",
        ],
    },
    "images": ["static/description/banner.png"],
    "installable": True,
    "application": True,
}
