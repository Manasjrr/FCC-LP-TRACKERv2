

function getRankEmoji(rank) {
    if (!rank || rank === "Non classé" || rank === "UNRANKED") return "⚫";

    const rankLower = rank.toLowerCase();

    if (rankLower.includes('iron')) return "🔩";      // Fer
    if (rankLower.includes('bronze')) return "🟫";    // Bronze
    if (rankLower.includes('silver')) return "⚪";    // Argent
    if (rankLower.includes('gold')) return "🟨";      // Or
    if (rankLower.includes('platinum')) return "🔷";  // Platine
    if (rankLower.includes('emerald')) return "💚";   // Émeraude
    if (rankLower.includes('diamond')) return "💎";   // Diamant
    if (rankLower.includes('master')) return "🔮";    // Maître
    if (rankLower.includes('grandmaster')) return "⭐"; // Grand Maître
    if (rankLower.includes('challenger')) return "👑"; // Challenger

    return "🏅"; // Défaut
}

function getRankOrder(rank, lp = 0) {
    if (!rank || rank === "Non classé" || rank === "UNRANKED") {
        return { order: 0, divisionOrder: 0, lp: lp, totalScore: 0 };
    }

    const rankLower = rank.toLowerCase();
    let tierOrder = 0;
    let divisionOrder = 0;

    // 🏆 Ordre des tiers
    if (rankLower.includes('iron')) tierOrder = 1;
    else if (rankLower.includes('bronze')) tierOrder = 2;
    else if (rankLower.includes('silver')) tierOrder = 3;
    else if (rankLower.includes('gold')) tierOrder = 4;
    else if (rankLower.includes('platinum')) tierOrder = 5;
    else if (rankLower.includes('emerald')) tierOrder = 6;
    else if (rankLower.includes('diamond')) tierOrder = 7;
    else if (rankLower.includes('master')) tierOrder = 8;
    else if (rankLower.includes('grandmaster')) tierOrder = 9;
    else if (rankLower.includes('challenger')) tierOrder = 10;

    // 🎯 Ordre des divisions
    if (rankLower.includes(' iv')) divisionOrder = 1;
    else if (rankLower.includes(' iii')) divisionOrder = 2;
    else if (rankLower.includes(' ii')) divisionOrder = 3;
    else if (rankLower.includes(' i')) divisionOrder = 4;
    else divisionOrder = 5; // Master+

    // 📊 CALCUL DU SCORE TOTAL pour coeemparaison facile
    const totalScore = (tierOrder * 400) + (divisionOrder * 100) + lp;

    return { 
        order: tierOrder, 
        divisionOrder: divisionOrder, 
        lp: lp,
        totalScore: totalScore  // ← Pour comparaisons faciles
    };
}


// 📤 Exportez-les
module.exports = {
    getRankEmoji,
    getRankOrder,
    // ... autres fonctions
};