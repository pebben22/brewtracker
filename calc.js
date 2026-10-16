/* Brew Tracker - calculation engine (no DOM access, so it can be unit-tested in Node).
   Units: kg, litres, degC, ppm (mg/L), SG. */
(function (root) {
  'use strict';

  const PTS_PER_KG_L = 385.3;      // SG points for 1 kg of 100 % extract in 1 L of wort
  const BUFFER = 40;               // malt buffering, mEq per kg per pH unit (estimate)
  const LACTIC_MEQ_ML = 11.8;      // 88 % lactic acid
  const PHOS_MEQ_ML = 14.6;        // 85 % phosphoric acid
  const SODA_MEQ_G = 11.9;         // sodium bicarbonate
  const ION_KEYS = ['ca', 'mg', 'na', 'cl', 'so4', 'hco3'];
  const ION_LABEL = { ca: 'Calcium (Ca)', mg: 'Magnesium (Mg)', na: 'Sodium (Na)', cl: 'Chloride (Cl)', so4: 'Sulfate (SO4)', hco3: 'Bicarbonate (HCO3)' };

  // ppm added to 1 L of water by 1 g of the salt
  const ADDITIVES = [
    { key: 'gypsum', name: 'Gypsum', formula: 'CaSO4.2H2O', ions: { ca: 232.8, so4: 557.7 } },
    { key: 'cacl2', name: 'Calcium chloride', formula: 'CaCl2.2H2O', ions: { ca: 272.6, cl: 482.3 } },
    { key: 'epsom', name: 'Epsom salt', formula: 'MgSO4.7H2O', ions: { mg: 98.6, so4: 389.6 } },
    { key: 'nacl', name: 'Table salt', formula: 'NaCl', ions: { na: 393.4, cl: 606.6 } },
    { key: 'bakingsoda', name: 'Baking soda', formula: 'NaHCO3', ions: { na: 273.7, hco3: 726.4 } },
    // Chalk dissolves poorly, so only about half is counted. Add it to the mash, not to the sparge.
    { key: 'chalk', name: 'Chalk', formula: 'CaCO3 (~50 % effective)', ions: { ca: 200, hco3: 610 } },
  ];

  const SOURCE_WATERS = [
    { id: 'ro', name: 'Distilled / RO water', ions: { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 } },
    { id: 'soft', name: 'Soft tap water (example)', ions: { ca: 12, mg: 2, na: 5, cl: 6, so4: 8, hco3: 30 } },
    { id: 'medium', name: 'Medium tap water (example)', ions: { ca: 45, mg: 8, na: 12, cl: 20, so4: 25, hco3: 130 } },
    { id: 'hard', name: 'Hard tap water (example)', ions: { ca: 95, mg: 15, na: 20, cl: 30, so4: 45, hco3: 290 } },
    { id: 'custom', name: 'Custom (from my water report)', ions: null },
  ];

  const WATER_TARGETS = [
    { id: 'balanced', name: 'Balanced all-rounder', ions: { ca: 100, mg: 8, na: 10, cl: 90, so4: 90, hco3: 40 } },
    { id: 'hoppy', name: 'Hoppy and dry (pale ale, IPA, bitter)', ions: { ca: 150, mg: 10, na: 10, cl: 50, so4: 300, hco3: 30 } },
    { id: 'hazy', name: 'Juicy / hazy (NEIPA)', ions: { ca: 130, mg: 10, na: 10, cl: 200, so4: 75, hco3: 30 } },
    { id: 'malty', name: 'Malty and full (amber, bock, brown)', ions: { ca: 100, mg: 10, na: 10, cl: 150, so4: 50, hco3: 80 } },
    { id: 'pilsner', name: 'Soft pale lager (pilsner, helles)', ions: { ca: 50, mg: 5, na: 5, cl: 50, so4: 40, hco3: 15 } },
    { id: 'burton', name: 'Burton-on-Trent (historic bitter)', ions: { ca: 295, mg: 45, na: 55, cl: 25, so4: 725, hco3: 300 } },
    { id: 'dublin', name: 'Dublin (dry stout)', ions: { ca: 115, mg: 4, na: 12, cl: 19, so4: 54, hco3: 319 } },
    { id: 'london', name: 'London (porter, brown ale)', ions: { ca: 52, mg: 32, na: 86, cl: 34, so4: 32, hco3: 104 } },
    { id: 'munich', name: 'Munich (dunkel, malty lager)', ions: { ca: 76, mg: 18, na: 3, cl: 2, so4: 10, hco3: 152 } },
    { id: 'custom', name: 'Custom', ions: null },
  ];

  // type: base | crystal | roast | acid | adjunct | sugar
  const GRAIN_LIBRARY = [
    { name: 'Pilsner malt', type: 'base', extract: 80, ebc: 3.5, dipH: 5.80 },
    { name: 'Pale ale malt', type: 'base', extract: 80, ebc: 6, dipH: 5.70 },
    { name: 'Maris Otter', type: 'base', extract: 80, ebc: 6, dipH: 5.70 },
    { name: 'Vienna malt', type: 'base', extract: 79, ebc: 8, dipH: 5.62 },
    { name: 'Munich malt I', type: 'base', extract: 78, ebc: 15, dipH: 5.55 },
    { name: 'Munich malt II', type: 'base', extract: 77, ebc: 25, dipH: 5.50 },
    { name: 'Wheat malt', type: 'base', extract: 81, ebc: 4.5, dipH: 5.90 },
    { name: 'Rye malt', type: 'base', extract: 78, ebc: 7, dipH: 5.85 },
    { name: 'Crystal 40 EBC', type: 'crystal', extract: 74, ebc: 40, dipH: 5.05 },
    { name: 'Crystal 80 EBC', type: 'crystal', extract: 74, ebc: 80, dipH: 4.85 },
    { name: 'Crystal 150 EBC', type: 'crystal', extract: 72, ebc: 150, dipH: 4.65 },
    { name: 'Chocolate malt', type: 'roast', extract: 70, ebc: 900, dipH: 4.70 },
    { name: 'Roasted barley', type: 'roast', extract: 65, ebc: 1000, dipH: 4.55 },
    { name: 'Carafa Special II', type: 'roast', extract: 70, ebc: 830, dipH: 4.85 },
    { name: 'Acidulated malt', type: 'acid', extract: 60, ebc: 5, dipH: 3.4 },
    { name: 'Flaked oats (raw)', type: 'adjunct', extract: 70, ebc: 2, dipH: 6.00 },
    { name: 'Flaked wheat (raw)', type: 'adjunct', extract: 77, ebc: 4, dipH: 6.00 },
    { name: 'Flaked maize (raw)', type: 'adjunct', extract: 80, ebc: 2, dipH: 6.00 },
    { name: 'Dextrose', type: 'sugar', extract: 100, ebc: 0, dipH: 0 },
    { name: 'Table sugar', type: 'sugar', extract: 100, ebc: 0, dipH: 0 },
  ];

  const MASH_PRESETS = [
    { id: 'single66', name: 'Single infusion 66 C (balanced)', steps: [
      { name: 'Saccharification', temp: 66, min: 60 }, { name: 'Mash-out', temp: 76, min: 10 }] },
    { id: 'single64', name: 'Single infusion 64 C (dry, fermentable)', steps: [
      { name: 'Saccharification', temp: 64, min: 70 }, { name: 'Mash-out', temp: 76, min: 10 }] },
    { id: 'single68', name: 'Single infusion 68 C (full, dextrinous)', steps: [
      { name: 'Saccharification', temp: 68, min: 50 }, { name: 'Mash-out', temp: 76, min: 10 }] },
    { id: 'twostep', name: 'Two-step: beta then alpha', steps: [
      { name: 'Beta-amylase rest (maltose)', temp: 63, min: 40 }, { name: 'Alpha-amylase rest (dextrins)', temp: 72, min: 25 }, { name: 'Mash-out', temp: 76, min: 10 }] },
    { id: 'lager', name: 'Lager step mash (with protein rest)', steps: [
      { name: 'Protein rest', temp: 52, min: 15 }, { name: 'Beta-amylase rest', temp: 63, min: 35 }, { name: 'Alpha-amylase rest', temp: 72, min: 20 }, { name: 'Mash-out', temp: 78, min: 10 }] },
    { id: 'wheat', name: 'Wheat beer (ferulic acid rest)', steps: [
      { name: 'Ferulic acid rest', temp: 44, min: 15 }, { name: 'Beta-amylase rest', temp: 63, min: 35 }, { name: 'Alpha-amylase rest', temp: 72, min: 20 }, { name: 'Mash-out', temp: 76, min: 10 }] },
    { id: 'custom', name: 'Custom (edit steps)', steps: null },
  ];

  // What is going on at a given mash temperature
  const MASH_RANGES = [
    { lo: 0, hi: 46, text: 'Beta-glucanase and ferulic acid esterase active. Thins gummy beta-glucans (useful with oats, rye, wheat) and releases ferulic acid, the precursor of clove flavour in wheat beers.' },
    { lo: 46, hi: 58, text: 'Proteases active. Breaks down proteins and peptides (clarity, yeast nutrition). Modern, well-modified malts need little or none; too long thins head retention.' },
    { lo: 58, hi: 62, text: 'Starch from oats, wheat and barley gelatinises; beta-amylase starts working strongly. Very fermentable wort.' },
    { lo: 62, hi: 65, text: 'Beta-amylase optimum. Mostly maltose, so highly fermentable: a dry, crisp beer with lower final gravity.' },
    { lo: 65, hi: 68, text: 'Both amylases are active. Balanced fermentability and body; the usual single-infusion range.' },
    { lo: 68, hi: 73, text: 'Alpha-amylase optimum; beta-amylase denatures quickly. Long chain dextrins remain: fuller body and higher final gravity.' },
    { lo: 73, hi: 100, text: 'Mash-out. Enzymes are denatured, so the sugar profile is locked in, and wort viscosity drops for an easier run-off.' },
  ];

  const ENZYME_TABLE = [
    { target: 'Beta-glucans', agent: 'Beta-glucanase', temp: '35 - 45', ph: '4.5 - 5.0', effect: 'Lower viscosity, avoids stuck mash with oats, rye, wheat' },
    { target: 'Ferulic acid', agent: 'Ferulic acid esterase', temp: '40 - 45', ph: '5.2 - 5.6', effect: 'Clove precursor (4-vinyl guaiacol) in wheat beer' },
    { target: 'Proteins', agent: 'Proteases / peptidases', temp: '45 - 55', ph: '4.6 - 5.3', effect: 'Clarity, yeast nutrition; rarely needed with modern malt' },
    { target: 'Starch gelatinisation', agent: '(heat)', temp: 'Oats 53-59, wheat 58-64, barley 52-63, rye 57-70, maize 62-74, rice 68-78', ph: '-', effect: 'Raw adjuncts must pass their gelatinisation temperature before enzymes can convert them' },
    { target: 'Starch to maltose', agent: 'Beta-amylase', temp: '60 - 65 (opt. 62-65)', ph: '5.4 - 5.6', effect: 'Fermentable sugar, drier beer' },
    { target: 'Starch to dextrins', agent: 'Alpha-amylase', temp: '68 - 72 (opt. 70-72)', ph: '5.6 - 5.8', effect: 'Unfermentable dextrins, body and sweetness' },
    { target: 'Mash-out', agent: 'Enzymes denature', temp: '76 - 78', ph: '5.2 - 5.6', effect: 'Stops conversion, thins wort for run-off' },
  ];

  // ---------- gravity helpers ----------
  const platoToSG = p => 1 + p / (258.6 - 0.879525 * p);
  const sgToPlato = sg => -616.868 + 1111.14 * sg - 630.272 * sg * sg + 135.997 * sg * sg * sg;
  const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);

  // ---------- recipe stats ----------
  function recipeStats(r) {
    const grains = r.grains || [];
    const batch = Math.max(n(r.batchL), 0.1);
    const mashKg = grains.filter(g => g.type !== 'sugar').reduce((s, g) => s + n(g.kg), 0);
    const totalKg = grains.reduce((s, g) => s + n(g.kg), 0);
    const eff = n(r.efficiency) / 100;

    let pts = 0, mashExtractKg = 0;
    grains.forEach(g => {
      const ex = n(g.kg) * n(g.extract) / 100;
      if (g.type === 'sugar') pts += ex * PTS_PER_KG_L / batch;
      else { pts += ex * PTS_PER_KG_L * eff / batch; mashExtractKg += ex; }
    });
    const og = 1 + pts / 1000;
    const att = n(r.yeast && r.yeast.attenuation) / 100;
    const fg = 1 + (og - 1) * (1 - att);
    const abv = (og - fg) * 131.25;

    // Tinseth IBU
    const bigness = 1.65 * Math.pow(0.000125, og - 1);
    let ibu = 0;
    (r.hops || []).forEach(h => {
      if (h.use === 'dry') return;
      const t = h.use === 'whirlpool' ? n(h.min) * 0.5 : n(h.min);
      const util = bigness * (1 - Math.exp(-0.04 * t)) / 4.15;
      ibu += n(h.g) * n(h.alpha) / 100 * 1000 * util / batch;
    });

    // Colour (Morey), result in EBC
    let mcu = 0;
    grains.forEach(g => {
      if (!n(g.kg)) return;
      const srm = n(g.ebc) / 1.97;
      const lov = n(g.ebc) > 0 ? (srm + 0.76) / 1.3546 : 0;
      mcu += n(g.kg) * 2.2046 * lov / (batch * 0.26417);
    });
    const ebc = mcu > 0 ? 1.4922 * Math.pow(mcu, 0.6859) * 1.97 : 0;

    // Water volumes
    const boilOff = n(r.boilOffLph) * n(r.boilMin) / 60;
    const preboilL = batch + n(r.trubLossL) + boilOff;
    const absorbed = n(r.absorption) * mashKg;
    const totalWater = preboilL + absorbed;
    const mashWater = mashKg * n(r.mashRatio);
    const spargeWater = Math.max(0, totalWater - mashWater);
    const preboilSG = 1 + (pts * batch / preboilL) / 1000;

    // Expected gravity of the wort in the tun when conversion is complete (95 % of grist extract dissolved)
    const dissolved = mashExtractKg * 0.95;
    const mashPlato = mashWater > 0 ? 100 * dissolved / (dissolved + mashWater) : 0;
    const mashSG = platoToSG(mashPlato);

    return { mashKg, totalKg, og, fg, abv, ibu, ebc, preboilL, absorbed, totalWater, mashWater, spargeWater, preboilSG, mashSG, mashPlato, pts };
  }

  // ---------- water ----------
  function nnls(A, b, iters) {
    const m = A.length, k = A[0].length;
    const x = new Array(k).fill(0);
    const r = b.slice();
    const sq = [];
    for (let j = 0; j < k; j++) { let s = 0; for (let i = 0; i < m; i++) s += A[i][j] * A[i][j]; sq[j] = s || 1; }
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < k; j++) {
        let dot = 0;
        for (let i = 0; i < m; i++) dot += A[i][j] * r[i];
        const nx = Math.max(0, x[j] + dot / sq[j]);
        const d = nx - x[j];
        if (d) { for (let i = 0; i < m; i++) r[i] -= A[i][j] * d; x[j] = nx; }
      }
    }
    return x;
  }

  const ION_WEIGHT = { ca: 2, mg: 0.5, na: 0.3, cl: 1.5, so4: 1.5, hco3: 0.5 };

  function solveSalts(src, target, d) {
    const s = ION_KEYS.map(k => ION_WEIGHT[k] / Math.max(n(target[k]), 25));
    const diluted = {};
    ION_KEYS.forEach(k => { diluted[k] = n(src[k]) * (1 - d); });
    const A = ION_KEYS.map((k, i) => ADDITIVES.map(a => s[i] * (a.ions[k] || 0)));
    const b = ION_KEYS.map((k, i) => s[i] * (n(target[k]) - diluted[k]));
    const x = nnls(A, b, 400);
    const final = {};
    let err = 0;
    ION_KEYS.forEach((k, i) => {
      final[k] = diluted[k] + ADDITIVES.reduce((sum, a, j) => sum + x[j] * (a.ions[k] || 0), 0);
      err += Math.pow(s[i] * (final[k] - n(target[k])), 2);
    });
    return { x, diluted, final, err };
  }

  function suggestDilution(src, target) {
    const rows = [];
    for (let p = 0; p <= 90; p += 5) rows.push({ p, err: solveSalts(src, target, p / 100).err });
    const min = Math.min(...rows.map(r => r.err));
    return rows.find(r => r.err <= min * 1.25 + 0.01).p;
  }

  const alkalinity = ions => n(ions.hco3) * 0.8202;                      // ppm as CaCO3
  const residualAlk = ions => alkalinity(ions) - n(ions.ca) / 1.4 - n(ions.mg) / 1.7;   // Kolbach/Palmer, ions in ppm

  function gristDiPh(grains) {
    let w = 0, s = 0, acidKg = 0;
    grains.forEach(g => {
      if (g.type === 'sugar') return;
      if (g.type === 'acid') { acidKg += n(g.kg); }
      else { s += n(g.kg) * n(g.dipH); w += n(g.kg); }
    });
    const base = w > 0 ? s / w : 5.7;
    const acidPct = (w + acidKg) > 0 ? acidKg / (w + acidKg) * 100 : 0;
    return base - 0.1 * acidPct;     // roughly 0.1 pH per 1 % acidulated malt
  }

  function predictMashPh(r, mashIons, stats) {
    const ratio = n(r.mashRatio);
    const shift = (residualAlk(mashIons) / 50 * ratio) / BUFFER;
    return gristDiPh(r.grains || []) + shift + n(r.water && r.water.phOffset);
  }

  function phAdvice(ph, targetPh, mashKg) {
    const out = { kind: null };
    if (ph > targetPh + 0.05) {
      const meq = (ph - targetPh) * BUFFER * mashKg;
      out.kind = 'acid'; out.lacticMl = meq / LACTIC_MEQ_ML; out.phosMl = meq / PHOS_MEQ_ML;
    } else if (ph < targetPh - 0.15) {
      const meq = (targetPh - ph) * BUFFER * mashKg;
      out.kind = 'base'; out.sodaG = meq / SODA_MEQ_G;
    }
    return out;
  }

  function character(ions) {
    const ratio = n(ions.so4) / Math.max(n(ions.cl), 1);
    let label;
    if (ratio >= 2.5) label = 'Very dry and bitter, hop-forward';
    else if (ratio >= 1.5) label = 'Crisp and hop-forward';
    else if (ratio >= 0.9) label = 'Balanced';
    else if (ratio >= 0.5) label = 'Rounded, malt-leaning';
    else label = 'Soft, full and malty';
    return { ratio, label };
  }

  function applySalts(src, d, x) {
    const diluted = {}, final = {};
    ION_KEYS.forEach(k => {
      diluted[k] = n(src[k]) * (1 - d);
      final[k] = diluted[k] + ADDITIVES.reduce((s, a, j) => s + x[j] * (a.ions[k] || 0), 0);
    });
    return { diluted, final };
  }

  // Volume an additive is dosed into: chalk and "mash only" mode go in the mash, everything else in all the water.
  const dosedVolume = (a, w, stats) => (w.treat === 'mash' || a.key === 'chalk' ? stats.mashWater : stats.totalWater);

  // opts.auto = ignore the user's manual amounts (w.manual: total grams per additive key)
  function waterReport(r, opts) {
    const w = r.water;
    const stats = recipeStats(r);
    const roPct = Math.min(95, Math.max(0, n(w.roPct)));
    const auto = solveSalts(w.source, w.target, roPct / 100);
    const suggestedPct = suggestDilution(w.source, w.target);
    const dosedL = w.treat === 'mash' ? stats.mashWater : stats.totalWater;
    const isManual = !!(w.manual && !(opts && opts.auto));

    // g per litre actually used
    const x = ADDITIVES.map((a, j) => {
      if (!isManual) return auto.x[j];
      const vol = dosedVolume(a, w, stats);
      return vol > 0 ? Math.max(0, n(w.manual[a.key])) / vol : 0;
    });
    const sol = isManual ? applySalts(w.source, roPct / 100, x) : auto;

    const additives = ADDITIVES.map((a, j) => {
      const gPerL = x[j];
      const mashOnly = w.treat === 'mash' || a.key === 'chalk';
      const mashG = gPerL * stats.mashWater, spargeG = mashOnly ? 0 : gPerL * stats.spargeWater;
      const autoG = auto.x[j] * dosedVolume(a, w, stats);
      return { ...a, gPerL, mashG, spargeG, totalG: mashG + spargeG, autoG };
    });

    // The treated water is what goes into the mash. In "mash only" mode the dosing rate is the same.
    const mashIons = sol.final;
    const spargeIons = {};
    ION_KEYS.forEach(k => {
      spargeIons[k] = sol.diluted[k] + (w.treat === 'mash' ? 0 : ADDITIVES.reduce((s, a, j) => s + (a.key === 'chalk' ? 0 : x[j] * (a.ions[k] || 0)), 0));
    });
    const ph = predictMashPh(r, mashIons, stats);
    const targetPh = n(w.targetPh) || 5.4;
    const advice = phAdvice(ph, targetPh, stats.mashKg);

    const spargeAlk = alkalinity(spargeIons);
    const spargeMeq = Math.max(0, (spargeAlk - 20) / 50 * stats.spargeWater);
    const sparge = { alk: spargeAlk, lacticMl: spargeMeq / LACTIC_MEQ_ML, needed: spargeAlk > 25 && stats.spargeWater > 0 };

    const warnings = [];
    const f = mashIons;
    if (f.ca < 50) warnings.push('Calcium below 50 ppm. Aim for 50-150 ppm for enzyme activity, yeast health and clarity.');
    if (f.ca > 250) warnings.push('Calcium above 250 ppm is high and can taste mineral.');
    if (f.mg > 30) warnings.push('Magnesium above 30 ppm can taste sour or bitter.');
    if (f.na > 150) warnings.push('Sodium above 150 ppm tastes salty. Above ~100 ppm combined with high sulfate tastes harsh.');
    if (f.so4 > 400) warnings.push('Sulfate above 400 ppm gives a harsh, lingering bitterness.');
    if (f.cl > 250) warnings.push('Chloride above 250 ppm can taste medicinal or salty.');
    if (f.so4 + f.cl > 500) warnings.push('Combined sulfate and chloride is very high; the beer may taste minerally.');
    ION_KEYS.forEach(k => {
      if (Math.abs(f[k] - n(w.target[k])) > Math.max(15, n(w.target[k]) * 0.25) && k !== 'hco3')
        warnings.push(`${ION_LABEL[k]} lands at ${Math.round(f[k])} ppm versus a target of ${Math.round(n(w.target[k]))} ppm.`);
    });
    if (f.hco3 > n(w.target.hco3) + 40) warnings.push('Source alkalinity is higher than the target and salts cannot remove it. Dilute with RO/distilled water (see suggestion) or use acid.');

    return { stats, roPct, isManual, suggestedPct, diluted: sol.diluted, final: sol.final, additives, dosedL, mashIons, spargeIons, ph, targetPh, advice, sparge, warnings, character: character(sol.final), ra: residualAlk(mashIons), alk: alkalinity(mashIons) };
  }

  function strikeTemp(ratio, restTemp, grainTemp) {
    return (0.41 / Math.max(ratio, 0.5)) * (restTemp - grainTemp) + restTemp;
  }

  function describeTemp(t) {
    const m = MASH_RANGES.find(x => t >= x.lo && t < x.hi);
    return m ? m.text : '';
  }

  const api = { ION_KEYS, ION_LABEL, ADDITIVES, SOURCE_WATERS, WATER_TARGETS, GRAIN_LIBRARY, MASH_PRESETS, ENZYME_TABLE, BUFFER,
    platoToSG, sgToPlato, recipeStats, solveSalts, suggestDilution, alkalinity, residualAlk, predictMashPh, phAdvice,
    waterReport, strikeTemp, describeTemp, character, PTS_PER_KG_L };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BrewCalc = api;
})(this);
