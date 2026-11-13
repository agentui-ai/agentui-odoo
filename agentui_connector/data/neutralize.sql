-- Copies of this database (Odoo.sh staging/dev builds, duplicated databases)
-- must not share production's AgentUI connection: disconnecting or syncing
-- from a copy would act on production's apps.
DELETE FROM ir_config_parameter WHERE key IN (
    'agentui_connector.access_token',
    'agentui_connector.pending_code',
    'agentui_connector.pending_key'
);
DELETE FROM ir_ui_menu WHERE id IN (SELECT menu_id FROM agentui_app WHERE menu_id IS NOT NULL);
DELETE FROM agentui_app;
