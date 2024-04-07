import {
    SpellRanges,
    SpellbookSlots,
    SpellbookMode,
    setSourceInfoByName,
} from 'scripts/pf1-utils.mjs';

function updateSpellBook(bookId, rollData, cache) {
    const actorData = this.system;
    const book = actorData.attributes.spells.spellbooks[bookId];
    if (!book) {
        console.error(`Spellbook data not found for "${bookId} on actor`, this);
        return;
    }

    // Set spellbook label
    book.label = book.name || game.i18n.localize(`PF1.SpellBook${bookId.capitalize()}`);

    // Do not process spellbooks that are not in use
    if (!book.inUse) return;

    // Use custom name if present
    if (book.name) book.label = book.name;
    // Get name from class if selected
    else if (book.class) {
        if (book.class === "_hd") book.label = book.name || game.i18n.localize("PF1.SpellBookSpelllike");
        else {
            const bookClassId = this.classes[book.class]?._id;
            const bookClass = this.items.get(bookClassId);
            if (bookClass) book.label = bookClass.name;
        }
    }

    rollData ??= this.getRollData({ refresh: true });
    cache ??= this._generateSpellbookCache();

    const bookInfo = cache.books[bookId];

    const spellbookAbility = actorData.abilities[book.ability];

    // Add spell slots based on ability bonus slot formula
    const spellSlotAbilityScoreBonus = RollPF.safeRoll(book.spellSlotAbilityBonusFormula || "0", rollData).total,
        spellSlotAbilityScore = (spellbookAbility?.total ?? 10) + spellSlotAbilityScoreBonus,
        spellSlotAbilityMod = pf1.utils.getAbilityModifier(spellSlotAbilityScore);

    // Set CL
    let clTotal = 0;
    {
        const key = `system.attributes.spells.spellbooks.${bookId}.cl.total`;
        const formula = book.cl.formula || "0";
        let total = 0;

        // Add NPC base
        if (this.type === "npc") {
            const value = book.cl.base || 0;
            total += value;
            clTotal += value;
            setSourceInfoByName(this.sourceInfo, key, game.i18n.localize("PF1.Base"), value);
        }
        // Add HD
        if (book.class === "_hd") {
            const value = actorData.attributes.hd.total;
            total += value;
            clTotal += value;
            setSourceInfoByName(this.sourceInfo, key, game.i18n.localize("PF1.HitDie"), value);
        }
        // Add class levels
        else if (book.class && rollData.classes[book.class]) {
            const value = rollData.classes[book.class].level;
            total += value;
            clTotal += value;

            setSourceInfoByName(this.sourceInfo, key, rollData.classes[book.class].name, value);
        }

        // Set auto spell level calculation offset
        if (book.autoSpellLevelCalculation) {
            const autoFormula = book.cl.autoSpellLevelCalculationFormula || "0";
            const autoBonus = RollPF.safeTotal(autoFormula, rollData);
            const autoTotal = Math.clamped(total + autoBonus, 1, 20);
            book.cl.autoSpellLevelTotal = autoTotal;

            clTotal += autoBonus;
            if (autoBonus !== 0) {
                setSourceInfoByName(
                    this.sourceInfo,
                    key,
                    game.i18n.localize("PF1.AutoSpellClassLevelOffset.Formula"),
                    autoBonus
                );
            }
        }

        // Add from bonus formula
        const clBonus = RollPF.safeRoll(formula, rollData).total;
        clTotal += clBonus;
        if (clBonus > 0) {
            setSourceInfoByName(this.sourceInfo, key, game.i18n.localize("PF1.CasterLevelBonusFormula"), clBonus);
        } else if (clBonus < 0) {
            setSourceInfoByName(this.sourceInfo, key, game.i18n.localize("PF1.CasterLevelBonusFormula"), clBonus, false);
        }

        if (rollData.attributes.woundThresholds.penalty != null) {
            // Subtract Wound Thresholds penalty. Can't reduce below 1.
            if (rollData.attributes.woundThresholds.penalty > 0 && clTotal > 1) {
                clTotal = Math.max(1, clTotal - rollData.attributes.woundThresholds.penalty);
                setSourceInfoByName(
                    this.sourceInfo,
                    key,
                    game.i18n.localize(pf1.config.woundThresholdConditions[rollData.attributes.woundThresholds.level]),
                    -rollData.attributes.woundThresholds.penalty
                );
            }
        }

        // Subtract energy drain
        if (rollData.attributes.energyDrain) {
            clTotal = Math.max(0, clTotal - rollData.attributes.energyDrain);
            setSourceInfoByName(
                this.sourceInfo,
                key,
                game.i18n.localize("PF1.CondTypeEnergyDrain"),
                -Math.abs(rollData.attributes.energyDrain),
                false
            );
        }

        const prevTotal = book.cl.total ?? 0;
        clTotal += prevTotal;
        book.cl.total = clTotal;
    }

    // Set concentration bonus
    {
        // Temp fix for old actors that fail migration
        if (Number.isFinite(book.concentration)) {
            console.error(`Bad spellbook concentration value "${book.concentration}" in spellbook "${bookId}"`);
            book.concentration = {};
        }
        const concFormula = book.concentrationFormula;
        const formulaRoll = concFormula.length ? RollPF.safeRoll(concFormula, rollData).total : 0;
        const classAbilityMod = actorData.abilities[book.ability]?.mod ?? 0;
        const concentration = clTotal + classAbilityMod + formulaRoll;
        const prevTotal = book.concentration.total ?? 0;

        // Set source info
        setSourceInfoByName(
            this.sourceInfo,
            `system.attributes.spells.spellbooks.${bookId}.concentration.total`,
            game.i18n.localize("PF1.CasterLevel"),
            clTotal,
            false
        );
        setSourceInfoByName(
            this.sourceInfo,
            `system.attributes.spells.spellbooks.${bookId}.concentration.total`,
            game.i18n.localize("PF1.SpellcastingAbility"),
            classAbilityMod,
            false
        );
        setSourceInfoByName(
            this.sourceInfo,
            `system.attributes.spells.spellbooks.${bookId}.concentration.total`,
            game.i18n.localize("PF1.ByBonus"),
            formulaRoll,
            false
        );

        // Apply value
        book.concentration = { total: prevTotal + concentration };
    }

    const getAbilityBonus = (a) => (a !== 0 ? pf1.documents.actor.ActorPF.getSpellSlotIncrease(spellSlotAbilityMod, a) : 0);

    const mode = new SpellbookMode(book);

    // Spell slots
    const useAuto = book.autoSpellLevelCalculation;

    // Turn off spell points with auto slots
    if (useAuto) book.spellPoints.useSystem = false;

    const useSpellPoints = book.spellPoints.useSystem === true;

    // Set base "spontaneous" based on spell prep mode when using auto slots or spell points
    if (useAuto || useSpellPoints) book.spontaneous = mode.isSemiSpontaneous;

    if (useAuto) {
        let casterType = book.casterType;
        if (!casterType || pf1.config.casterProgression.castsPerDay[mode.raw] === undefined) {
            book.casterType = casterType = "high";
        }
        if (mode.isPrestige && casterType !== "low") {
            book.casterType = casterType = "low";
        }

        const castsForLevels =
            pf1.config.casterProgression[book.spontaneous ? "castsPerDay" : "spellsPreparedPerDay"][mode.raw][casterType];
        let classLevel = Math.clamped(book.cl.autoSpellLevelTotal, 1, 20);

        // Protect against invalid class level bricking actors
        if (!Number.isSafeInteger(classLevel)) {
            const msg = `Actor ${this.id} has invalid caster class level.`;
            console.error(msg, classLevel);
            ui.notifications?.error(msg);
            classLevel = Math.floor(classLevel);
        }

        rollData.ablMod = spellSlotAbilityMod;

        const allLevelModFormula =
            book[book.spontaneous ? "castPerDayAllOffsetFormula" : "preparedAllOffsetFormula"] || "0";
        const allLevelMod = RollPF.safeTotal(allLevelModFormula, rollData);

        for (let level = 0; level < 10; level++) {
            const levelData = book.spells[`spell${level}`];
            // 0 is special because it doesn't get bonus preps and can cast them indefinitely so can't use the "cast per day" value
            const spellsForLevel =
                level === 0 && book.spontaneous
                    ? pf1.config.casterProgression.spellsPreparedPerDay[mode.raw][casterType][classLevel - 1][level]
                    : castsForLevels[classLevel - 1][level];
            levelData.base = spellsForLevel;

            const offsetFormula = levelData[book.spontaneous ? "castPerDayOffsetFormula" : "preparedOffsetFormula"] || "0";

            const max =
                typeof spellsForLevel === "number" || (level === 0 && book.hasCantrips)
                    ? spellsForLevel + getAbilityBonus(level) + allLevelMod + RollPF.safeTotal(offsetFormula, rollData)
                    : null;

            levelData.max = max;
            if (!Number.isFinite(levelData.value)) levelData.value = max;
        }
    } else {
        for (let level = book.hasCantrips ? 0 : 1; level < 10; level++) {
            const spellLevel = book.spells[`spell${level}`];
            let base = parseInt(spellLevel.base);
            if (Number.isNaN(base)) {
                spellLevel.base = null;
                spellLevel.max = 0;
            } else if (book.autoSpellLevels) {
                base += getAbilityBonus(level);
                spellLevel.max = base;
            } else {
                spellLevel.max = base;
            }

            const max = spellLevel.max;
            const oldval = spellLevel.value;
            if (!Number.isFinite(oldval)) spellLevel.value = max;
        }
    }

    // Set spontaneous spell slots to something sane
    for (let a = 0; a < 10; a++) {
        const spellLevel = book.spells[`spell${a}`];
        const current = spellLevel.value;
        spellLevel.value = current || 0;
    }

    // Update spellbook slots
    {
        const slots = {};
        for (let spellLevel = 0; spellLevel < 10; spellLevel++) {
            slots[spellLevel] = new SpellbookSlots({
                value: book.spells[`spell${spellLevel}`].max,
                domain: book.domainSlotValue ?? 0,
            });
        }

        // Slot usage
        if (!book.spontaneous) {
            for (let level = 0; level < 10; level++) {
                const levelSpells = bookInfo.level[level]?.spells ?? [];
                const lvlSlots = slots[level];
                for (const spell of levelSpells) {
                    if (Number.isFinite(spell.maxCharges)) {
                        const slotCost = spell.slotCost;
                        const subtract = { domain: 0, uses: 0 };
                        if (spell.isDomain) {
                            subtract.domain = Math.min(spell.maxCharges, lvlSlots.domain);
                            subtract.uses = (spell.maxCharges - subtract.domain) * slotCost;
                        } else {
                            subtract.uses = spell.maxCharges * slotCost;
                        }
                        lvlSlots.domain -= subtract.domain;
                        lvlSlots.value -= subtract.uses;
                    }
                }
                book.spells[`spell${level}`].value = lvlSlots.value;
            }
        }

        // Spells available hint text if auto spell levels is enabled
        const useAuto = book.autoSpellLevelCalculation;
        if (useAuto) {
            const maxLevelByAblScore = (spellbookAbility?.total ?? 0) - 10;

            const allLevelModFormula = book.preparedAllOffsetFormula || "0";
            const allLevelMod = RollPF.safeTotal(allLevelModFormula, rollData);

            const casterType = book.casterType || "high";
            const classLevel = Math.floor(Math.clamped(book.cl.autoSpellLevelTotal, 1, 20));

            for (let spellLevel = 0; spellLevel < 10; spellLevel++) {
                const spellLevelData = book.spells[`spell${spellLevel}`];
                if (maxLevelByAblScore < spellLevel) {
                    spellLevelData.lowAbilityScore = true;
                    continue;
                }

                spellLevelData.known = { unused: 0, max: 0 };
                spellLevelData.preparation = { unused: 0, max: 0 };

                let remaining;
                if (mode.isPrepared) {
                    // for prepared casters, just use the 'value' calculated above
                    remaining = spellLevelData.value;
                    spellLevelData.preparation.max = spellLevelData.max;
                } else {
                    // spontaneous or hybrid
                    // if not prepared then base off of casts per day
                    let available =
                        pf1.config.casterProgression.spellsPreparedPerDay[mode.raw][casterType]?.[classLevel - 1][spellLevel];
                    available += allLevelMod;

                    const formula = spellLevelData.preparedOffsetFormula || "0";
                    available += RollPF.safeTotal(formula, rollData);

                    // Leave record of max known
                    spellLevelData.known.max = available;

                    // Count spell slots used
                    let dSlots = slots[spellLevel].domain;
                    const used =
                        bookInfo.level[spellLevel]?.spells.reduce((acc, i) => {
                            const { preparation, atWill, domain } = i.system;
                            if (!atWill && preparation.spontaneousPrepared) {
                                const slotCost = i.slotCost;
                                if (domain && dSlots > 0) dSlots -= slotCost;
                                else acc += slotCost;
                            }
                            return acc;
                        }, 0) ?? 0;
                    slots[spellLevel].domainUnused = dSlots;
                    slots[spellLevel].used = used;

                    remaining = available - used;
                }

                if (!remaining) {
                    spellLevelData.spellMessage = "";
                    continue;
                }

                let spellRemainingMsg = "";

                if (remaining < 0) {
                    spellRemainingMsg = game.i18n.format("PF1.TooManySpells", { quantity: Math.abs(remaining) });
                    if (mode.isSpontaneous) spellLevelData.unusedKnown = remaining;
                    else spellLevelData.preparation.unused = remaining;
                } else if (remaining > 0) {
                    if (mode.isSpontaneous) {
                        spellRemainingMsg =
                            remaining === 1
                                ? game.i18n.localize("PF1.LearnMoreSpell")
                                : game.i18n.format("PF1.LearnMoreSpells", { quantity: remaining });
                        spellLevelData.known.unused = remaining;
                    } else {
                        // hybrid or prepared
                        spellRemainingMsg =
                            remaining === 1
                                ? game.i18n.localize("PF1.PrepareMoreSpell")
                                : game.i18n.format("PF1.PrepareMoreSpells", { quantity: remaining });
                        spellLevelData.preparation.unused = remaining;
                    }
                }

                spellLevelData.spellMessage = spellRemainingMsg;
            }
        }
    }

    // Spell points
    if (useSpellPoints) {
        const formula = book.spellPoints.maxFormula || "0";
        rollData.cl = book.cl.total;
        rollData.ablMod = spellSlotAbilityMod;
        const spellClass = book.class ?? "";
        rollData.classLevel =
            spellClass === "_hd"
                ? rollData.attributes.hd?.total ?? rollData.details.level.value
                : rollData.classes[spellClass]?.level || 0;

        const roll = RollPF.safeRoll(formula, rollData);
        book.spellPoints.max = roll.total;
    } else {
        book.spellPoints.max = 0;
    }

    // Set spellbook ranges
    book.range = new SpellRanges(book.cl.total);
}

