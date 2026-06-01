function getRankEmoji(rank) {
    if (!rank || rank === "Non classé" || rank === "UNRANKED") return "⚫";

    const rankLower = rank.toLowerCase();

    if (rankLower.includes('iron'))        return "🔩";
    if (rankLower.includes('bronze'))      return "🟫";
    if (rankLower.includes('silver'))      return "⚪";
    if (rankLower.includes('gold'))        return "🟨";
    if (rankLower.includes('platinum'))    return "🔷";
    if (rankLower.includes('emerald'))     return "💚";
    if (rankLower.includes('diamond'))     return "💎";
    if (rankLower.includes('grandmaster')) return "⭐";
    if (rankLower.includes('master'))      return "🔮";
    if (rankLower.includes('challenger'))  return "👑";

    return "🏅";
}

function getRankOrder(rank, lp = 0) {
    if (!rank || rank === "Non classé" || rank === "UNRANKED") {
        return { order: 0, divisionOrder: 0, lp: lp, totalScore: 0 };
    }

    const rankLower = rank.toLowerCase();
    let tierOrder = 0;
    let divisionOrder = 0;

    if      (rankLower.includes('iron'))        tierOrder = 1;
    else if (rankLower.includes('bronze'))      tierOrder = 2;
    else if (rankLower.includes('silver'))      tierOrder = 3;
    else if (rankLower.includes('gold'))        tierOrder = 4;
    else if (rankLower.includes('platinum'))    tierOrder = 5;
    else if (rankLower.includes('emerald'))     tierOrder = 6;
    else if (rankLower.includes('diamond'))     tierOrder = 7;
    // grandmaster AVANT master
    else if (rankLower.includes('grandmaster')) tierOrder = 9;
    else if (rankLower.includes('master'))      tierOrder = 8;
    else if (rankLower.includes('challenger'))  tierOrder = 10;

    if      (rankLower.includes(' iv'))  divisionOrder = 1;
    else if (rankLower.includes(' iii')) divisionOrder = 2;
    else if (rankLower.includes(' ii'))  divisionOrder = 3;
    else if (rankLower.includes(' i'))   divisionOrder = 4;
    else divisionOrder = 5; // Master+

    const totalScore = (tierOrder * 400) + (divisionOrder * 100) + lp;

    return {
        order:         tierOrder,
        divisionOrder: divisionOrder,
        lp:            lp,
        totalScore:    totalScore,
    };
}

module.exports = {
    getRankEmoji,
    getRankOrder,
};
