
/**
 * Resolve range formula to numeric value.
 *
 * @param {string} [formula] Range formula. Only used with "mi", "ft", "m", "km" and similar types.
 * @param {"melee"|"touch"|"reach"|"close"|"medium"|"long"|"mi"} [type="ft"] Formula type
 * @param {object} [rollData] Roll data for evaluating the formula
 * @returns {number} Range in feet for the defined formula
 */
const calculateRangeFormula = (formula, type = "ft", rollData = {}) => {
    switch (type) {
        case "melee":
        case "touch":
            return rollData.range?.melee ?? 0;
        case "reach":
            return rollData.range?.reach ?? 0;
        case "close":
            return RollPF.safeRoll(pf1.config.spellRangeFormulas.close, rollData).total;
        case "medium":
            return RollPF.safeRoll(pf1.config.spellRangeFormulas.medium, rollData).total;
        case "long":
            return RollPF.safeRoll(pf1.config.spellRangeFormulas.long, rollData).total;
        case "mi":
            return RollPF.safeRoll(formula, rollData).total * 5_280;
        case "m":
            return (RollPF.safeRoll(formula, rollData).total / 1.5) * 5;
        case "km":
            return ((RollPF.safeRoll(formula, rollData).total * 1000) / 1.5) * 5;
        default:
            return RollPF.safeRoll(formula, rollData).total;
    }
};

/**
 * Calculates range formula and converts it.
 *
 * @param formula
 * @param type
 * @param rollData
 */
function calculateRange(formula, type = "ft", rollData = {}) {
    if (type == null) return null;
    const value = calculateRangeFormula(formula, type, rollData);
    return pf1.utils.convertDistance(value)[0];
}

export class SpellRanges {
    close;
    medium;
    long;

    cl;

    constructor(cl) {
        this.cl = cl;
        this.close = calculateRange(null, "close", { cl });
        this.medium = calculateRange(null, "medium", { cl });
        this.long = calculateRange(null, "long", { cl });
    }
}

export class SpellbookSlots {
    max;
    value;
    domain;
    domainMax;
    domainUnused = 0;
    used = 0;

    constructor({ value = 0, max = 0, domain = 0 } = {}) {
        this.value = value ?? 0;
        this.max = max ?? 0;

        this.domain = domain ?? 0;
        this.domainMax = this.domain;
        this.domainUnused = this.domainMax;
    }
}

export class SpellbookMode {
    raw;

    get isHybrid() {
        return this.raw === "hybrid";
    }

    get isPrestige() {
        return this.raw === "prestige";
    }

    get isSpontaneous() {
        return this.raw === "spontaneous";
    }

    get isPrepared() {
        return this.raw === "prepared";
    }

    get usesSpellpoints() {
        return this.book.spellPoints?.useSystem === true;
    }

    get isSemiSpontaneous() {
        return this.isSpontaneous || this.isHybrid || this.isPrestige || this.usesSpellpoints;
    }

    constructor(book) {
        this.book = book;

        let mode = book.spellPreparationMode;

        // Shunt invalid mode
        if (!mode) mode = book.spellPreparationMode = "spontaneous";

        this.raw = mode;
    }
}

const getSourceInfo = function (obj, key) {
    if (!obj[key]) {
        obj[key] = { negative: [], positive: [] };
    }
    return obj[key];
};

export const setSourceInfoByName = function (obj, key, name, value, positive = true) {
    const target = positive ? "positive" : "negative";
    const sourceInfo = getSourceInfo(obj, key)[target];
    const data = sourceInfo.find((o) => o.name === name);
    if (data) data.value = value;
    else {
        sourceInfo.push({
            name: name,
            value: value,
        });
    }
};