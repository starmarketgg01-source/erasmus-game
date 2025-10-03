// =========================================================
// main_full_erasmus_all_in_one.js
// Erasmus — main script (complete)
// Features:
//  - Loads erasmus.tmj + tilesets (tileset_part1/2/3.png.png)
//  - Spawn at spawn_avezzano (explicit) with fallback
//  - POI interactions (E / mobile btn)
//  - VILLE zones -> city banners
//  - Collisions on specified layers, ignoring given tile indices
//  - God Mode: toggle with "D" (keyboard) and mobile button (#btn-godmode)
//      -> reliably disables ALL collisions (removes colliders + disables player checkCollision)
//      -> re-enables collisions (restores tile collisions + re-add colliders + restores checkCollision)
//  - Camera strictly centered on player (no lerp)
//  - Minimap with player arrow
//  - Dust particles when running
//  - Mobile controls (D-pad buttons expected in DOM)
//  - Debug utilities & light logging
// =========================================================

window.onload = function () {
  // ---------------------------
  // CONFIG
  // ---------------------------
  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: "game",
    physics: {
      default: "arcade",
      arcade: {
        debug: false,
        gravity: { y: 0 }
      }
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(config);

  // ---------------------------
  // GLOBALS
  // ---------------------------
  let map = null;
  let player = null;
  let cursors = null;
  let shiftKey = null;
  let interactionKey = null;
  let toggleCollisionsKey = null; // D key
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;
  let createdLayers = {}; // name -> TilemapLayer
  let layerColliders = []; // store colliders to remove/recreate
  let collisionsEnabled = true; // tracks whether collisions active
  let godModeNoticeTimeout = null;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // Which layers in Tiled are considered collidable (strings must match exactly)
  const COLLISION_LAYERS = [
    "water", "rails", "bord de map", "vegetation 1", "vegetation 2", "batiments 1", "batiments 2"
  ];

  // Tile indices to ignore as collidable (bridge/road artifacts you reported).
  // Add more indices here if you find others in logs.
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // Gameplay constants
  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // ---------------------------
  // PRELOAD
  // ---------------------------
  function preload() {
    // tilemap and tilesets
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // player sprite sheet (144x144 as you had)
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // optional audio (safe to be missing)
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // ---------------------------
  // CREATE
  // ---------------------------
  function create() {
    // create tilemap
    map = this.make.tilemap({ key: "map" });

    // add tilesets (names must match those used in Tiled)
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // create all layers and store them
    createdLayers = {};
    for (const ld of map.layers) {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, tilesets, 0, 0);
        createdLayers[name] = layer;
      } catch (err) {
        console.warn("Layer create failed:", name, err);
      }
    }

    // adjust depth if you have those lamp layers
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // ---------------------------
    // OBJECTS: spawn & POI
    // ---------------------------
    let spawnPoint = null;
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      for (const obj of poiLayer.objects) {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();

        if (name === "spawn_avezzano" || type === "spawn") {
          // prefer explicit spawn_avezzano if present
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
          continue;
        }

        // collect POI data
        const title = obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI";
        const description = obj.properties?.find(p => p.name === "text")?.value || "";
        const image = obj.properties?.find(p => p.name === "media")?.value || null;
        poiData.push({ x: obj.x, y: obj.y, title, description, image });
      }
    }

    // fallback: find any object with 'spawn' in name
    if (!spawnPoint && poiLayer && Array.isArray(poiLayer.objects)) {
      spawnPoint = poiLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }

    // final fallback: center of map
    if (!spawnPoint) spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };

    // ---------------------------
    // PLAYER
    // ---------------------------
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // reduce hitbox to avoid ghost collisions on thin bridges
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // ---------------------------
    // VILLE object layer
    // ---------------------------
    const villeLayer = map.getObjectLayer("VILLE");
    villes = [];
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      for (const obj of villeLayer.objects) {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      }
    }

    // ---------------------------
    // COLLISIONS - initial setup
    // - setCollisionByExclusion for layers in COLLISION_LAYERS
    // - clear tile collision flags for indices in IGNORE_TILE_INDICES
    // ---------------------------
    setupCollisions(this);

    // add colliders between player and tile layers
    addLayerColliders(this);

    // collider with decorative layers (if any)
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) {}
    }

    // ---------------------------
    // CAMERA - strictly centered (no lerp)
    // ---------------------------
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // ---------------------------
    // MINIMAP
    // ---------------------------
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // ---------------------------
    // INPUTS & DOM
    // ---------------------------
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    toggleCollisionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // ensure mobile spawn uses spawn_avezzano too - user reported mobile spawn at L'aquila
    // To force spawn_avezzano across devices we already prioritized spawn_avezzano above.
    // If you STILL spawn at another point, check the TMJ objects naming.

    // interaction box DOM
    interactionBox = document.getElementById("interaction-box");
    if (!interactionBox) {
      interactionBox = document.createElement("div");
      interactionBox.id = "interaction-box";
      interactionBox.style.display = "none";
      document.body.appendChild(interactionBox);
    } else {
      interactionBox.style.display = "none";
    }

    // ---------------------------
    // ANIMATIONS
    // ---------------------------
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start:0, end:2 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start:3, end:5 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start:6, end:8 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start:9, end:11 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "idle-down", frames: [{ key:"player", frame:1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key:"player", frame:4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key:"player", frame:7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key:"player", frame:10 }] });

    // ---------------------------
    // PARTICLES - dust when running
    // ---------------------------
    const g = this.make.graphics({ x:0, y:0, add:false });
    g.fillStyle(0xffffff, 1).fillCircle(4,4,4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0, y:0, speed: { min:-40, max:40 }, angle:{ min:200, max:340 },
      scale: { start: 0.27, end: 0 }, alpha: { start: 0.8, end: 0 }, lifespan: 400, on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // ---------------------------
    // MOBILE CONTROL BINDINGS
    // Expecting D-pad and mobile buttons in DOM:
    //  #btn-up, #btn-down, #btn-left, #btn-right, #btn-run, #btn-interact, #btn-godmode
    // ---------------------------
    bindMobileControls();

    // Hook mobile god-mode button
    const btnGod = document.getElementById("btn-godmode");
    if (btnGod) {
      btnGod.addEventListener("touchstart", (e)=>{ e.preventDefault(); toggleGodModeMobile(); }, { passive:false });
      btnGod.addEventListener("mousedown", (e)=>{ e.preventDefault(); toggleGodModeMobile(); });
    }

    // Intro button if present
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }
  } // end create()

  // ---------------------------
  // UPDATE
  // ---------------------------
  function update() {
    if (!player) return;

    // Toggle God Mode / collisions with D key
    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      collisionsEnabled = !collisionsEnabled;
      if (!collisionsEnabled) {
        // disable collisions: remove colliders + player checks
        disableCollisions(getScene());
        showTempDebugNotice("God Mode ON — collisions désactivées");
      } else {
        // enable: restore tile collisions + recreate colliders
        enableCollisions(getScene());
        showTempDebugNotice("God Mode OFF — collisions réactivées");
      }
    }

    const isRunning = (shiftKey && shiftKey.isDown) || mobileInput.run;
    const speed = isRunning ? 150 : 70;
    let vx = 0, vy = 0;

    if (!isMobile) {
      if (cursors.left.isDown) vx -= speed;
      if (cursors.right.isDown) vx += speed;
      if (cursors.up.isDown) vy -= speed;
      if (cursors.down.isDown) vy += speed;
    } else {
      if (mobileInput.left) vx -= speed;
      if (mobileInput.right) vx += speed;
      if (mobileInput.up) vy -= speed;
      if (mobileInput.down) vy += speed;
    }

    player.setVelocity(vx, vy);

    // animation switching
    if (vx < 0) playAnim("left", isRunning);
    else if (vx > 0) playAnim("right", isRunning);
    else if (vy < 0) playAnim("up", isRunning);
    else if (vy > 0) playAnim("down", isRunning);
    else {
      if (player.anims.currentAnim) {
        const dir = player.anims.currentAnim.key;
        if (["up","down","left","right"].includes(dir)) player.anims.play("idle-" + dir, true);
      }
    }

    player.setDepth(player.y);
    dustEmitter.on = isRunning && (Math.abs(vx) > 1 || Math.abs(vy) > 1);

    // minimap arrow rotation + position
    if (player.anims.currentAnim) {
      const dir = player.anims.currentAnim.key;
      if (dir.includes("up")) playerMiniArrow.rotation = 0;
      else if (dir.includes("right")) playerMiniArrow.rotation = Phaser.Math.DegToRad(90);
      else if (dir.includes("down")) playerMiniArrow.rotation = Phaser.Math.DegToRad(180);
      else if (dir.includes("left")) playerMiniArrow.rotation = Phaser.Math.DegToRad(-90);
    }
    if (minimapCam && playerMiniArrow) {
      playerMiniArrow.x = minimapCam.worldView.x + player.x * minimapCam.zoom;
      playerMiniArrow.y = minimapCam.worldView.y + player.y * minimapCam.zoom;
    }

    // POI detection
    currentPOI = null;
    for (const poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < POI_RADIUS) { currentPOI = poi; if (!isMobile) showPressE(); break; }
    }
    if (!currentPOI && !isMobile) hidePressE();
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) showInteraction(currentPOI);

    // VILLE detection -> show banner
    let inVille = null;
    for (const v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // minimal blocking debug (only logs real collidable tiles)
    debugCheckBlocking();
  }

  // ---------------------------
  // HELPERS
  // ---------------------------
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) player.anims.play(key, true);
    player.anims.timeScale = isRunning ? 2 : 1;
  }

  function showPressE() {
    if (!document.getElementById("pressE")) {
      const e = document.createElement("div");
      e.id = "pressE";
      e.innerText = "Appuie sur E";
      Object.assign(e.style, {
        position: "absolute", top: "20px", left: "50%", transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.7)", color: "#fff", padding: "6px 12px", borderRadius: "6px", zIndex: "99999"
      });
      document.body.appendChild(e);
    }
  }
  function hidePressE() { const e = document.getElementById("pressE"); if (e) e.remove(); }

  function showInteraction(poi) {
    let imgPath = poi.image;
    if (imgPath && !imgPath.startsWith("images/")) imgPath = "images/" + imgPath;
    try { document.getElementById("sfx-open")?.play(); } catch(_) {}
    interactionBox.innerHTML = `
      <div class="interaction-content">
        <button id="closeBox">✖</button>
        <h2>${escapeHtml(poi.title)}</h2>
        <p>${escapeHtml(poi.description)}</p>
        ${imgPath?`<img src="${escapeAttr(imgPath)}" alt="${escapeHtml(poi.title)}">`:""}
      </div>
    `;
    interactionBox.style.display = "flex";
    const closeBtn = document.getElementById("closeBox");
    if (closeBtn) closeBtn.onclick = () => {
      interactionBox.style.display = "none";
      try { document.getElementById("sfx-close")?.play(); } catch(_) {}
    };
  }

  function showCityBanner(name) {
    let banner = document.getElementById("city-banner");
    if (!banner) { banner = document.createElement("div"); banner.id = "city-banner"; document.body.appendChild(banner); }
    let overlay = document.getElementById("fade-overlay");
    if (!overlay) { overlay = document.createElement("div"); overlay.id = "fade-overlay"; document.body.appendChild(overlay); }
    overlay.classList.add("active");
    setTimeout(() => {
      banner.innerText = name;
      banner.classList.add("show");
      overlay.classList.remove("active");
      setTimeout(() => banner.classList.remove("show"), 4000);
    }, 420);
  }

  // ---------------------------
  // COLLISIONS MANAGEMENT
  // ---------------------------
  function setupCollisions(scene) {
    // Mark collidable tiles for layers in COLLISION_LAYERS while clearing IGNORE indices
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // Set all non-empty tiles colliding
          layer.setCollisionByExclusion([-1]);
          // Try to clear specific problematic indices
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e) {}
          // Also ensure individual tile flags cleared for those indices
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch(e) {}
            }
          });
        } catch (err) {
          console.warn("setupCollisions: error on layer", name, err);
        }
      }
    }
  }

  function addLayerColliders(scene) {
    // Remove any stored colliders first
    for (const col of layerColliders) {
      try { scene.physics.world.removeCollider(col); } catch(e) {}
    }
    layerColliders = [];
    // Add new colliders and save them
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch (err) {
          // ignore errors
        }
      }
    }
    // Also ensure player's body collision checks are enabled (if enabling)
    if (player && player.body) player.body.checkCollision.none = false;
  }

  function removeLayerColliders(scene) {
    for (const col of layerColliders) {
      try { scene.physics.world.removeCollider(col); } catch(e) {}
    }
    layerColliders = [];
  }

  function disableCollisions(scene) {
    // Remove colliders between player and layers
    removeLayerColliders(scene);

    // Clear tile collision flags for the collision layers so tile collisions don't run
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // In some Phaser versions setCollisionByExclusion accepts a second arg 'collides' - here we use per-tile clearing
          layer.forEachTile(tile => {
            if (tile) {
              try { tile.setCollision(false, false, false, false); } catch(e) {}
            }
          });
        } catch (err) { /* ignore */ }
      }
    }

    // Additionally, disable player's body collision checks to pass through bodies
    if (player && player.body) {
      player.body.checkCollision.none = true;
    }
  }

  function enableCollisions(scene) {
    // re-establish tile collision flags
    setupCollisions(scene);
    // re-add colliders between player and layers
    addLayerColliders(scene);
    // re-enable player's body collision checks
    if (player && player.body) player.body.checkCollision.none = false;
  }

  // Toggle function used by mobile button
  function toggleGodModeMobile() {
    collisionsEnabled = !collisionsEnabled;
    if (!collisionsEnabled) {
      disableCollisions(getScene());
      showTempDebugNotice("God Mode ON (mobile)");
    } else {
      enableCollisions(getScene());
      showTempDebugNotice("God Mode OFF (mobile)");
    }
  }

  // ---------------------------
  // DEBUG - check blocking tiles and log only real colliders
  // ---------------------------
  function debugCheckBlocking() {
    if (!player || !player.body) return;
    const b = player.body;
    if (!(b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down)) return;

    const checks = [
      { dir:"left", dx:-16, dy:0 },
      { dir:"right", dx:16, dy:0 },
      { dir:"up", dx:0, dy:-16 },
      { dir:"down", dx:0, dy:16 }
    ];

    for (const c of checks) {
      if (!b.blocked[c.dir]) continue;
      const wx = Math.round(player.x + c.dx);
      const wy = Math.round(player.y + c.dy);
      let realBlocking = [];
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        if (!tLayer) continue;
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            console.log(`  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
          } else if (tileCollides) {
            realBlocking.push({ layerName, tile });
          }
        } catch (err) {
          // ignore
        }
      }

      if (realBlocking.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${wx}, ${wy})`);
        for (const rb of realBlocking) {
          const t = rb.tile;
          console.log(`    → blocking on layer "${rb.layerName}" tile index=${t.index} at (${t.x},${t.y})`, t.properties || {});
        }
      } else {
        // no real blocking tile found -> probably a physics edgecase or world bounds
        console.log(`(debug) faux blocage détecté ${c.dir} à (${wx}, ${wy}) — aucune tuile 'collides' trouvée.`);
      }
    }
  }

  // ---------------------------
  // MOBILE CONTROLS BINDINGS
  // ---------------------------
  function bindMobileControls() {
    const bindButton = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => { e.preventDefault(); onDown && onDown(); };
      const end = (e) => { e.preventDefault(); onUp && onUp(); };
      el.addEventListener("touchstart", start, { passive:false });
      el.addEventListener("touchend", end, { passive:false });
      el.addEventListener("mousedown", start);
      el.addEventListener("mouseup", end);
      el.addEventListener("mouseleave", end);
    };

    bindButton("btn-up",    () => mobileInput.up = true,    () => mobileInput.up = false);
    bindButton("btn-down",  () => mobileInput.down = true,  () => mobileInput.down = false);
    bindButton("btn-left",  () => mobileInput.left = true,  () => mobileInput.left = false);
    bindButton("btn-right", () => mobileInput.right = true, () => mobileInput.right = false);
    bindButton("btn-run",   () => mobileInput.run = true,   () => mobileInput.run = false);

    const eBtn = document.getElementById("btn-interact");
    if (eBtn) {
      const tap = (evt) => { evt.preventDefault(); if (currentPOI) showInteraction(currentPOI); };
      eBtn.addEventListener("touchstart", tap, { passive:false });
      eBtn.addEventListener("mousedown", tap);
    }

    // godmode button handled earlier
  }

  // ---------------------------
  // Utility functions
  // ---------------------------
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function getScene() {
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  // Temporary onscreen debug notice
  function showTempDebugNotice(text, ms = 1200) {
    let el = document.getElementById("temp-debug");
    if (!el) {
      el = document.createElement("div");
      el.id = "temp-debug";
      Object.assign(el.style, {
        position: "fixed", right: "12px", top: "12px", background: "rgba(0,0,0,0.7)",
        color: "#fff", padding: "8px 12px", borderRadius: "6px", zIndex: 999999, fontFamily: "sans-serif"
      });
      document.body.appendChild(el);
    }
    el.innerText = text;
    el.style.display = "block";
    clearTimeout(godModeNoticeTimeout);
    godModeNoticeTimeout = setTimeout(()=>{ el.style.display = "none"; }, ms);
  }

  // ---------------------------
  // Minimal production debug: warn only when real collidable tile found
  // (we already have debugCheckBlocking above; keep both)
  // ---------------------------
  function debugCheckBlockingProd() {
    // Not used by default, but kept if needed
  }

  // ---------------------------
  // End window.onload
  // ---------------------------
}; // window.onload end

// =========================================================
// End of main_full_erasmus_all_in_one.js
// =========================================================