Hooks.once('init', () => {
    console.log("Caster config code is underway!");
    pf1.config.casterProgression.castsPerDay.spontaneous.low = [
        [Number.POSITIVE_INFINITY],
        [Number.POSITIVE_INFINITY],
        [Number.POSITIVE_INFINITY],
        [Number.POSITIVE_INFINITY, 1],
        [Number.POSITIVE_INFINITY, 2],
        [Number.POSITIVE_INFINITY, 2],
        [Number.POSITIVE_INFINITY, 2, 1],
        [Number.POSITIVE_INFINITY, 2, 2],
        [Number.POSITIVE_INFINITY, 3, 2],
        [Number.POSITIVE_INFINITY, 3, 2, 1],
        [Number.POSITIVE_INFINITY, 3, 2, 2],
        [Number.POSITIVE_INFINITY, 3, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 3, 2, 1],
        [Number.POSITIVE_INFINITY, 4, 3, 2, 2],
        [Number.POSITIVE_INFINITY, 4, 3, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 5, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 5, 4, 3, 3],
        [Number.POSITIVE_INFINITY, 5, 4, 4, 3],
        [Number.POSITIVE_INFINITY, 5, 5, 4, 4],
    ];
    pf1.config.casterProgression.castsPerDay.hybrid.low = [
        [Number.POSITIVE_INFINITY],
        [Number.POSITIVE_INFINITY],
        [Number.POSITIVE_INFINITY],
        [Number.POSITIVE_INFINITY, 0],
        [Number.POSITIVE_INFINITY, 1],
        [Number.POSITIVE_INFINITY, 1],
        [Number.POSITIVE_INFINITY, 1, 0],
        [Number.POSITIVE_INFINITY, 1, 1],
        [Number.POSITIVE_INFINITY, 2, 1],
        [Number.POSITIVE_INFINITY, 2, 1, 0],
        [Number.POSITIVE_INFINITY, 2, 1, 1],
        [Number.POSITIVE_INFINITY, 2, 2, 1],
        [Number.POSITIVE_INFINITY, 3, 2, 1, 0],
        [Number.POSITIVE_INFINITY, 3, 2, 1, 1],
        [Number.POSITIVE_INFINITY, 3, 2, 2, 1],
        [Number.POSITIVE_INFINITY, 3, 3, 2, 1],
        [Number.POSITIVE_INFINITY, 4, 3, 2, 1],
        [Number.POSITIVE_INFINITY, 4, 3, 2, 2],
        [Number.POSITIVE_INFINITY, 4, 3, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 3, 3],
    ];
    pf1.config.casterProgression.castsPerDay.hybrid.med = [
        [Number.POSITIVE_INFINITY, 1],
        [Number.POSITIVE_INFINITY, 2],
        [Number.POSITIVE_INFINITY, 2],
        [Number.POSITIVE_INFINITY, 3, 1],
        [Number.POSITIVE_INFINITY, 3, 2],
        [Number.POSITIVE_INFINITY, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 3, 1],
        [Number.POSITIVE_INFINITY, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 3, 1],
        [Number.POSITIVE_INFINITY, 4, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 3, 1],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 4, 3, 1],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 4, 3, 2],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 4, 3, 3],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 4, 4, 3],
        [Number.POSITIVE_INFINITY, 4, 4, 4, 4, 4, 4],
    ];
    pf1.config.casterProgression.spellsPreparedPerDay.hybrid.low = [
        [null],
        [null],
        [null],
        [null, 2],
        [null, 3],
        [null, 4],
        [null, 4, 2],
        [null, 4, 3],
        [null, 5, 4],
        [null, 5, 4, 2],
        [null, 5, 4, 3],
        [null, 6, 5, 4],
        [null, 6, 5, 4, 2],
        [null, 6, 5, 4, 3],
        [null, 6, 6, 5, 4],
        [null, 6, 6, 5, 4],
        [null, 6, 6, 5, 4],
        [null, 6, 6, 6, 5],
        [null, 6, 6, 6, 5],
        [null, 6, 6, 6, 5],
    ];
    pf1.config.casterProgression.spellsPreparedPerDay.hybrid.med = [
        [4, 2],
        [5, 3],
        [6, 4],
        [6, 4, 2],
        [6, 4, 3],
        [6, 4, 4],
        [6, 5, 4, 2],
        [6, 5, 4, 3],
        [6, 5, 4, 4],
        [6, 5, 5, 4, 2],
        [6, 6, 5, 4, 3],
        [6, 6, 5, 4, 4],
        [6, 6, 5, 5, 4, 2],
        [6, 6, 6, 5, 4, 3],
        [6, 6, 6, 5, 4, 4],
        [6, 6, 6, 5, 5, 4, 2],
        [6, 6, 6, 6, 5, 4, 3],
        [6, 6, 6, 6, 5, 4, 4],
        [6, 6, 6, 6, 5, 5, 4],
        [6, 6, 6, 6, 6, 5, 5],
    ];
    libWrapper.register('trailblazer', 'pf1.documents.actor.ActorPF.prototype._updateSpellBook', updateSpellBook, libWrapper.OVERRIDE);
});
