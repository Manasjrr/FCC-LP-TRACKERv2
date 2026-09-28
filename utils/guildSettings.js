// ─── Paramètres par serveur (table guild_settings) ───────────────────────────

function isFlexEnabled(guildId) {
    const row = global.db.prepare(`SELECT flex_notifications FROM guild_settings WHERE guild_id = ?`).get(guildId);
    return Boolean(row?.flex_notifications);
}

function setFlexEnabled(guildId, enabled) {
    global.db.prepare(`
        INSERT INTO guild_settings (guild_id, flex_notifications) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET flex_notifications = excluded.flex_notifications
    `).run(guildId, enabled ? 1 : 0);
}

module.exports = { isFlexEnabled, setFlexEnabled };
