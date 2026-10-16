/* Brew Tracker - UI. Data is stored in this browser's localStorage. */
(function () {
  'use strict';
  const C = window.BrewCalc;
  const STORE = 'brewtracker.v1';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const f1 = v => (isFinite(v) ? v : 0).toFixed(1);
  const f0 = v => Math.round(isFinite(v) ? v : 0);
  const sg3 = v => (isFinite(v) ? v : 1).toFixed(3);
  const numv = v => (typeof v === 'number' && isFinite(v) ? v : 0);

  // ---------- data ----------
  function newRecipe(name) {
    const src = C.SOURCE_WATERS.find(w => w.id === 'soft');
    const tgt = C.WATER_TARGETS.find(w => w.id === 'balanced');
    return {
      id: uid(), name: name || 'New recipe', style: '', brewDate: new Date().toISOString().slice(0, 10),
      batchL: 20, boilMin: 60, boilOffLph: 3, trubLossL: 1.5, absorption: 1.0, efficiency: 72, mashRatio: 3,
      grains: [], hops: [], yeast: { name: '', attenuation: 75 }, notes: '',
      water: { sourcePreset: 'soft', source: { ...src.ions }, targetPreset: 'balanced', target: { ...tgt.ions }, roPct: 0, treat: 'all', targetPh: 5.4, phOffset: 0, manual: null },
      mash: { preset: 'single66', steps: C.MASH_PRESETS[0].steps.map(s => ({ ...s })), grainTemp: 20, spargeTemp: 77 },
      actual: { preboilSG: '', og: '', fg: '', volume: '' }, log: [],
    };
  }
  function exampleRecipe() {
    const r = newRecipe('Example Pale Ale');
    r.style = 'American Pale Ale';
    const lib = n => ({ id: uid(), ...C.GRAIN_LIBRARY.find(g => g.name === n) });
    r.grains = [{ ...lib('Pale ale malt'), kg: 4.8 }, { ...lib('Munich malt I'), kg: 0.5 }, { ...lib('Crystal 40 EBC'), kg: 0.3 }];
    r.hops = [{ id: uid(), name: 'Magnum', g: 10, alpha: 12, min: 60, use: 'boil' }, { id: uid(), name: 'Cascade', g: 30, alpha: 6, min: 10, use: 'boil' }, { id: uid(), name: 'Cascade', g: 40, alpha: 6, min: 0, use: 'dry' }];
    r.yeast = { name: 'US-05 / Chico', attenuation: 77 };
    r.water.targetPreset = 'hoppy'; r.water.target = { ...C.WATER_TARGETS.find(w => w.id === 'hoppy').ions };
    return r;
  }
  let db;
  try { db = JSON.parse(localStorage.getItem(STORE)); } catch (e) { db = null; }
  if (!db || !db.recipes || !db.recipes.length) { const ex = exampleRecipe(); db = { recipes: [ex], current: ex.id }; }
  const R = () => db.recipes.find(r => r.id === db.current) || db.recipes[0];
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(db)); } catch (e) { /* storage unavailable */ } };

  let view = 'recipe';
  const mashUI = { step: 0, remaining: null, running: false, timer: null, total: 0 };

  // ---------- helpers ----------
  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; }
  const numIn = (path, val, o = {}) => `<input type="number" data-bind="${path}" data-t="n" step="${o.step || 'any'}" ${o.min != null ? `min="${o.min}"` : ''} value="${val ?? ''}">`;
  const txtIn = (path, val, ph = '') => `<input type="text" data-bind="${path}" value="${esc(val)}" placeholder="${esc(ph)}">`;
  const field = (label, inner) => `<label class="f">${label}${inner}</label>`;

  // ---------- summary + chrome ----------
  function updateSummary() {
    const r = R(), s = C.recipeStats(r);
    const st = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    $('#summary').innerHTML =
      st(sg3(s.og), 'OG') + st(sg3(s.fg), 'FG') + st(f1(s.abv) + ' %', 'ABV') + st(f0(s.ibu), 'IBU') + st(f0(s.ebc), 'EBC') + st(f1(s.totalKg) + ' kg', 'Grain') +
      `<div class="spacer"></div><div class="cta"><button class="primary" data-act="goCalc">Calculate water</button><button class="primary" data-act="goMash">Start mash</button></div>`;
  }
  function renderChrome() {
    $('#recipeSel').innerHTML = db.recipes.map(r => `<option value="${r.id}" ${r.id === db.current ? 'selected' : ''}>${esc(r.name || 'Untitled')}</option>`).join('');
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    updateSummary();
  }
  function render() {
    const fn = { recipe: viewRecipe, malt: viewMalt, water: viewWater, log: viewLog, calc: viewCalc, mash: viewMash }[view];
    $('#view').innerHTML = fn();
    renderChrome();
    if (view === 'mash') { updateTimerUI(); }
  }
  function refreshDerived() {
    updateSummary();
    const s = C.recipeStats(R());
    document.querySelectorAll('[data-pct]').forEach(el => { const g = R().grains.find(x => x.id === el.dataset.pct); el.textContent = s.totalKg > 0 ? f1(numv(g && g.kg) / s.totalKg * 100) + ' %' : ''; });
    const vol = $('#volInfo'); if (vol) vol.innerHTML = volInfo(s);
    const ratio = $('#ratioInfo'); if (ratio) ratio.innerHTML = waterIonInfo();
  }

  // ---------- views ----------
  function volInfo(s) {
    return `<dl class="kv"><dt>Pre-boil volume</dt><dd>${f1(s.preboilL)} L</dd><dt>Total water needed</dt><dd>${f1(s.totalWater)} L</dd><dt>Mash water</dt><dd>${f1(s.mashWater)} L</dd><dt>Sparge water</dt><dd>${f1(s.spargeWater)} L</dd><dt>Pre-boil gravity</dt><dd>${sg3(s.preboilSG)}</dd></dl>`;
  }

  function viewRecipe() {
    const r = R(), s = C.recipeStats(r);
    const hops = r.hops.map((h, i) => `<tr>
      <td class="full" data-label="Hop">${txtIn(`hops.${i}.name`, h.name, 'Hop')}</td>
      <td class="num" data-label="Grams">${numIn(`hops.${i}.g`, h.g)}</td><td class="num" data-label="Alpha %">${numIn(`hops.${i}.alpha`, h.alpha)}</td>
      <td data-label="Use"><select data-bind="hops.${i}.use" data-rerender="1"><option value="boil" ${h.use === 'boil' ? 'selected' : ''}>Boil</option><option value="whirlpool" ${h.use === 'whirlpool' ? 'selected' : ''}>Whirlpool / flameout</option><option value="dry" ${h.use === 'dry' ? 'selected' : ''}>Dry hop</option></select></td>
      <td class="num" data-label="Minutes">${numIn(`hops.${i}.min`, h.min)}</td><td class="full right"><button class="small danger" data-act="delHop" data-i="${i}" aria-label="Remove hop">Remove</button></td></tr>`).join('');
    return `
    <div class="card"><h2>Recipe</h2><div class="grid">
      ${field('Name', txtIn('name', r.name))}${field('Style', txtIn('style', r.style, 'e.g. American Pale Ale'))}
      ${field('Batch size into fermenter (L)', numIn('batchL', r.batchL))}${field('Boil time (min)', numIn('boilMin', r.boilMin))}
      ${field('Brewhouse efficiency (%)', numIn('efficiency', r.efficiency))}${field('Boil-off (L / hour)', numIn('boilOffLph', r.boilOffLph))}
      ${field('Trub / kettle loss (L)', numIn('trubLossL', r.trubLossL))}${field('Grain absorption (L / kg)', numIn('absorption', r.absorption))}
      ${field('Mash thickness (L water / kg grain)', numIn('mashRatio', r.mashRatio))}
    </div></div>
    <div class="grid two">
      <div class="card"><h3>Hops</h3><div class="table-wrap"><table class="cards"><thead><tr><th>Hop</th><th class="num">g</th><th class="num">Alpha %</th><th>Use</th><th class="num">Min</th><th></th></tr></thead><tbody>${hops}</tbody></table></div>
        <p><button data-act="addHop">+ Add hop</button> <span class="muted small">IBU by Tinseth, estimated: ${f0(s.ibu)}</span></p></div>
      <div class="card"><h3>Yeast</h3><div class="grid">${field('Yeast', txtIn('yeast.name', r.yeast.name, 'e.g. US-05'))}${field('Apparent attenuation (%)', numIn('yeast.attenuation', r.yeast.attenuation))}</div>
        <h3 style="margin-top:1rem">Volumes</h3><div id="volInfo">${volInfo(s)}</div></div>
    </div>
    <div class="card"><h3>Notes</h3><textarea data-bind="notes" placeholder="Fermentation temperature, tasting notes, changes for next time...">${esc(r.notes)}</textarea></div>`;
  }

  function viewMalt() {
    const r = R(), s = C.recipeStats(r);
    const types = ['base', 'crystal', 'roast', 'acid', 'adjunct', 'sugar'];
    const rows = r.grains.map((g, i) => `<tr>
      <td class="full" data-label="Grain">${txtIn(`grains.${i}.name`, g.name, 'Malt / grain')}</td>
      <td data-label="Type"><select data-bind="grains.${i}.type" data-rerender="1">${types.map(t => `<option ${g.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td class="num" data-label="kg">${numIn(`grains.${i}.kg`, g.kg, { step: 0.05 })}</td>
      <td class="num muted" data-label="% of grist" data-pct="${g.id}">${s.totalKg > 0 ? f1(numv(g.kg) / s.totalKg * 100) + ' %' : ''}</td>
      <td class="num" data-label="Extract %">${numIn(`grains.${i}.extract`, g.extract)}</td><td class="num" data-label="Colour EBC">${numIn(`grains.${i}.ebc`, g.ebc)}</td>
      <td class="num" data-label="DI mash pH">${numIn(`grains.${i}.dipH`, g.dipH, { step: 0.01 })}</td>
      <td class="full right"><button class="small danger" data-act="delGrain" data-i="${i}" aria-label="Remove grain">Remove</button></td></tr>`).join('');
    return `<div class="card"><h2>Malt Bill</h2>
      <div class="table-wrap"><table class="cards"><thead><tr><th>Grain</th><th>Type</th><th class="num">kg</th><th class="num">%</th><th class="num">Extract %</th><th class="num">Colour EBC</th><th class="num">DI mash pH</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="muted">No grains yet. Add one below.</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:12px"><select id="grainPick" style="width:auto;min-width:220px">${C.GRAIN_LIBRARY.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join('')}</select>
        <button data-act="addGrain">+ Add from library</button><button data-act="addBlankGrain">+ Blank row</button></div>
      <p class="muted small">Extract % = dry-basis fine-grind yield. DI mash pH = pH of the grain mashed in distilled water (used to estimate mash pH; roasted and crystal malts are more acidic). "sugar" is added in the boil and ignores efficiency; "acid" malt lowers mash pH about 0.1 per 1 % of the grist.</p>
    </div>
    <div class="card"><div class="row"><div class="stat"><b>${sg3(s.og)}</b><span>Original gravity</span></div><div class="stat"><b>${f0(s.ebc)} EBC</b><span>Colour</span></div><div class="stat"><b>${f1(s.totalKg)} kg</b><span>Total grain</span></div>
      <div class="stat"><b>${f1(s.mashWater)} L</b><span>Mash water</span></div><div class="stat"><b>${f1(s.spargeWater)} L</b><span>Sparge water</span></div></div></div>`;
  }

  function waterIonInfo() {
    const w = R().water;
    const line = (label, ions) => { const c = C.character(ions); return `<tr><td>${label}</td><td class="num">${f0(C.alkalinity(ions))}</td><td class="num">${f0(C.residualAlk(ions))}</td><td class="num">${c.ratio.toFixed(2)}</td><td>${c.label}</td></tr>`; };
    return `<table><thead><tr><th></th><th class="num">Alkalinity (as CaCO3)</th><th class="num">Residual alk.</th><th class="num">SO4 : Cl</th><th>Character</th></tr></thead><tbody>${line('Source', w.source)}${line('Target', w.target)}</tbody></table>`;
  }
  function ionInputs(base, ions) {
    return `<div class="grid">${C.ION_KEYS.map(k => field(C.ION_LABEL[k] + ' ppm', numIn(`${base}.${k}`, ions[k]))).join('')}</div>`;
  }
  function viewWater() {
    const r = R(), w = r.water;
    return `<div class="card"><h2>Water Profile</h2><p class="muted">Enter your source water from a water report (all values in ppm = mg/L). Pick the character you want for the beer; the Calculate button works out the salts.</p>
      <div class="grid two"><div>
        <h3>Source water</h3>${field('Preset', `<select data-bind="water.sourcePreset" data-action="srcPreset">${C.SOURCE_WATERS.map(p => `<option value="${p.id}" ${w.sourcePreset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}
        <div style="height:8px"></div>${ionInputs('water.source', w.source)}</div>
      <div><h3>Target profile</h3>${field('Preset', `<select data-bind="water.targetPreset" data-action="tgtPreset">${C.WATER_TARGETS.map(p => `<option value="${p.id}" ${w.targetPreset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}
        <div style="height:8px"></div>${ionInputs('water.target', w.target)}</div></div>
      <div id="ratioInfo" class="table-wrap" style="margin-top:14px">${waterIonInfo()}</div></div>
    <div class="card"><h3>Treatment options</h3><div class="grid">
      ${field('RO / distilled water share (%)', numIn('water.roPct', w.roPct, { min: 0 }))}
      ${field('Add salts to', `<select data-bind="water.treat"><option value="all" ${w.treat === 'all' ? 'selected' : ''}>Mash + sparge water</option><option value="mash" ${w.treat === 'mash' ? 'selected' : ''}>Mash water only</option></select>`)}
      ${field('Target mash pH (5.2 - 5.6)', numIn('water.targetPh', w.targetPh, { step: 0.05 }))}
      ${field('pH calibration offset (measured - predicted)', numIn('water.phOffset', w.phOffset, { step: 0.05 }))}
    </div><div style="margin-top:12px"><button class="primary" data-act="goCalc">Calculate water additions</button></div></div>`;
  }

  function viewLog() {
    const r = R(), s = C.recipeStats(r), a = r.actual;
    const ogPts = (numv(parseFloat(a.og)) - 1) * 1000;
    const potKg = r.grains.reduce((t, g) => t + numv(g.kg) * numv(g.extract) / 100 * (g.type === 'sugar' ? 0 : 1), 0);
    const sugarPts = r.grains.filter(g => g.type === 'sugar').reduce((t, g) => t + numv(g.kg) * numv(g.extract) / 100 * C.PTS_PER_KG_L / r.batchL, 0);
    const actEff = potKg > 0 && a.og ? ((ogPts - sugarPts) * r.batchL) / (potKg * C.PTS_PER_KG_L) * 100 : null;
    const fgv = parseFloat(a.fg), ogv = parseFloat(a.og);
    const abv = fgv && ogv ? (ogv - fgv) * 131.25 : null;
    const rows = r.log.map((l, i) => `<tr><td class="full" data-label="When">${esc(new Date(l.t).toLocaleString())}</td><td class="full" data-label="Stage">${esc(l.step || '')}</td><td class="num" data-label="Temp">${l.temp !== '' && l.temp != null ? esc(l.temp) + ' C' : ''}</td><td class="num" data-label="pH">${esc(l.ph ?? '')}</td><td class="num" data-label="SG">${esc(l.sg ?? '')}</td><td class="full" data-label="Note">${esc(l.note || '')}</td><td class="full right"><button class="small danger" data-act="delLog" data-i="${i}" aria-label="Delete entry">Delete</button></td></tr>`).join('');
    return `<div class="card"><h2>Brew day results</h2><div class="grid">
      ${field('Brew date', `<input type="date" data-bind="brewDate" value="${esc(r.brewDate)}">`)}
      ${field(`Pre-boil gravity (target ${sg3(s.preboilSG)})`, `<input type="number" step="0.001" data-bind="actual.preboilSG" value="${esc(a.preboilSG)}">`)}
      ${field(`Original gravity (target ${sg3(s.og)})`, `<input type="number" step="0.001" data-bind="actual.og" data-rerender="1" value="${esc(a.og)}">`)}
      ${field(`Final gravity (target ${sg3(s.fg)})`, `<input type="number" step="0.001" data-bind="actual.fg" data-rerender="1" value="${esc(a.fg)}">`)}
      ${field('Volume into fermenter (L)', `<input type="number" step="0.1" data-bind="actual.volume" value="${esc(a.volume)}">`)}</div>
      <p>${actEff != null ? `<span class="pill ${actEff >= r.efficiency - 3 ? 'ok' : 'warn'}">Brewhouse efficiency ${f1(actEff)} %</span> (recipe assumes ${r.efficiency} %)` : '<span class="muted">Enter OG to see achieved efficiency.</span>'}
      ${abv != null ? ` <span class="pill ok">ABV ${f1(abv)} %</span>` : ''}</p></div>
    <div class="card"><h2>Brew log</h2>
      <div class="table-wrap"><table class="cards"><thead><tr><th>When</th><th>Stage</th><th class="num">Temp</th><th class="num">pH</th><th class="num">SG</th><th>Note</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Nothing logged yet. Readings from the mash page appear here.</td></tr>'}</tbody></table></div>
      <div class="grid" style="margin-top:12px;align-items:end">${field('Stage', '<input id="lgStep" placeholder="e.g. Fermentation">')}${field('Temp (C)', '<input id="lgTemp" type="number" step="0.1">')}${field('pH', '<input id="lgPh" type="number" step="0.01">')}${field('SG', '<input id="lgSg" type="number" step="0.001">')}${field('Note', '<input id="lgNote">')}<div><button data-act="addLog">Add entry</button></div></div></div>`;
  }

  // ----- calculate page -----
  const NUDGE = 0.5;   // grams per +/- tap

  function calcStripHtml(rep) {
    const phCls = rep.ph > 5.6 || rep.ph < 5.1 ? 'bad' : (rep.ph > 5.45 || rep.ph < 5.2 ? 'warn' : 'ok');
    const cell = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
    return `<div class="strip-in"><div class="pill ${phCls} ph">pH ${rep.ph.toFixed(2)}</div>${cell(f0(rep.final.ca), 'Ca')}${cell(f0(rep.final.so4), 'SO4')}${cell(f0(rep.final.cl), 'Cl')}${cell(rep.character.ratio.toFixed(1), 'SO4:Cl')}</div>`;
  }

  function calcLiveHtml(r, rep) {
    const auto = rep.isManual ? C.waterReport(r, { auto: true }) : null;
    const ions = C.ION_KEYS.map(k => {
      const t = numv(r.water.target[k]), diff = rep.final[k] - t, added = rep.final[k] - rep.diluted[k];
      const cls = Math.abs(diff) <= Math.max(10, t * 0.15) ? 'ok' : (Math.abs(diff) <= Math.max(25, t * 0.3) ? 'warn' : 'bad');
      const vs = auto ? rep.final[k] - auto.final[k] : 0;
      return `<tr><td>${C.ION_LABEL[k]}</td><td class="num hide-s">${f0(r.water.source[k])}</td><td class="num hide-s">${f0(rep.diluted[k])}</td><td class="num hide-s">${added > 0.5 ? '+' + f0(added) : '-'}</td>
        <td class="num"><b>${f0(rep.final[k])}</b></td><td class="num">${f0(t)}</td><td><span class="pill ${cls}">${diff > 0 ? '+' : ''}${f0(diff)}</span></td>
        ${auto ? `<td class="num muted">${Math.abs(vs) < 0.5 ? '-' : (vs > 0 ? '+' : '') + f0(vs)}</td>` : ''}</tr>`;
    }).join('');
    const adv = rep.advice;
    const phCls = rep.ph > 5.6 || rep.ph < 5.1 ? 'bad' : (rep.ph > 5.45 || rep.ph < 5.2 ? 'warn' : 'ok');
    let phNote;
    if (adv.kind === 'acid') phNote = `<div class="note warn">Predicted mash pH is above your ${rep.targetPh} target. Add about <b>${f1(adv.lacticMl)} mL lactic acid (88 %)</b> or ${f1(adv.phosMl)} mL phosphoric acid (85 %) to the mash water, then verify with a pH meter.</div>`;
    else if (adv.kind === 'base') phNote = `<div class="note warn">Predicted mash pH is below your ${rep.targetPh} target. Add about <b>${f1(adv.sodaG)} g baking soda</b> (or chalk, pre-dissolved) to the mash, or use less dark malt. Check the sodium it adds.</div>`;
    else phNote = `<div class="note ok">Predicted mash pH is close to the ${rep.targetPh} target. No acid needed.</div>`;

    return `${rep.isManual ? `<div class="note">You are using <b>your own amounts</b>. <button class="small" data-act="resetManual">Reset to suggestion</button></div>` : ''}
    <div class="card"><div class="row between"><h3>Resulting character</h3><div class="right"><div class="big">${esc(rep.character.label)}</div><span class="muted">Sulfate : chloride = ${rep.character.ratio.toFixed(2)}${auto ? ` (suggested: ${auto.character.ratio.toFixed(2)})` : ''}</span></div></div></div>
    <div class="card"><h3>Resulting water profile (ppm)</h3><div class="table-wrap"><table class="ions"><thead><tr><th>Ion</th><th class="num hide-s">Source</th><th class="num hide-s">After dilution</th><th class="num hide-s">Added</th><th class="num">Final</th><th class="num">Target</th><th>Off by</th>${auto ? '<th class="num">vs sugg.</th>' : ''}</tr></thead><tbody>${ions}</tbody></table></div>
      <p class="muted small">Alkalinity of the final water: ${f0(rep.alk)} ppm as CaCO3. Residual alkalinity: ${f0(rep.ra)} ppm.</p>
      ${rep.warnings.map(w => `<div class="note warn">${esc(w)}</div>`).join('')}</div>
    <div class="card"><h3>Mash pH</h3><div class="row"><div class="big">${rep.ph.toFixed(2)}</div><span class="pill ${phCls}">target ${rep.targetPh} (range 5.2 - 5.6)</span>${auto ? `<span class="muted small">suggested amounts: ${auto.ph.toFixed(2)}</span>` : ''}</div>
      ${phNote}
      ${rep.sparge.needed ? `<div class="note warn"><b>Sparge water</b> has ${f0(rep.sparge.alk)} ppm alkalinity. Acidify it to about pH 5.5 - 6.0 with roughly <b>${f1(rep.sparge.lacticMl)} mL lactic acid (88 %)</b> so the last runnings don't pull tannins from the husks.</div>` : '<div class="note ok">Sparge water alkalinity is low enough; no acidification needed.</div>'}
      <p class="muted small">pH is an estimate from your malt's DI-water pH and the water's residual alkalinity (about &plusmn;0.15). Measure the real mash pH 10-15 minutes in, using a sample cooled to room temperature. Enter the difference as the calibration offset in Water Profile.</p></div>`;
  }

  // refresh everything that depends on the additive amounts, without touching the inputs
  function updateCalcLive() {
    const r = R(), rep = C.waterReport(r);
    const live = $('#calcLive'); if (!live) return;
    live.innerHTML = calcLiveHtml(r, rep);
    $('#calcStrip').innerHTML = calcStripHtml(rep);
    rep.additives.forEach(a => {
      const m = document.querySelector(`[data-mash="${a.key}"]`), sp = document.querySelector(`[data-sparge="${a.key}"]`);
      if (m) m.textContent = f1(a.mashG) + ' g';
      if (sp) sp.textContent = (r.water.treat === 'mash' || a.key === 'chalk') ? '-' : f1(a.spargeG) + ' g';
    });
  }
  // the first manual edit freezes the current suggestion as the starting amounts
  function ensureManual() {
    const w = R().water;
    if (w.manual) return;
    w.manual = {};
    C.waterReport(R(), { auto: true }).additives.forEach(a => { w.manual[a.key] = Math.round(a.totalG * 10) / 10; });
  }

  function viewCalc() {
    const r = R(), rep = C.waterReport(r), s = rep.stats;
    const rows = rep.additives.map(a => `<tr>
      <td class="full" data-label="Additive"><b>${a.name}</b> <span class="muted small">${a.formula}</span></td>
      <td class="full" data-label="Amount, total grams"><div class="stepper"><button class="step-btn" data-act="nudge" data-key="${a.key}" data-d="-1" aria-label="Less ${a.name}">&minus;</button><input type="number" inputmode="decimal" step="0.1" min="0" data-manual="${a.key}" value="${Math.round(a.totalG * 10) / 10}" aria-label="${a.name} grams"><button class="step-btn" data-act="nudge" data-key="${a.key}" data-d="1" aria-label="More ${a.name}">+</button></div></td>
      <td class="num" data-label="Mash (${f1(s.mashWater)} L)"><span data-mash="${a.key}">${f1(a.mashG)} g</span></td>
      <td class="num" data-label="Sparge (${f1(s.spargeWater)} L)"><span data-sparge="${a.key}">${r.water.treat === 'mash' || a.key === 'chalk' ? '-' : f1(a.spargeG) + ' g'}</span></td>
      <td class="num muted" data-label="Suggested">${f1(a.autoG)} g</td></tr>`).join('');
    const cur = Math.round(rep.roPct), sug = rep.suggestedPct;
    return `<button class="back" data-act="goBack">&larr; Back to recipe</button>
    <div class="card"><h2>Water treatment: ${esc(r.name)}</h2><span class="muted">${s.mashWater > 0 ? `${f1(s.mashWater)} L mash water + ${f1(s.spargeWater)} L sparge water` : 'Add grain in the Malt Bill to size the water volumes.'}</span></div>

    ${sug > cur + 4 ? `<div class="note warn"><b>Suggestion:</b> your source water is mineral-rich for this target. Blending in about <b>${sug} % RO / distilled water</b> gets closer to the target profile${s.mashWater > 0 ? ` (${f1(s.totalWater * sug / 100)} L of your ${f1(s.totalWater)} L)` : ''}. <button class="small" data-act="applyRo" data-p="${sug}">Apply ${sug} %</button></div>` : ''}
    ${cur > 0 ? `<div class="note">Currently blending <b>${cur} %</b> RO/distilled water. <button class="small" data-act="applyRo" data-p="0">Reset to 0 %</button></div>` : ''}

    <div class="strip" id="calcStrip">${calcStripHtml(rep)}</div>

    <div class="card"><h3>Additions (${r.water.treat === 'mash' ? 'mash water only' : 'mash + sparge water'})</h3>
      <p class="muted small">Starts at the suggested amounts. Change any amount with the &minus; / + buttons (${NUDGE} g) or type it in, and the profile, character and pH below update straight away.</p>
      <div class="table-wrap"><table class="cards adds"><thead><tr><th>Additive</th><th>Total g</th><th class="num">Mash</th><th class="num">Sparge</th><th class="num">Suggested</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">Dissolve salts in the water before adding the grain. Chalk dissolves poorly and only goes in the mash.</p></div>

    <div id="calcLive">${calcLiveHtml(r, rep)}</div>
    <div class="row"><button class="primary" data-act="goMash">Start mash &rarr;</button><button data-act="goWater">Edit water profile</button></div>`;
  }

  // ----- mash page -----
  function viewMash() {
    const r = R(), s = C.recipeStats(r), rep = C.waterReport(r), m = r.mash;
    const first = m.steps[0] ? m.steps[0].temp : 66;
    const strike = C.strikeTemp(numv(r.mashRatio), first, numv(m.grainTemp));
    const steps = m.steps.map((st, i) => `<div class="step ${i === mashUI.step ? 'active' : (i < mashUI.step ? 'done' : '')}">
      <div class="idx">${i + 1}</div><div><b>${esc(st.name)}</b> <span class="muted">hold ${st.min} min</span><div class="small muted">${esc(C.describeTemp(st.temp))}</div>
      <details class="edit"><summary>Edit step</summary><div class="grid">${field('Name', txtIn(`mash.steps.${i}.name`, st.name))}${field('Temperature (C)', numIn(`mash.steps.${i}.temp`, st.temp))}${field('Hold (min)', numIn(`mash.steps.${i}.min`, st.min))}</div><button class="small danger" data-act="delStep" data-i="${i}" style="margin-top:8px">Remove step</button></details></div>
      <div class="temp">${st.temp} &deg;C</div></div>`).join('');
    const hasRaw = r.grains.some(g => g.type === 'adjunct' && numv(g.kg) > 0);
    const wheat = r.grains.some(g => /wheat|oat|rye/i.test(g.name) && numv(g.kg) > 0);
    return `<button class="back" data-act="goBack">&larr; Back to recipe</button>
    <div class="card"><div class="row between"><h2>Mash: ${esc(r.name)}</h2>${field('Mash schedule', `<select data-bind="mash.preset" data-action="mashPreset">${C.MASH_PRESETS.map(p => `<option value="${p.id}" ${m.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`)}</div>
      <div class="grid" style="margin-top:8px">
        <div class="stat"><b>${f1(strike)} &deg;C</b><span>Strike water temp</span></div>
        <div class="stat"><b>${f1(s.mashWater)} L</b><span>Mash water (${r.mashRatio} L/kg)</span></div>
        <div class="stat"><b>${f1(s.spargeWater)} L @ ${m.spargeTemp} &deg;C</b><span>Sparge water</span></div>
        <div class="stat"><b>${f1(s.mashKg)} kg</b><span>Grist</span></div></div>
      <div class="grid" style="margin-top:10px">${field('Grain temperature (C)', numIn('mash.grainTemp', m.grainTemp, { step: 1 }))}${field('Sparge temperature (C)', numIn('mash.spargeTemp', m.spargeTemp))}</div>
      <p class="muted small">Strike temperature: (0.41 / L-per-kg) x (rest temp - grain temp) + rest temp. Preheat the mash tun and add a degree or two if it loses a lot of heat. Dough in, stir well, and check the temperature.</p>
      ${hasRaw || wheat ? '<div class="note warn">Your grist includes oats, wheat, rye or raw adjuncts. Gelatinisation needs 53 - 70 C (maize and rice higher); a beta-glucan or 40-45 C rest helps prevent a stuck sparge. Add rice hulls if the mash is gummy.</div>' : ''}</div>

    <div class="grid two mash-grid"><div class="card"><h3>Temperature targets</h3><div class="steps">${steps}</div>
      <div class="row" style="margin-top:10px"><button data-act="addStep">+ Add step</button></div></div>

      <div class="card timer-card"><h3>Step timer</h3><div id="timerBox"></div>
        <div class="row" style="margin-top:8px"><button class="primary" data-act="timerToggle" id="tBtn">Start</button><button data-act="timerNext">Next step</button><button data-act="timerReset">Reset</button></div>
        <h3 style="margin-top:18px">pH and gravity targets</h3>
        <dl class="kv">
          <dt>Mash pH (room temp sample)</dt><dd>5.2 - 5.6, aim ${rep.targetPh} <span class="muted small">(predicted ${rep.ph.toFixed(2)})</span></dd>
          <dt>Mash pH read hot (65 C)</dt><dd>about 0.3 lower (4.9 - 5.3)</dd>
          <dt>Mash liquor gravity at end of conversion</dt><dd>${sg3(s.mashSG)} (${f1(s.mashPlato)} &deg;P)</dd>
          <dt>Iodine test</dt><dd>no blue/black colour = starch converted</dd>
          <dt>Pre-boil gravity</dt><dd>${sg3(s.preboilSG)} in ${f1(s.preboilL)} L</dd>
          <dt>Last runnings</dt><dd>stop at SG 1.008 - 1.010 or pH 6.0</dd>
          <dt>Target OG / FG</dt><dd>${sg3(s.og)} / ${sg3(s.fg)}</dd></dl></div></div>

    <div class="card"><h3>Log a reading</h3><div class="grid" style="align-items:end">
      ${field('Temp (C)', '<input id="mTemp" type="number" step="0.1">')}${field('pH (room temp)', '<input id="mPh" type="number" step="0.01">')}${field('Gravity (SG)', '<input id="mSg" type="number" step="0.001">')}${field('Note', '<input id="mNote">')}
      <div><button class="primary" data-act="addReading">Add to brew log</button></div></div>
      <div id="readingFeedback"></div></div>

    <div class="card"><h3>What the temperatures do</h3><div class="table-wrap"><table><thead><tr><th>Component</th><th>Enzyme / process</th><th>Temp (C)</th><th>pH</th><th>Effect</th></tr></thead><tbody>
      ${C.ENZYME_TABLE.map(e => `<tr><td>${e.target}</td><td>${e.agent}</td><td>${e.temp}</td><td>${e.ph}</td><td>${e.effect}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function stepSecs() { const st = R().mash.steps[mashUI.step]; return st ? numv(st.min) * 60 : 0; }
  function updateTimerUI() {
    const box = $('#timerBox'); if (!box) return;
    const r = R(), st = r.mash.steps[mashUI.step];
    if (!st) { box.innerHTML = '<p class="note ok">All steps done. Check for starch conversion with the iodine test, then lauter and sparge.</p>'; return; }
    const total = stepSecs(); const rem = mashUI.remaining == null ? total : mashUI.remaining;
    const mm = String(Math.floor(rem / 60)).padStart(2, '0'), ss = String(Math.floor(rem % 60)).padStart(2, '0');
    box.innerHTML = `<div class="muted">Step ${mashUI.step + 1} of ${r.mash.steps.length}</div><div><b>${esc(st.name)}</b>: heat to <b>${st.temp} &deg;C</b>, then hold</div><div class="timer">${mm}:${ss}</div><div class="bar"><i style="width:${total ? (100 - rem / total * 100) : 0}%"></i></div>`;
    const b = $('#tBtn'); if (b) b.textContent = mashUI.running ? 'Pause' : (mashUI.remaining != null && mashUI.remaining < total ? 'Resume' : 'Start hold timer');
  }
  function beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); o.connect(a.destination); o.frequency.value = 880; o.start(); setTimeout(() => { o.stop(); a.close(); }, 600); } catch (e) { /* no audio */ } }
  // keep the phone screen on while a hold timer runs (needs https or localhost; silently skipped otherwise)
  let wake = null;
  function holdScreen(on) {
    try {
      if (on && navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(l => { wake = l; l.addEventListener('release', () => { wake = null; }); }).catch(() => {});
      else if (!on && wake) { wake.release(); wake = null; }
    } catch (e) { /* not supported */ }
  }
  function stopTimer() { clearInterval(mashUI.timer); mashUI.timer = null; mashUI.running = false; holdScreen(false); }
  // based on a wall-clock end time so it stays correct when a phone throttles the page in the background
  function tick() {
    mashUI.remaining = Math.max(0, Math.ceil((mashUI.endAt - Date.now()) / 1000));
    if (mashUI.remaining <= 0) { stopTimer(); beep(); try { navigator.vibrate && navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) { /* no vibration */ } }
    updateTimerUI();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mashUI.running) { tick(); holdScreen(true); } });

  function readingFeedback() {
    const box = $('#readingFeedback'); if (!box) return;
    const r = R(), s = C.recipeStats(r), tp = numv(r.water.targetPh) || 5.4;
    const ph = parseFloat($('#mPh').value), sg = parseFloat($('#mSg').value);
    let html = '';
    if (isFinite(ph)) {
      const a = C.phAdvice(ph, tp, s.mashKg);
      const cls = ph >= 5.2 && ph <= 5.6 ? 'ok' : 'warn';
      html += `<div class="note ${a.kind ? 'warn' : cls}">pH ${ph.toFixed(2)}: ${a.kind === 'acid' ? `above target. Stir in about ${f1(a.lacticMl)} mL lactic acid (88 %) for the whole mash (go in halves and re-measure).` : a.kind === 'base' ? `below target. Add about ${f1(a.sodaG)} g baking soda, or accept it for a dark beer.` : 'in the good range.'}</div>`;
    }
    if (isFinite(sg)) {
      const pct = (sg - 1) / (s.mashSG - 1) * 100;
      html += `<div class="note ${pct >= 90 ? 'ok' : 'warn'}">Gravity ${sg3(sg)} is ${f0(pct)} % of the expected mash gravity ${sg3(s.mashSG)}. ${pct >= 90 ? 'Conversion looks complete.' : 'Keep mashing and re-check, or stir to dissolve more extract.'}</div>`;
    }
    box.innerHTML = html;
  }

  // ---------- events ----------
  const actions = {
    newRecipe() { const r = newRecipe(); db.recipes.push(r); db.current = r.id; view = 'recipe'; },
    dupRecipe() { const c = JSON.parse(JSON.stringify(R())); c.id = uid(); c.name += ' (copy)'; c.log = []; db.recipes.push(c); db.current = c.id; },
    delRecipe() { if (!confirm('Delete this recipe?')) return; db.recipes = db.recipes.filter(r => r.id !== db.current); if (!db.recipes.length) db.recipes.push(newRecipe()); db.current = db.recipes[0].id; },
    exportRecipe() { const blob = new Blob([JSON.stringify(R(), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (R().name || 'recipe').replace(/[^\w-]+/g, '_') + '.json'; a.click(); return false; },
    goCalc() { view = 'calc'; }, goMash() { view = 'mash'; }, goBack() { view = 'recipe'; }, goWater() { view = 'water'; },
    applyRo(el) { const w = R().water; w.roPct = parseFloat(el.dataset.p); w.manual = null; },
    resetManual() { R().water.manual = null; },
    nudge(el) {
      ensureManual();
      const w = R().water, k = el.dataset.key;
      w.manual[k] = Math.max(0, Math.round((numv(w.manual[k]) + NUDGE * +el.dataset.d) * 10) / 10);
      document.querySelector(`[data-manual="${k}"]`).value = w.manual[k];
      save(); updateCalcLive(); return false;
    },
    addHop() { R().hops.push({ id: uid(), name: '', g: 0, alpha: 5, min: 60, use: 'boil' }); },
    delHop(el) { R().hops.splice(+el.dataset.i, 1); },
    addGrain() { const g = C.GRAIN_LIBRARY[+$('#grainPick').value]; R().grains.push({ id: uid(), ...g, kg: 1 }); },
    addBlankGrain() { R().grains.push({ id: uid(), name: '', type: 'base', kg: 0, extract: 75, ebc: 5, dipH: 5.7 }); },
    delGrain(el) { R().grains.splice(+el.dataset.i, 1); },
    addStep() { const m = R().mash; m.preset = 'custom'; m.steps.push({ name: 'Rest', temp: 66, min: 30 }); },
    delStep(el) { const m = R().mash; m.preset = 'custom'; m.steps.splice(+el.dataset.i, 1); mashUI.step = Math.min(mashUI.step, m.steps.length); },
    addLog() { const v = id => $(id).value; R().log.push({ t: new Date().toISOString(), step: v('#lgStep'), temp: v('#lgTemp'), ph: v('#lgPh'), sg: v('#lgSg'), note: v('#lgNote') }); },
    delLog(el) { R().log.splice(+el.dataset.i, 1); },
    addReading() {
      const v = id => $(id).value; const st = R().mash.steps[mashUI.step];
      if (!v('#mTemp') && !v('#mPh') && !v('#mSg') && !v('#mNote')) return false;
      R().log.push({ t: new Date().toISOString(), step: 'Mash' + (st ? ': ' + st.name : ''), temp: v('#mTemp'), ph: v('#mPh'), sg: v('#mSg'), note: v('#mNote') });
      ['#mTemp', '#mPh', '#mSg', '#mNote'].forEach(i => { $(i).value = ''; }); $('#readingFeedback').innerHTML = '<div class="note ok">Saved to the brew log.</div>'; return false;
    },
    timerToggle() {
      if (mashUI.running) { stopTimer(); } else {
        if (mashUI.remaining == null || mashUI.remaining <= 0) mashUI.remaining = stepSecs();
        mashUI.running = true; mashUI.endAt = Date.now() + mashUI.remaining * 1000; mashUI.timer = setInterval(tick, 500); holdScreen(true);
      }
      updateTimerUI(); return false;
    },
    timerNext() { stopTimer(); mashUI.step = Math.min(mashUI.step + 1, R().mash.steps.length); mashUI.remaining = null; },
    timerReset() { stopTimer(); mashUI.step = 0; mashUI.remaining = null; },
  };

  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { if (view === 'mash') stopTimer(); view = tab.dataset.tab; render(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (view === 'mash' && /^go/.test(b.dataset.act)) stopTimer();
    const res = actions[b.dataset.act](b);
    if (res === false) return;
    save(); render();
  });

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'mPh' || el.id === 'mSg') { readingFeedback(); return; }
    if (el.dataset.manual) {
      ensureManual();
      const v = parseFloat(el.value);
      R().water.manual[el.dataset.manual] = isFinite(v) && v > 0 ? v : 0;
      save(); updateCalcLive(); return;
    }
    if (!el.dataset.bind || el.tagName === 'SELECT') return;
    let v = el.value;
    if (el.dataset.t === 'n') { v = parseFloat(v); if (!isFinite(v)) v = 0; }
    setPath(R(), el.dataset.bind, v);
    if (/^mash\.steps\./.test(el.dataset.bind)) R().mash.preset = 'custom';
    if (el.dataset.bind === 'name') { const o = $('#recipeSel option:checked'); if (o) o.textContent = v || 'Untitled'; }
    if (/^water\.(source|target)\./.test(el.dataset.bind)) {
      const k = el.dataset.bind.split('.')[1]; R().water[k + 'Preset'] = 'custom';
      const sel = document.querySelector(`[data-action="${k === 'source' ? 'srcPreset' : 'tgtPreset'}"]`); if (sel) sel.value = 'custom';
    }
    save(); refreshDerived();
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'recipeSel') { stopTimer(); db.current = el.value; mashUI.step = 0; mashUI.remaining = null; save(); render(); return; }
    if (el.id === 'importFile') {
      const f = el.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { const r = JSON.parse(rd.result); if (!r.grains || !r.water) throw new Error('bad'); r.id = uid(); db.recipes.push(r); db.current = r.id; save(); render(); } catch (err) { alert('That file is not a Brew Tracker recipe.'); } };
      rd.readAsText(f); el.value = ''; return;
    }
    if (!el.dataset.bind) return;
    const w = R().water;
    if (el.tagName === 'SELECT') {
      setPath(R(), el.dataset.bind, el.value);
      if (el.dataset.action === 'srcPreset') { const p = C.SOURCE_WATERS.find(x => x.id === el.value); if (p.ions) w.source = { ...p.ions }; }
      if (el.dataset.action === 'tgtPreset') { const p = C.WATER_TARGETS.find(x => x.id === el.value); if (p.ions) w.target = { ...p.ions }; }
      if (el.dataset.action === 'mashPreset') { const p = C.MASH_PRESETS.find(x => x.id === el.value); if (p.steps) R().mash.steps = p.steps.map(s => ({ ...s })); stopTimer(); mashUI.step = 0; mashUI.remaining = null; }
      save(); render(); return;
    }
    if (el.dataset.rerender) { save(); render(); }
  });
  window.addEventListener('beforeunload', save);
  render();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
