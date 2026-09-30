// ─── Internationalisation (i18n) ─────────────────────────────────────────────
// Chaque fichier de locales/ (en.js, fr.js...) est une langue, chargée automatiquement.
// Ajouter une langue = créer locales/<code>.js en copiant en.js puis en traduisant
// les valeurs : elle apparaît alors d'elle-même dans /language.
//
// Valeur d'une clé :
//   • string   → "Hello {name}" (les {variables} sont remplacées)
//   • function → (vars) => string (pluriels, phrases conditionnelles...)
// Une clé absente d'une langue retombe sur l'anglais (DEFAULT_LANGUAGE).

const fs = require("fs");
const path = require("path");

const DEFAULT_LANGUAGE = "en";
const LOCALES_DIR = path.join(__dirname, "../locales");

const LOCALES = Object.fromEntries(
    fs.readdirSync(LOCALES_DIR)
        .filter((file) => file.endsWith(".js"))
        .map((file) => [path.basename(file, ".js"), require(path.join(LOCALES_DIR, file))])
);

if (!LOCALES[DEFAULT_LANGUAGE]) {
    throw new Error(`Locale par défaut introuvable : locales/${DEFAULT_LANGUAGE}.js`);
}

// Langues disponibles : [{ code, name }]
const LANGUAGES = Object.entries(LOCALES).map(([code, locale]) => ({ code, name: locale.meta.name }));

function isSupportedLanguage(code) {
    return Boolean(LOCALES[code]);
}

function resolveKey(locale, key) {
    return key.split(".").reduce((node, part) => node?.[part], locale);
}

function interpolate(text, vars) {
    return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] ?? match));
}

// Texte traduit ; clé absente partout → la clé elle-même (repérable facilement)
function t(lang, key, vars = {}) {
    let value = resolveKey(LOCALES[lang] ?? LOCALES[DEFAULT_LANGUAGE], key);
    if (value === undefined) value = resolveKey(LOCALES[DEFAULT_LANGUAGE], key);
    if (value === undefined) return key;
    if (typeof value === "function") return value(vars);
    if (typeof value === "string") return interpolate(value, vars);
    return value;
}

// Traduction brute (objet / tableau), pour les sections entières
function tRaw(lang, key) {
    return resolveKey(LOCALES[lang] ?? LOCALES[DEFAULT_LANGUAGE], key)
        ?? resolveKey(LOCALES[DEFAULT_LANGUAGE], key);
}

// ─── Langue d'un serveur (table guild_settings) ──────────────────────────────
function getGuildLanguage(guildId) {
    if (!guildId || !global.db) return DEFAULT_LANGUAGE;
    const lang = global.db.prepare(`SELECT language FROM guild_settings WHERE guild_id = ?`).get(guildId)?.language;
    return isSupportedLanguage(lang) ? lang : DEFAULT_LANGUAGE;
}

function setGuildLanguage(guildId, lang) {
    global.db.prepare(`
        INSERT INTO guild_settings (guild_id, language) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET language = excluded.language
    `).run(guildId, lang);
}

// ─── Traducteur lié à une langue ─────────────────────────────────────────────
// tr("key", vars) · tr.lang = "fr" · tr.locale = "fr-FR" (dates / nombres)
function getTranslatorForLanguage(lang) {
    const code = isSupportedLanguage(lang) ? lang : DEFAULT_LANGUAGE;
    const tr = (key, vars) => t(code, key, vars);
    tr.lang = code;
    tr.locale = LOCALES[code].meta.locale;
    tr.raw = (key) => tRaw(code, key);
    return tr;
}

function getTranslator(guildId) {
    return getTranslatorForLanguage(getGuildLanguage(guildId));
}

// ─── Slash commands traduites ────────────────────────────────────────────────
// Remplace les descriptions (commande, options, choix) par celles de la langue,
// depuis la section "commands" de la locale :
//   commands.<commande>.description
//   commands.<commande>.options.<option>.description / .name (nom affiché)
//   commands.<commande>.options.<option>.choices.<valeur>
// Les noms techniques des options ne changent pas (le code les lit tels quels) :
// le nom traduit n'est qu'un name_localizations pour les clients Discord de cette langue.
function localizeCommandData(json, lang) {
    const locale = LOCALES[lang] ?? LOCALES[DEFAULT_LANGUAGE];
    const texts = locale.commands?.[json.name];
    if (!texts) return json;

    const localized = { ...json };
    if (texts.description) localized.description = texts.description;

    localized.options = (json.options ?? []).map((option) => {
        const optionTexts = texts.options?.[option.name];
        if (!optionTexts) return option;

        const result = { ...option };
        if (optionTexts.description) result.description = optionTexts.description;
        if (optionTexts.name && locale.meta.discordLocale) {
            result.name_localizations = { [locale.meta.discordLocale]: optionTexts.name };
        }
        if (option.choices && optionTexts.choices) {
            result.choices = option.choices.map((choice) => ({
                ...choice,
                name: optionTexts.choices[choice.value] ?? choice.name,
            }));
        }
        return result;
    });

    return localized;
}

module.exports = {
    DEFAULT_LANGUAGE,
    LANGUAGES,
    isSupportedLanguage,
    t,
    getGuildLanguage,
    setGuildLanguage,
    getTranslator,
    getTranslatorForLanguage,
    localizeCommandData,
};
