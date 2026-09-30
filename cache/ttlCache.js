// ─── Cache mémoire borné (expiration + taille max) ───────────────────────────
// • expiration vérifiée à la lecture + nettoyage périodique (un seul timer pour
//   tout le cache, au lieu d'un setTimeout de 48h par entrée)
// • taille max : l'entrée la moins récemment utilisée est retirée (LRU) → la
//   mémoire ne grossit plus avec le nombre de games. Une entrée retirée est
//   simplement re-téléchargée si on en a de nouveau besoin.
const SWEEP_INTERVAL = 10 * 60 * 1000;

function createTtlCache({ ttl, maxSize, onExpire = () => {} }) {
    const entries = new Map(); // clé → { value, expiresAt } (ordre = du moins au plus récent)

    function isExpired(entry) {
        return entry.expiresAt <= Date.now();
    }

    function get(key) {
        const entry = entries.get(key);
        if (!entry) return null;
        if (isExpired(entry)) {
            entries.delete(key);
            onExpire(key);
            return null;
        }
        // Remise en fin de Map = entrée la plus récemment utilisée
        entries.delete(key);
        entries.set(key, entry);
        return entry.value;
    }

    function set(key, value) {
        entries.delete(key);
        entries.set(key, { value, expiresAt: Date.now() + ttl });
        while (entries.size > maxSize) {
            entries.delete(entries.keys().next().value);
        }
    }

    function sweep() {
        for (const [key, entry] of entries) {
            if (isExpired(entry)) {
                entries.delete(key);
                onExpire(key);
            }
        }
    }

    setInterval(sweep, SWEEP_INTERVAL).unref();

    return {
        get,
        set,
        has: (key) => get(key) !== null,
        delete: (key) => entries.delete(key),
        get size() {
            return entries.size;
        },
    };
}

module.exports = { createTtlCache };
