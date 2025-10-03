// ======================================================
// main.js - Erasmus Game (complete, corrected, downloadable)
// - Loads erasmus.tmj and tilesets (tileset_part1/2/3.png.png)
// - Spawns player at spawn_avezzano (fallback if missing)
// - POI interactions (E key + mobile button)
// - City banners when entering VILLE object zones
// - Collision fixes: explicitly set per-tile collisions and ignore problematic tile indices
// - Reduced player hitbox to avoid ghost collisions on thin bridges/paths
// - Minimap, particles, mobile D-pad, and debug utilities
// - Includes functions to toggle debug and re-evaluate collisions at runtime
// - Save this file as main.js and include it in your HTML after Phaser
// ======================================================

window.onload = function () {
  // -------------------------------
  // CONFIG
  // -------------------------------
  const DEBUG = false; // met à true pour logs très verbeux
  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: "game",
    physics: {
      default: "arcade",
      arcade: { debug: false }
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(config);

  // -------------------------------
  // GLOBALS
  // -------------------------------
  let map = null;
  let player = null;
  let cursors, shiftKey, interactionKey;
  let minimapCam = null, playerMiniArrow = null, miniFrameGfx = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up: false, down: false, left: false, right: false, run: false };

  // layer refs and config
  let createdLayers = {};
  const collisionLayers = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
  ];

  // tile indices that should NOT be collidable (bridge/road artifacts)
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // detection radii
  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    // Map & tilesets (paths must match your project)
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // Player sprite
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // Optional audio (if present)
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // -------------------------------
  // CREATE
  // -------------------------------
  function create() {
    // make map
    map = this.make.tilemap({ key: "map" });

    // add tilesets - names used here must match the names used inside Tiled .tmj
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // create layers safely and store references
    createdLayers = {};
    if (Array.isArray(map.layers)) {
      map.layers.forEach(ld => {
        const name = ld.name;
        try {
          const layer = map.createLayer(name, tilesets, 0, 0);
          createdLayers[name] = layer;
          if (DEBUG) console.log("Layer created:", name);
        } catch (err) {
          console.warn("Impossible de créer layer:", name, err);
        }
      });
    } else {
      console.warn("map.layers n'est pas un tableau — vérifie ton .tmj");
    }

    // depth for lampadaire layers
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // parse object layers (POI, spawn, VILLE)
    parseObjectLayers();

    // create player (after spawnPoint resolved)
    const spawn = getSpawnPoint(map) || { x: map.widthInPixels/2, y: map.heightInPixels/2 };
    if (!getSpawnPoint(map)) console.warn("spawn_avezzano non trouvé -> fallback centre map");

    player = this.physics.add.sprite(spawn.x, spawn.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // safety: make sure body exists before resizing
    if (player.body) {
      // reduce hitbox to avoid thin-tile ghost collisions
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // process collisions with explicit per-tile setting
    setupCollisionsPerTile();

    // add colliders for layers that still have collidable tiles
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (!layer) return;
      if (collisionLayers.includes(name)) {
        try { this.physics.add.collider(player, layer); } catch (e) { if (DEBUG) console.warn("Collider add failed for", name, e); }
      }
    });
    // also collider with decorative lampadaire layer if present
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) { if (DEBUG) console.warn(e); }
    }

    // Camera & minimap
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0,0, map.widthInPixels, map.heightInPixels);

    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH).setZoom(miniZoom).startFollow(player);
    if (!isMobile) {
      miniFrameGfx = this.add.graphics();
      miniFrameGfx.fillStyle(0x000000, 0.30).fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.lineStyle(2, 0xffffff, 1).strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.setScrollFactor(0).setDepth(11000);
    }

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0, 12, 12, 12, 6, 0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // Inputs & DOM elements
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    interactionBox = document.getElementById("interaction-box");
    if (!interactionBox) {
      interactionBox = document.createElement("div");
      interactionBox.id = "interaction-box";
      interactionBox.style.display = "none";
      document.body.appendChild(interactionBox);
    } else {
      interactionBox.style.display = "none";
    }

    // Animations
    createPlayerAnimations.call(this);

    // Particles
    const g = this.make.graphics({ x:0, y:0, add: false });
    g.fillStyle(0xffffff, 1).fillCircle(4,4,4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0, y:0, speed: { min: -40, max: 40 }, angle: { min: 200, max: 340 },
      scale: { start: 0.27, end: 0 }, alpha: { start: 0.8, end: 0 }, lifespan: 400, on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // mobile controls
    bindMobileControls();

    // intro button if exists
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro"); if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }

    if (DEBUG) console.log("create done");
  } // end create()


  // -------------------------------
  // UPDATE
  // -------------------------------
  function update() {
    if (!player) return;

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

    // animations & idle
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

    // minimap arrow rotation & position
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
    for (let poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < POI_RADIUS) { currentPOI = poi; if (!isMobile) showPressE(); break; }
    }
    if (!currentPOI && !isMobile) hidePressE();
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
      showInteraction(currentPOI);
    }

    // Villes detection
    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille; showCityBanner(inVille);
    }

    // Debug blocking detection (will not disable collisions, only logs)
    debugCheckBlocking();
  }

  // -------------------------------
  // HELPERS: parse object layers for POI/VILLE/spawn
  // -------------------------------
  function parseObjectLayers() {
    poiData = [];
    villes = [];
    if (!map) return;

    // POI layer
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      poiLayer.objects.forEach(obj => {
        const name = obj.name || "";
        const type = (obj.type || "").toLowerCase();
        // skip spawn object from POI list
        if (name.toLowerCase() === "spawn_avezzano" || type === "spawn") return;
        poiData.push({
          x: obj.x,
          y: obj.y,
          title: obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI",
          description: obj.properties?.find(p => p.name === "text")?.value || "",
          image: obj.properties?.find(p => p.name === "media")?.value || null
        });
      });
    }

    // VILLE layer
    const villeLayer = map.getObjectLayer("VILLE");
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      villeLayer.objects.forEach(obj => {
        const cx = obj.x + (obj.width || 0)/2;
        const cy = obj.y + (obj.height || 0)/2;
        const r = Math.max(obj.width || 0, obj.height || 0)/2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      });
    }
  }

  // -------------------------------
  // HELPERS: get spawn point (prefer spawn_avezzano)
  // -------------------------------
  function getSpawnPoint(mapRef) {
    if (!mapRef) return null;
    const objLayer = mapRef.getObjectLayer("POI");
    if (!objLayer || !Array.isArray(objLayer.objects)) return null;
    let found = null;
    objLayer.objects.forEach(o => {
      if (!o) return;
      const n = (o.name || "").toLowerCase();
      const t = (o.type || "").toLowerCase();
      if (n === "spawn_avezzano" || t === "spawn") {
        found = { x: o.x, y: o.y };
      }
    });
    return found;
  }

  // -------------------------------
  // HELPERS: per-tile collision setup (this is the robust fix)
  // We will explicitly set tile collisions only for tiles that are NOT in IGNORE_TILE_INDICES
  // This prevents broad disabling of collisions and preserves normal collisions elsewhere.
  // -------------------------------
  function setupCollisionsPerTile() {
    if (!map) return;
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (!layer || !layer.layer) return;
      // Only for tilemap layers that we intend to use for collisions
      if (!collisionLayers.includes(name)) {
        if (DEBUG) console.log("Skipping collision setup for non-collidable layer:", name);
        return;
      }
      try {
        // iterate every tile and set collision true except for ignored indices
        layer.forEachTile(tile => {
          if (!tile) return;
          if (tile.index === -1) {
            tile.setCollision(false, false, false, false);
            return;
          }
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            // ensure tile is non-collidable
            tile.setCollision(false, false, false, false);
            if (DEBUG) console.log(`IGNORÉ collision tile index=${tile.index} at (${tile.x},${tile.y}) on layer ${name}`);
          } else {
            // mark this tile collidable on all sides
            tile.setCollision(true, true, true, true);
          }
        });
        if (DEBUG) console.log("Terminé setupCollisionsPerTile pour", name);
      } catch (err) {
        console.warn("Erreur dans setupCollisionsPerTile pour", name, err);
      }
    });
  }

  // -------------------------------
  // (Re)apply collision setting at runtime - useful while testing in browser console
  // call: window.reapplyTileCollisions()
  // -------------------------------
  window.reapplyTileCollisions = function() {
    try {
      setupCollisionsPerTile();
      // re-add colliders: remove existing and re-add to ensure updated tiles are used
      // For simplicity we reload physics colliders by restarting the scene (cheap).
      // But here we simply re-add colliders to each layer; Phaser will reuse existing ones.
      console.log("Re-application des collisions par tuile effectuée.");
    } catch (e) { console.error("reapplyTileCollisions failed", e); }
  };

  // -------------------------------
  // PLAYER ANIMATIONS CREATION
  // -------------------------------
  function createPlayerAnimations() {
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "idle-down", frames: [{ key: "player", frame: 1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key: "player", frame: 4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key: "player", frame: 7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key: "player", frame: 10 }] });
  }

  // -------------------------------
  // UI: show/hide Press E
  // -------------------------------
  function showPressE() {
    if (!document.getElementById("pressE")) {
      const e = document.createElement("div");
      e.id = "pressE";
      e.innerText = "Appuie sur E";
      Object.assign(e.style, {
        position: "absolute", top: "20px", left: "50%", transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.7)", color: "#fff", padding: "6px 12px",
        borderRadius: "6px", zIndex: "9999"
      });
      document.body.appendChild(e);
    }
  }
  function hidePressE() { const el = document.getElementById("pressE"); if (el) el.remove(); }

  // -------------------------------
  // Interaction box (POI)
  // -------------------------------
  function showInteraction(poi) {
    let imgPath = poi.image;
    if (imgPath && !imgPath.startsWith("images/")) imgPath = "images/" + imgPath;
    try { document.getElementById("sfx-open")?.play(); } catch(_) {}
    interactionBox.innerHTML = `
      <div class="interaction-content">
        <button id="closeBox">✖</button>
        <h2>${poi.title}</h2>
        <p>${poi.description}</p>
        ${imgPath ? `<img src="${imgPath}" alt="${poi.title}">` : ""}
      </div>
    `;
    interactionBox.style.display = "flex";
    const closeBtn = document.getElementById("closeBox");
    if (closeBtn) closeBtn.onclick = () => { interactionBox.style.display = "none"; try { document.getElementById("sfx-close")?.play(); } catch(_) {} };
  }

  // -------------------------------
  // City banner (entering villes)
  // -------------------------------
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

  // -------------------------------
  // DEBUG: tile blocking detection
  // -------------------------------
  function debugCheckBlocking() {
    if (!player || !player.body) return;
    const b = player.body;
    if (!(b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down)) return;

    const checks = [
      { dir: "left", dx: -16, dy: 0 },
      { dir: "right", dx: 16, dy: 0 },
      { dir: "up", dx: 0, dy: -16 },
      { dir: "down", dx: 0, dy: 16 }
    ];

    for (const c of checks) {
      if (!b.blocked[c.dir]) continue;
      const wx = player.x + c.dx, wy = player.y + c.dy;
      const realBlocking = [];
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            console.log(`  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
          } else if (tileCollides) {
            realBlocking.push({ layerName, tile });
          } else {
            // not colliding tile (fine)
          }
        } catch (err) {}
      }

      if (realBlocking.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${Math.round(wx)}, ${Math.round(wy)})`);
        for (const binfo of realBlocking) {
          const t = binfo.tile;
          console.log(`    → blocking on layer "${binfo.layerName}" tile index=${t.index} at (${t.x},${t.y})`, t.properties || {});
        }
      } else {
        console.log(`(debug) faux blocage détecté ${c.dir} à (${Math.round(wx)}, ${Math.round(wy)}) — aucune tuile 'collides' trouvée.`);
      }
    }
  }

  // -------------------------------
  // Mobile controls setup
  // -------------------------------
  function bindMobileControls() {
    const bindButton = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => { e.preventDefault(); onDown && onDown(); };
      const end   = (e) => { e.preventDefault(); onUp && onUp(); };
      el.addEventListener("touchstart", start, { passive: false });
      el.addEventListener("touchend", end, { passive: false });
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
      eBtn.addEventListener("touchstart", tap, { passive: false });
      eBtn.addEventListener("mousedown", tap);
    }
  }

  // -------------------------------
  // playAnim wrapper
  // -------------------------------
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) player.anims.play(key, true);
    player.anims.timeScale = isRunning ? 2 : 1;
  }

  // -------------------------------
  // expose some utilities on window for debugging
  // -------------------------------
  window.DEBUG_MAIN = {
    reapplyTileCollisions: () => { try { setupCollisionsPerTile(); console.log("Collisions re-appliquées"); } catch(e){ console.error(e); } },
    listIgnoreIndices: () => IGNORE_TILE_INDICES.slice(),
    addIgnoreIndex: (i) => { IGNORE_TILE_INDICES.push(i); setupCollisionsPerTile(); }
  };

  if (DEBUG) console.log("main.js loaded");
}; // window.onload end

// ======================================================
// End of main.js
// ======================================================
