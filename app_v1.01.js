/* Skies & Seas: Fog of War — v1.01
   A Battleship-like pass-and-play web game with:
   - Two layers (Sea + Air)
   - Fog tokens on misses
   - Recon clearing Fog and counting occupancy
   - Air Superiority: 1 yes/no question per turn if you have more active planes
   - Simple plane "disable" timer (returns after 2 of owner's turns)
*/
(() => {
  'use strict';

  const VERSION = '1.01';
  const SIZE = 10;

  // --- Units -------------------------------------------------------------
  const SHIPS = [
    { id: 'carrier',     name: 'Carrier',     size: 5, layer: 'sea' },
    { id: 'battleship',  name: 'Battleship',  size: 4, layer: 'sea' },
    { id: 'submarine',   name: 'Submarine',   size: 3, layer: 'sea' },
    { id: 'destroyer',   name: 'Destroyer',   size: 3, layer: 'sea' },
    { id: 'patrol',      name: 'Patrol Boat', size: 2, layer: 'sea' },
  ];

  const PLANES = [
    // Planes have shapes. Coordinates are relative (dx,dy).
    { id: 'fighter', name: 'Fighter Jet', layer:'air', shape: [[0,0],[1,0],[0,1]] }, // L-ish
    { id: 'bomber',  name: 'Bomber',      layer:'air', shape: [[0,0],[1,0],[2,0],[3,0]] }, // line 4
    { id: 'recon',   name: 'Recon Plane', layer:'air', shape: [[0,0],[1,0]] }, // line 2
  ];

  // --- Helpers -----------------------------------------------------------
  const el = (id) => document.getElementById(id);

  function animateTargetCell(idx, kind){
    const grid = el('gridTarget');
    const cell = grid?.children?.[idx];
    if(!cell) return;

    // Base strike pulse
    cell.classList.remove('anim-strike','anim-hit','anim-miss','anim-fog');
    // force reflow so the animation can replay
    void cell.offsetWidth;

    cell.classList.add('anim-strike');
    if(kind === 'hit') cell.classList.add('anim-hit');
    if(kind === 'miss'){
      cell.classList.add('anim-miss');
      // fog appears on miss; animate the fog overlay too
      cell.classList.add('anim-fog');
    }

    window.setTimeout(() => {
      cell.classList.remove('anim-strike','anim-hit','anim-miss','anim-fog');
    }, 800);
  }


  function coordToIndex(x, y){ return y * SIZE + x; }
  function indexToCoord(i){ return { x: i % SIZE, y: Math.floor(i / SIZE) }; }
  function inBounds(x, y){ return x >= 0 && y >= 0 && x < SIZE && y < SIZE; }
  function colLabel(x){ return String.fromCharCode('A'.charCodeAt(0) + x); }
  function formatCell(x,y){ return `${colLabel(x)}${y+1}`; }

  function deepCopy(obj){ return JSON.parse(JSON.stringify(obj)); }

  function nowStamp(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  // --- Game State --------------------------------------------------------
  function emptyLayer(){
    return {
      occ: Array(SIZE*SIZE).fill(null), // unitId or null
      hits: Array(SIZE*SIZE).fill(false),
      misses: Array(SIZE*SIZE).fill(false),
      fog: Array(SIZE*SIZE).fill(false),
    };
  }

  function newPlayerState(name){
    return {
      name,
      locked: false,
      sea: emptyLayer(),
      air: emptyLayer(),
      units: {
        // unitId -> { placed: bool, cells: [idx], disabledTurns: 0 }
      }
    };
  }

  function initialUnitsMap(){
    const m = {};
    for(const s of SHIPS){
      m[s.id] = { placed:false, cells:[], disabledTurns: 0, kind:'ship', name:s.name, size:s.size, layer:s.layer };
    }
    for(const p of PLANES){
      m[p.id] = { placed:false, cells:[], disabledTurns: 0, kind:'plane', name:p.name, size:p.shape.length, layer:p.layer, shape:p.shape };
    }
    return m;
  }

  const state = {
    phase: 'setup',      // setup | battle | gameover
    activePlayer: 0,     // 0 or 1
    setupPlayer: 0,      // player currently placing
    setupLayer: 'sea',   // sea | air
    setupOrientation: 'H', // H | V (ships only)
    selectedUnitId: SHIPS[0].id,
    battleLayer: 'sea',  // sea | air
    battleAction: 'strike', // strike | recon
    airQuestionUsed: false,
    players: [
      newPlayerState('Player 1'),
      newPlayerState('Player 2')
    ],
    log: [],
  };

  state.players[0].units = initialUnitsMap();
  state.players[1].units = initialUnitsMap();

  // --- UI Construction ---------------------------------------------------
  function buildGrid(container, onCellClick){
    container.innerHTML = '';
    for(let i=0;i<SIZE*SIZE;i++){
      const b = document.createElement('button');
      b.className = 'cell';
      b.type = 'button';
      b.dataset.idx = String(i);
      b.addEventListener('click', () => onCellClick(i));
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.textContent = '';
      b.appendChild(dot);
      container.appendChild(b);
    }
  }

  // --- Logging -----------------------------------------------------------
  function pushLog(text, cls='entry'){
    state.log.unshift({ t: nowStamp(), text, cls });
    if(state.log.length > 80) state.log.pop();
    renderLog();
  }

  function renderLog(){
    const wrap = el('log');
    wrap.innerHTML = '';
    for(const item of state.log){
      const div = document.createElement('div');
      div.className = `entry ${item.cls}`;
      div.textContent = `${item.t} — ${item.text}`;
      wrap.appendChild(div);
    }
  }

  // --- Setup Placement ---------------------------------------------------
  function setSetupLayer(layer){
    state.setupLayer = layer;
    el('btnLayerSea').classList.toggle('ghost', layer !== 'sea');
    el('btnLayerAir').classList.toggle('ghost', layer !== 'air');
    el('setupLayer').textContent = layer === 'sea' ? 'Sea' : 'Air';
    // Auto-select a unit of that layer not yet placed
    const p = state.players[state.setupPlayer];
    const candidates = Object.entries(p.units).filter(([id,u]) => u.layer === layer && !u.placed);
    if(candidates.length){
      state.selectedUnitId = candidates[0][0];
    }
    renderUnitsList();
    renderSetupBoards();
  }

  function rotateSetup(){
    state.setupOrientation = (state.setupOrientation === 'H') ? 'V' : 'H';
    el('setupOrientation').textContent = state.setupOrientation === 'H' ? 'Horizontal' : 'Vertical';
  }

  function clearPlacementForPlayer(pi){
    const p = state.players[pi];
    p.sea = emptyLayer();
    p.air = emptyLayer();
    p.units = initialUnitsMap();
  }

  function isPlacementComplete(pi){
    const p = state.players[pi];
    return Object.values(p.units).every(u => u.placed);
  }

  function canPlaceCells(layerObj, cells){
    for(const idx of cells){
      if(idx < 0 || idx >= SIZE*SIZE) return false;
      if(layerObj.occ[idx]) return false;
    }
    return true;
  }

  function placeUnit(pi, unitId, cells){
    const p = state.players[pi];
    const unit = p.units[unitId];
    const layerObj = unit.layer === 'sea' ? p.sea : p.air;

    // clear previous placement if exists
    if(unit.placed){
      for(const idx of unit.cells){
        if(layerObj.occ[idx] === unitId) layerObj.occ[idx] = null;
      }
    }

    // place
    for(const idx of cells){
      layerObj.occ[idx] = unitId;
    }
    unit.placed = true;
    unit.cells = cells.slice();
    unit.disabledTurns = 0;
  }

  function computeShipCells(x,y,size,orientation){
    const cells = [];
    for(let k=0;k<size;k++){
      const nx = x + (orientation === 'H' ? k : 0);
      const ny = y + (orientation === 'V' ? k : 0);
      if(!inBounds(nx,ny)) return null;
      cells.push(coordToIndex(nx,ny));
    }
    return cells;
  }

  // Shapes can be rotated (0,90,180,270). We'll use 0 or 90 for simplicity.
  function computeShapeCells(x,y,shape,rot90){
    const cells = [];
    for(const [dx,dy] of shape){
      const rx = rot90 ? dy : dx;
      const ry = rot90 ? -dx : dy;
      const nx = x + rx;
      const ny = y + ry;
      if(!inBounds(nx,ny)) return null;
      cells.push(coordToIndex(nx,ny));
    }
    // normalize? not needed, we anchor at click
    return cells;
  }

  function tryPlaceAt(pi, layer, idx){
    const p = state.players[pi];
    const unit = p.units[state.selectedUnitId];
    if(unit.layer !== layer) return;

    const { x, y } = indexToCoord(idx);
    const layerObj = layer === 'sea' ? p.sea : p.air;

    let cells = null;

    if(unit.kind === 'ship'){
      cells = computeShipCells(x,y,unit.size,state.setupOrientation);
    }else{
      // plane: rotate with setupOrientation toggles between 0° and 90°
      const rot90 = (state.setupOrientation === 'V');
      cells = computeShapeCells(x,y,unit.shape,rot90);
    }

    if(!cells) { pushLog('Placement out of bounds.', 'bad'); return; }

    // If unit already placed, temporarily clear its own cells to allow re-place
    const cleared = [];
    if(unit.placed){
      for(const c of unit.cells){
        if(layerObj.occ[c] === unit.id){
          layerObj.occ[c] = null;
          cleared.push(c);
        }
      }
    }

    const ok = canPlaceCells(layerObj, cells);
    if(!ok){
      // restore
      for(const c of cleared) layerObj.occ[c] = unit.id;
      pushLog('Cannot place there (overlap).', 'bad');
      return;
    }

    placeUnit(pi, unit.id, cells);
    // auto-advance to next unplaced unit on same layer
    const next = Object.entries(p.units).find(([id,u]) => u.layer === layer && !u.placed);
    if(next) state.selectedUnitId = next[0];

    renderUnitsList();
    renderSetupBoards();
  }

  function randomPlaceForPlayer(pi){
    clearPlacementForPlayer(pi);
    const p = state.players[pi];

    // ships
    for(const s of SHIPS){
      const layerObj = p.sea;
      let placed = false;
      for(let tries=0; tries<800 && !placed; tries++){
        const orientation = Math.random() < 0.5 ? 'H' : 'V';
        const x = Math.floor(Math.random()*SIZE);
        const y = Math.floor(Math.random()*SIZE);
        const cells = computeShipCells(x,y,s.size,orientation);
        if(!cells) continue;
        if(canPlaceCells(layerObj, cells)){
          placeUnit(pi, s.id, cells);
          placed = true;
        }
      }
      if(!placed) throw new Error('Failed to place ship: ' + s.id);
    }

    // planes
    for(const plane of PLANES){
      const layerObj = p.air;
      let placed = false;
      for(let tries=0; tries<800 && !placed; tries++){
        const rot90 = Math.random() < 0.5;
        const x = Math.floor(Math.random()*SIZE);
        const y = Math.floor(Math.random()*SIZE);
        const cells = computeShapeCells(x,y,plane.shape,rot90);
        if(!cells) continue;
        if(canPlaceCells(layerObj, cells)){
          placeUnit(pi, plane.id, cells);
          placed = true;
        }
      }
      if(!placed) throw new Error('Failed to place plane: ' + plane.id);
    }

    renderUnitsList();
    renderSetupBoards();
  }

  // --- Battle Mechanics --------------------------------------------------
  function activePI(){ return state.activePlayer; }
  function otherPI(){ return state.activePlayer === 0 ? 1 : 0; }

  function remainingShipCount(pi){
    const p = state.players[pi];
    const ships = SHIPS.map(s => p.units[s.id]);
    let remaining = 0;
    for(const u of ships){
      if(!u.placed) continue;
      const layer = p.sea;
      const sunk = u.cells.every(idx => layer.hits[idx]);
      if(!sunk) remaining++;
    }
    return remaining;
  }

  function activePlaneCount(pi){
    const p = state.players[pi];
    const planes = PLANES.map(pl => p.units[pl.id]);
    let active = 0;
    for(const u of planes){
      if(!u.placed) continue;
      if(u.disabledTurns <= 0) active++;
    }
    return active;
  }

  function endTurn(){
    // decrement disabled timers for the player who just finished their turn
    // (timers tick down on owner's turns)
    const p = state.players[state.activePlayer];
    for(const plane of PLANES){
      const u = p.units[plane.id];
      if(u.disabledTurns > 0){
        u.disabledTurns -= 1;
        if(u.disabledTurns === 0){
          // "returns": restore the plane by clearing its hits (simple model)
          for(const idx of u.cells){
            p.air.hits[idx] = false;
          }
          pushLog(`${p.name}'s ${u.name} returns to the skies.`, 'info');
        }
      }
    }

    state.activePlayer = otherPI();
    state.battleAction = 'strike';
    state.airQuestionUsed = false;
    el('airQuestionAnswer').textContent = '';
    el('airQuestionSelect').value = 'none';
    el('airQuestionValue').value = '';
    renderAll();
    showPassOverlay();
  }

  function strike(layer, idx){
    const attacker = state.players[activePI()];
    const defender = state.players[otherPI()];
    const defLayer = layer === 'sea' ? defender.sea : defender.air;

    // Disallow repeat strikes
    if(defLayer.hits[idx] || defLayer.misses[idx]){
      pushLog(`Already targeted ${layer.toUpperCase()} ${cellName(idx)}.`, 'bad');
      return;
    }

    const occ = defLayer.occ[idx];

    if(occ){
      defLayer.hits[idx] = true;
      // On hit, no fog is created.
      const unit = defender.units[occ];
      pushLog(`${attacker.name} STRIKE ${layer.toUpperCase()} ${cellName(idx)} → HIT (${unit.kind.toUpperCase()}).`, 'good');
      animateTargetCell(idx, 'hit');

      // If it's a plane, check disable
      if(unit.kind === 'plane'){
        const allHit = unit.cells.every(c => defender.air.hits[c]);
        if(allHit && unit.disabledTurns <= 0){
          unit.disabledTurns = 2;
          pushLog(`${defender.name}'s ${unit.name} is DISABLED for 2 turns.`, 'info');
        }
      }

      // Check win (ships only)
      if(remainingShipCount(otherPI()) === 0){
        state.phase = 'gameover';
        el('pillPhase').textContent = 'Game Over';
        showModal('Game Over', `${attacker.name} wins! All ships have been sunk.`);
      }

    } else {
      defLayer.misses[idx] = true;
      defLayer.fog[idx] = true; // miss generates fog
      pushLog(`${attacker.name} STRIKE ${layer.toUpperCase()} ${cellName(idx)} → MISS (Fog placed).`, 'bad');
      animateTargetCell(idx, 'miss');
    }
  }

  function recon(layer, centerIdx){
    const attacker = state.players[activePI()];
    const defender = state.players[otherPI()];
    const defLayer = layer === 'sea' ? defender.sea : defender.air;
    const { x:cx, y:cy } = indexToCoord(centerIdx);

    let countOcc = 0;
    let clearedFog = 0;

    for(let dy=-1; dy<=1; dy++){
      for(let dx=-1; dx<=1; dx++){
        const x = cx + dx;
        const y = cy + dy;
        if(!inBounds(x,y)) continue;
        const idx = coordToIndex(x,y);
        if(defLayer.fog[idx]){
          defLayer.fog[idx] = false;
          clearedFog++;
        }
        if(defLayer.occ[idx]) countOcc++;
      }
    }

    pushLog(`${attacker.name} RECON ${layer.toUpperCase()} around ${cellName(centerIdx)} → ${countOcc} occupied, cleared ${clearedFog} fog.`, 'info');
    animateTargetCell(centerIdx, 'recon');
    showModal('Recon Result', `${layer.toUpperCase()} 3×3 scan centered at ${cellName(centerIdx)}\n\nOccupied spaces in area: ${countOcc}\nFog cleared in area: ${clearedFog}`);
  }

  // --- Air Superiority Q -------------------------------------------------
  function cellName(idx){
    const {x,y}=indexToCoord(idx);
    return formatCell(x,y);
  }

  function hasAirSuperiority(){
    return activePlaneCount(activePI()) > activePlaneCount(otherPI());
  }

  function answerAirQuestion(type, valueRaw){
    const defender = state.players[otherPI()];
    const layer = state.battleLayer; // question references current battle layer for occ_* types
    const defLayer = layer === 'sea' ? defender.sea : defender.air;

    const v = valueRaw.trim().toUpperCase();
    if(!v) return { ok:false, msg:'Enter a row number (1-10) or a column letter (A-J).' };

    const col = (ch) => {
      const code = ch.charCodeAt(0) - 'A'.charCodeAt(0);
      return (code>=0 && code<SIZE) ? code : null;
    };

    const row = (s) => {
      const n = Number(s);
      if(!Number.isFinite(n)) return null;
      const r = n - 1;
      return (r>=0 && r<SIZE) ? r : null;
    };

    let yes = false;

    if(type === 'ship_col'){
      const c = col(v[0]);
      if(c==null) return { ok:false, msg:'Use a column letter A–J.' };
      for(let y=0;y<SIZE;y++){
        const idx = coordToIndex(c,y);
        const occ = defender.sea.occ[idx];
        if(occ && defender.units[occ].kind === 'ship'){ yes = true; break; }
      }
      return { ok:true, answer: yes ? 'YES' : 'NO', detail: `Any SHIP in column ${v[0]}?` };
    }

    if(type === 'ship_row'){
      const r = row(v);
      if(r==null) return { ok:false, msg:'Use a row number 1–10.' };
      for(let x=0;x<SIZE;x++){
        const idx = coordToIndex(x,r);
        const occ = defender.sea.occ[idx];
        if(occ && defender.units[occ].kind === 'ship'){ yes = true; break; }
      }
      return { ok:true, answer: yes ? 'YES' : 'NO', detail: `Any SHIP in row ${v}?` };
    }

    if(type === 'occ_col'){
      const c = col(v[0]);
      if(c==null) return { ok:false, msg:'Use a column letter A–J.' };
      for(let y=0;y<SIZE;y++){
        const idx = coordToIndex(c,y);
        if(defLayer.occ[idx]){ yes = true; break; }
      }
      return { ok:true, answer: yes ? 'YES' : 'NO', detail: `Any occupied space in column ${v[0]} (${layer.toUpperCase()})?` };
    }

    if(type === 'occ_row'){
      const r = row(v);
      if(r==null) return { ok:false, msg:'Use a row number 1–10.' };
      for(let x=0;x<SIZE;x++){
        const idx = coordToIndex(x,r);
        if(defLayer.occ[idx]){ yes = true; break; }
      }
      return { ok:true, answer: yes ? 'YES' : 'NO', detail: `Any occupied space in row ${v} (${layer.toUpperCase()})?` };
    }

    return { ok:false, msg:'Choose a question type.' };
  }

  // --- Rendering ---------------------------------------------------------
  function renderUnitsList(){
    const p = state.players[state.setupPlayer];
    const list = el('unitsList');
    list.innerHTML = '';

    const groups = [
      { title: 'Ships (Sea)', ids: SHIPS.map(s=>s.id) },
      { title: 'Planes (Air)', ids: PLANES.map(p=>p.id) },
    ];

    for(const g of groups){
      const header = document.createElement('div');
      header.className = 'mini';
      header.style.margin = '8px 2px 2px 2px';
      header.textContent = g.title;
      list.appendChild(header);

      for(const id of g.ids){
        const u = p.units[id];
        const div = document.createElement('div');
        div.className = 'unit';
        if(id === state.selectedUnitId) div.classList.add('active');
        if(u.placed) div.classList.add('done');
        div.innerHTML = `
          <span>${u.name} <span class="badge">(${u.kind === 'ship' ? u.size : u.size} )</span></span>
          <span class="badge">${u.placed ? '✓ placed' : 'click to select'}</span>
        `;
        div.addEventListener('click', () => {
          state.selectedUnitId = id;
          state.setupLayer = u.layer;
          el('setupLayer').textContent = state.setupLayer === 'sea' ? 'Sea' : 'Air';
          el('btnLayerSea').classList.toggle('ghost', state.setupLayer !== 'sea');
          el('btnLayerAir').classList.toggle('ghost', state.setupLayer !== 'air');
          renderUnitsList();
          renderSetupBoards();
          updateSetupMeta();
        });
        list.appendChild(div);
      }
    }

    updateSetupMeta();
  }

  function updateSetupMeta(){
    const p = state.players[state.setupPlayer];
    el('setupPlayerName').textContent = p.name;
    const u = p.units[state.selectedUnitId];
    el('setupUnit').textContent = `${u.name} (${u.kind === 'ship' ? u.size : u.size})`;
    el('setupOrientation').textContent = state.setupOrientation === 'H' ? 'Horizontal' : 'Vertical';
    el('setupLayer').textContent = state.setupLayer === 'sea' ? 'Sea' : 'Air';
  }

  function paintSetupGrid(container, pi, layer){
    const p = state.players[pi];
    const layerObj = layer === 'sea' ? p.sea : p.air;
    const u = p.units[state.selectedUnitId];
    const selectedCells = (u && u.layer === layer && u.placed) ? new Set(u.cells) : new Set();

    [...container.children].forEach((cell, idx) => {
      cell.className = 'cell';
      const dot = cell.querySelector('.dot');
      dot.textContent = '';

      if(layerObj.occ[idx]){
        const occId = layerObj.occ[idx];
        const occUnit = p.units[occId];
        if(occUnit.kind === 'ship') cell.classList.add('own-ship');
        if(occUnit.kind === 'plane') cell.classList.add('own-plane');
      }

      // highlight selected unit cells
      if(selectedCells.has(idx)){
        cell.style.outline = '2px solid rgba(122,162,255,.65)';
        cell.style.outlineOffset = '0px';
      }else{
        cell.style.outline = 'none';
      }
    });
  }

  function renderSetupBoards(){
    const pi = state.setupPlayer;
    paintSetupGrid(el('gridSeaSetup'), pi, 'sea');
    paintSetupGrid(el('gridAirSetup'), pi, 'air');

    // occupancy counters
    const p = state.players[pi];
    const seaOcc = p.sea.occ.filter(Boolean).length;
    const airOcc = p.air.occ.filter(Boolean).length;
    el('seaStatus').textContent = `${seaOcc}/17 occupied`;
    el('airStatus').textContent = `${airOcc} occupied`;

    // lock button state
    const complete = isPlacementComplete(pi);
    el('btnLockIn').disabled = !complete;
    el('btnLockIn').classList.toggle('primary', complete);
  }

  function renderBattleBoards(){
    const attacker = state.players[activePI()];
    const defender = state.players[otherPI()];

    // target grid shows defender's layer with hits/misses and fog
    const defLayer = state.battleLayer === 'sea' ? defender.sea : defender.air;
    const target = el('gridTarget');

    [...target.children].forEach((cell, idx) => {
      cell.className = 'cell';
      cell.classList.toggle('locked', state.phase !== 'battle');

      const dot = cell.querySelector('.dot');
      dot.textContent = '';

      if(defLayer.hits[idx]){
        cell.classList.add('hit');
        dot.textContent = '✹';
      }else if(defLayer.misses[idx]){
        cell.classList.add('miss');
        dot.textContent = '•';
      }

      if(defLayer.fog[idx]){
        cell.classList.add('fog');
        if(!defLayer.hits[idx] && !defLayer.misses[idx]) dot.textContent = '≈';
      }

      // disable clicking if game over
      cell.classList.toggle('disabled', state.phase !== 'battle');
    });

    // own reference grids show own occupancy + hits received
    const ownSea = el('gridOwnSea');
    const ownAir = el('gridOwnAir');

    paintOwnReference(ownSea, attacker, 'sea');
    paintOwnReference(ownAir, attacker, 'air');

    // headers
    el('battleActivePlayer').textContent = attacker.name;
    el('battleAction').textContent = state.battleAction === 'strike' ? 'Strike' : 'Recon';
    el('battleActionHint').textContent = state.battleAction === 'strike'
      ? '• Click a cell to fire.'
      : '• Click a center cell to scan 3×3.';
    el('targetInfo').textContent = `${defender.name}'s ${state.battleLayer.toUpperCase()} grid`;

    // air superiority
    const sup = hasAirSuperiority();
    const aCount = activePlaneCount(activePI());
    const dCount = activePlaneCount(otherPI());
    el('airSupStatus').textContent = sup
      ? `YES (${aCount} vs ${dCount})`
      : `NO (${aCount} vs ${dCount})`;

    const airArea = el('airQuestionArea');
    airArea.classList.toggle('enabled', sup);
    if(!sup){
      state.airQuestionUsed = true; // effectively none available
      el('airQuestionAnswer').textContent = '';
    }else{
      // show availability
      if(state.airQuestionUsed){
        el('airQuestionAnswer').textContent = 'Question already used this turn.';
      }else{
        // keep as-is
      }
    }

    // scoreboard
    el('p1ShipsRemaining').textContent = String(remainingShipCount(0));
    el('p2ShipsRemaining').textContent = String(remainingShipCount(1));
    el('p1PlanesActive').textContent = String(activePlaneCount(0));
    el('p2PlanesActive').textContent = String(activePlaneCount(1));

    // action buttons
    el('btnActionStrike').classList.toggle('primary', state.battleAction === 'strike');
    el('btnActionRecon').classList.toggle('primary', state.battleAction === 'recon');

    el('btnBattleSea').classList.toggle('ghost', state.battleLayer !== 'sea');
    el('btnBattleAir').classList.toggle('ghost', state.battleLayer !== 'air');
  }

  function paintOwnReference(container, player, layer){
    const layerObj = layer === 'sea' ? player.sea : player.air;
    [...container.children].forEach((cell, idx) => {
      cell.className = 'cell locked';
      const dot = cell.querySelector('.dot');
      dot.textContent = '';

      if(layerObj.occ[idx]){
        const id = layerObj.occ[idx];
        const u = player.units[id];
        if(u.kind === 'ship') cell.classList.add('own-ship');
        if(u.kind === 'plane') cell.classList.add('own-plane');
      }

      if(layerObj.hits[idx]){
        cell.classList.add('hit'); dot.textContent='✹';
      }else if(layerObj.misses[idx]){
        cell.classList.add('miss'); dot.textContent='•';
      }

      if(layerObj.fog[idx]){
        cell.classList.add('fog');
        if(!layerObj.hits[idx] && !layerObj.misses[idx]) dot.textContent='≈';
      }
    });
  }

  function renderPhase(){
    el('pillVersion').textContent = `v${VERSION}`;
    el('pillPhase').textContent = state.phase === 'setup' ? 'Setup' : (state.phase === 'battle' ? 'Battle' : 'Game Over');

    const leftTitle = el('leftTitle');
    if(state.phase === 'setup'){
      leftTitle.textContent = `${state.players[state.setupPlayer].name} — Setup`;
    }else if(state.phase === 'battle'){
      leftTitle.textContent = `Battle — ${state.players[activePI()].name}'s turn`;
    }else{
      leftTitle.textContent = `Game Over`;
    }

    // tab visibility logic
    const setupTab = document.querySelector('.tab[data-tab="setup"]');
    const battleTab = document.querySelector('.tab[data-tab="battle"]');

    if(state.phase === 'setup'){
      setupTab.classList.add('active');
      battleTab.classList.remove('active');
      el('panelSetup').classList.add('active');
      el('panelBattle').classList.remove('active');
    }else{
      setupTab.classList.remove('active');
      battleTab.classList.add('active');
      el('panelSetup').classList.remove('active');
      el('panelBattle').classList.add('active');
    }
  }

  function renderStatus(){
    const s = el('statusText');
    if(state.phase === 'setup'){
      const p = state.players[state.setupPlayer];
      const missing = Object.values(p.units).filter(u => !u.placed);
      if(missing.length){
        s.textContent = `${p.name}: place ${missing.length} more unit(s).`;
      }else{
        s.textContent = `${p.name}: all units placed. Tap “Lock In & Pass”.`;
      }
    }else if(state.phase === 'battle'){
      const a = state.players[activePI()];
      const d = state.players[otherPI()];
      s.textContent = `${a.name}, choose an action and target ${d.name}'s ${state.battleLayer.toUpperCase()} grid.`;
    }else{
      s.textContent = `Game over. Start a new game to play again.`;
    }
  }

  function renderAll(){
    renderPhase();
    renderStatus();

    if(state.phase === 'setup'){
      renderUnitsList();
      renderSetupBoards();
    }else{
      renderBattleBoards();
    }
  }

  // --- Overlays ----------------------------------------------------------
  function showPassOverlay(){
    const o = el('overlayPass');
    el('overlayTitle').textContent = 'Pass the device';
    el('overlayText').textContent = `Hand the device to ${state.players[state.activePlayer].name}. Then tap “I’m ready”.`;
    o.classList.remove('hidden');
  }

  function hidePassOverlay(){ el('overlayPass').classList.add('hidden'); }

  function showModal(title, body){
    el('modalTitle').textContent = title;
    el('modalBody').textContent = body;
    el('overlayModal').classList.remove('hidden');
  }
  function hideModal(){ el('overlayModal').classList.add('hidden'); }

  // --- Event Wiring ------------------------------------------------------
  function wireTabs(){
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if(tab === 'setup' && state.phase === 'setup'){
          document.querySelector('.tab[data-tab="setup"]').classList.add('active');
          document.querySelector('.tab[data-tab="battle"]').classList.remove('active');
          el('panelSetup').classList.add('active');
          el('panelBattle').classList.remove('active');
        }
        if(tab === 'battle' && state.phase !== 'setup'){
          document.querySelector('.tab[data-tab="setup"]').classList.remove('active');
          document.querySelector('.tab[data-tab="battle"]').classList.add('active');
          el('panelSetup').classList.remove('active');
          el('panelBattle').classList.add('active');
        }
      });
    });
  }

  function startNewGame(){
    state.phase = 'setup';
    state.activePlayer = 0;
    state.setupPlayer = 0;
    state.setupLayer = 'sea';
    state.setupOrientation = 'H';
    state.selectedUnitId = SHIPS[0].id;
    state.battleLayer = 'sea';
    state.battleAction = 'strike';
    state.airQuestionUsed = false;

    state.players = [newPlayerState('Player 1'), newPlayerState('Player 2')];
    state.players[0].units = initialUnitsMap();
    state.players[1].units = initialUnitsMap();

    state.log = [];
    pushLog('New game started.', 'info');

    renderAll();
    showPassOverlay();
  }

  function lockInSetup(){
    const pi = state.setupPlayer;
    const p = state.players[pi];
    if(!isPlacementComplete(pi)){
      pushLog('You must place all units before locking in.', 'bad');
      return;
    }
    p.locked = true;

    if(pi === 0){
      state.setupPlayer = 1;
      pushLog('Player 1 locked in. Passing to Player 2 setup…', 'info');
      renderAll();
      showPassOverlay();
    }else{
      // both done → battle
      state.phase = 'battle';
      state.activePlayer = 0;
      pushLog('Player 2 locked in. Battle begins!', 'info');
      renderAll();
      showPassOverlay();
    }
  }

  function setupKeyShortcuts(e){
    if(e.key === 'r' || e.key === 'R'){
      rotateSetup();
      renderAll();
    }
    if(e.key === '1'){
      setSetupLayer('sea');
    }
    if(e.key === '2'){
      setSetupLayer('air');
    }
    if(e.key === 'Escape'){
      hideModal();
      hidePassOverlay();
    }
  }

  // Click handlers for grids
  function onSetupSeaClick(idx){
    if(state.phase !== 'setup') return;
    if(state.setupLayer !== 'sea') state.setupLayer = 'sea';
    tryPlaceAt(state.setupPlayer, 'sea', idx);
  }
  function onSetupAirClick(idx){
    if(state.phase !== 'setup') return;
    if(state.setupLayer !== 'air') state.setupLayer = 'air';
    tryPlaceAt(state.setupPlayer, 'air', idx);
  }

  function onTargetClick(idx){
    if(state.phase !== 'battle') return;

    if(state.battleAction === 'strike'){
      strike(state.battleLayer, idx);
    }else{
      recon(state.battleLayer, idx);
    }

    renderAll();
  }

  function askAirQuestion(){
    if(state.phase !== 'battle') return;
    if(!hasAirSuperiority()){
      showModal('Air Superiority', 'You do not have air superiority this turn.');
      return;
    }
    if(state.airQuestionUsed){
      showModal('Air Superiority', 'You already used your question this turn.');
      return;
    }
    const type = el('airQuestionSelect').value;
    const val = el('airQuestionValue').value;
    if(type === 'none'){
      showModal('Air Superiority', 'Choose a question type.');
      return;
    }
    const res = answerAirQuestion(type, val);
    if(!res.ok){
      showModal('Air Superiority', res.msg);
      return;
    }
    state.airQuestionUsed = true;
    el('airQuestionAnswer').textContent = `${res.detail} → ${res.answer}`;
    pushLog(`${state.players[activePI()].name} AIR Q: ${res.detail} → ${res.answer}`, 'info');
    renderBattleBoards();
  }

  // --- Build UI and wire buttons ----------------------------------------
  function init(){
    // Build grids
    buildGrid(el('gridSeaSetup'), onSetupSeaClick);
    buildGrid(el('gridAirSetup'), onSetupAirClick);
    buildGrid(el('gridTarget'), onTargetClick);
    buildGrid(el('gridOwnSea'), () => {});
    buildGrid(el('gridOwnAir'), () => {});

    wireTabs();

    // Setup buttons
    el('btnLayerSea').addEventListener('click', () => setSetupLayer('sea'));
    el('btnLayerAir').addEventListener('click', () => setSetupLayer('air'));
    el('btnRotate').addEventListener('click', () => { rotateSetup(); renderAll(); });
    el('btnRandomize').addEventListener('click', () => {
      randomPlaceForPlayer(state.setupPlayer);
      pushLog(`${state.players[state.setupPlayer].name} randomized placement.`, 'info');
      renderAll();
    });
    el('btnClearPlacement').addEventListener('click', () => {
      clearPlacementForPlayer(state.setupPlayer);
      pushLog(`${state.players[state.setupPlayer].name} cleared placement.`, 'bad');
      renderAll();
    });
    el('btnLockIn').addEventListener('click', lockInSetup);

    // Battle buttons
    el('btnBattleSea').addEventListener('click', () => { state.battleLayer = 'sea'; renderAll(); });
    el('btnBattleAir').addEventListener('click', () => { state.battleLayer = 'air'; renderAll(); });
    el('btnActionStrike').addEventListener('click', () => { state.battleAction = 'strike'; renderAll(); });
    el('btnActionRecon').addEventListener('click', () => { state.battleAction = 'recon'; renderAll(); });
    el('btnEndTurn').addEventListener('click', () => {
      if(state.phase !== 'battle') return;
      endTurn();
    });

    // Air question
    el('btnAskAirQ').addEventListener('click', askAirQuestion);

    // Overlays
    el('btnOverlayCancel').addEventListener('click', hidePassOverlay);
    el('btnOverlayReady').addEventListener('click', hidePassOverlay);

    el('btnModalOk').addEventListener('click', hideModal);

    // Header actions
    el('btnNewGame').addEventListener('click', startNewGame);
    el('btnHowTo').addEventListener('click', () => {
      showModal('How to Play (v1.01)',
`1) SETUP: Each player places all ships (Sea) and planes (Air). Randomize is allowed.
2) BATTLE: Choose a layer (Sea/Air) and an action:
   • Strike: click a cell. Hit = marked. Miss = Fog token.
   • Recon: click a center cell. Clears fog in a 3×3 area and reports the number of occupied spaces in that area.
3) FOG: Fog tokens can hide untargeted cells. Recon clears them.
4) AIR SUPERIORITY: If you have more active planes than your opponent, you may ask 1 yes/no question per turn.
5) WIN: Sink all opponent ships (hit every ship space).`);
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', setupKeyShortcuts);

    // Initial log + render
    pushLog('Welcome. Player 1: place your fleet.', 'info');
    renderAll();
    showPassOverlay();
  }

  init();
})();
