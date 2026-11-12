{
    "name": "AgentUI",
    "summary": "Build apps and AI agents on top of your Odoo data, and open them inside Odoo.",
    "version": "18.0.1.0.0",
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
