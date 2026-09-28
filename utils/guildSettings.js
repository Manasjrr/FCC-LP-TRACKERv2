// ─── Paramètres par serveur (table guild_settings) ───────────────────────────

// Style de la vignette des notifications de groupe (3+ joueurs / face-à-face Flex)
const GROUP_THUMBNAIL_STYLES = ["gif", "mosaique"];
const DEFAULT_GROUP_THUMBNAIL = "gif";

function getGuildSettings(guildId) {
    return global.db.prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`).get(guildId) ?? null;
}

function isFlexEnabled(guildId) {
    return Boolean(getGuildSettings(guildId)?.flex_notifications);
}

function setFlexEnabled(guildId, enabled) {
    global.db.prepare(`
        INSERT INTO guild_settings (guild_id, flex_notifications) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET flex_notifications = excluded.flex_notifications
    `).run(guildId, enabled ? 1 : 0);
}

function getGroupThumbnailStyle(guildId) {
    const style = getGuildSettings(guildId)?.group_thumbnail;
    return GROUP_THUMBNAIL_STYLES.includes(style) ? style : DEFAULT_GROUP_THUMBNAIL;
}

function setGroupThumbnailStyle(guildId, style) {
    global.db.prepare(`
        INSERT INTO guild_settings (guild_id, group_thumbnail) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET group_thumbnail = excluded.group_thumbnail
    `).run(guildId, style);
}

module.exports = {
    GROUP_THUMBNAIL_STYLES,
    isFlexEnabled,
    setFlexEnabled,
    getGroupThumbnailStyle,
    setGroupThumbnailStyle,
};
