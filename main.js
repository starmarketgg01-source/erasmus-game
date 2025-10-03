// ======================================================
// main_full_erasmus_prod.js
// Erasmus — Full main.js (production-ready, long form)
// - Includes: tilemap loading, tileset mapping, spawn selection (force spawn_avezzano if present)
// - Collisions on configured layers with ignored tile indices
// - Toggleable God Mode (D key + mobile button) that truly disables collisions for the player
// - Mobile-friendly fixes: uses same spawn logic and reduces hitbox further on mobile when necessary
// - Camera strictly centered on player (no lerp) as requested
// - POI interactions (E key + mobile interaction button)
// - VILLE proximity banners
// - Minimap, particles, mobile D-pad, mobile god button
// - Debug utilities (verbose mode can be enabled)
// - Designed to be drop-in replacement for your previous main.js and intentionally verbose for clarity
// ======================================================

window.onload = function () {
  // ==============================
  // CONFIGURATION
  // ==============================
  const CONFIG = {
    WIDTH: window.innerWidth,
    HEIGHT: window.innerHeight,
    PARENT: 'game',
    PHASER_DEBUG: false, // enable Phaser's debug if needed
    CAMERA_ZOOM: 2.5,
    MINIMAP: { width: 220, height: 160, zoom: 0.22 },
    PLAYER_SCALE: 0.20,
    PLAYER_SPRITE_FRAMES: { width: 144, height: 144 },
    POI_RADIUS: 40,
    DEFAULT_VILLE_RADIUS: 150,
    COLLISION_LAYERS: [
      "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
    ],
    // Add known tile indices that you want to treat as non-colliding (bridge artifacts, decoration tiles)
    IGNORE_TILE_INDICES: [809, 1341, 2268, 2269],
    MOBILE_EXTRA_HITBOX_REDUCTION: 0.08, // shrink more on mobile if necessary
    PROD_VERBOSE: false // set to true to get more console logs
  };

  // ==============================
  // PHASER CONFIG & GAME
  // ==============================
  const phaserConfig = {
    type: Phaser.AUTO,
    width: CONFIG.WIDTH,
    height: CONFIG.HEIGHT,
    parent: CONFIG.PARENT,
    physics: {
      default: "arcade",
      arcade: { debug: CONFIG.PHASER_DEBUG, gravity: { y: 0 } }
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(phaserConfig);

  // ==============================
  // GLOBALS used by the scene functions
  // ==============================
  let map = null;
  let createdTilesets = [];
  let createdLayers = {}; // name -> TilemapLayer
  let player = null;
  let cursors = null;
  let shiftKey = null;
  let interactionKey = null;
  let toggleCollisionsKey = null;
  let mobileGodBtn = null;
  let swapCamToFixed = true; // camera strictly centered (no smoothing)
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;
  let layerColliders = []; // store colliders to add/remove
  let collisionsEnabled = true; // true by default
  let isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let mobileInput = { up:false, down:false, left:false, right:false, run:false };
  let spawnObjectNamePreferred = "spawn_avezzano"; // force this spawn if present

  // ==============================
  // PRELOAD: assets, tilemap, tilesets, spritesheets, audio
  // ==============================
  function preload() {
    // tilemap
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");

    // tilesets you mentioned; keys must match usage in addTilesetImage calls
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // player
    this.load.spritesheet("player", "images/characters/player.png", {
      frameWidth: CONFIG.PLAYER_SPRITE_FRAMES.width,
      frameHeight: CONFIG.PLAYER_SPRITE_FRAMES.height
    });

    // optional audio - keep gracefully optional at runtime
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // ==============================
  // CREATE: map, layers, player, collisions, cameras, UI
  // ==============================
  function create() {
    // Create map
    map = this.make.tilemap({ key: "map" });

    // Add tilesets. The first param must be the tileset name as used INSIDE Tiled map.
    // If the names differ, open your TMJ and copy the names exactly.
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    createdTilesets = [ts1, ts2, ts3].filter(Boolean);

    // Create all layers defined in the TMJ (keeps names)
    createdLayers = {};
    map.layers.forEach(ld => {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, createdTilesets, 0, 0);
        if (layer) createdLayers[name] = layer;
      } catch (err) {
        console.warn("Layer creation failed for", name, err);
      }
    });

    // Decor depths (optional)
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // ---------------------------
    // OBJECT LAYERS: POI & SPAWN
    // ---------------------------
    // We'll try to force spawn_avezzano if present; otherwise fallback to any spawn object, then map center
    let spawnPoint = null;
    const poiObjLayer = map.getObjectLayer("POI");
    if (poiObjLayer && Array.isArray(poiObjLayer.objects)) {
      // prefer spawn_avezzano explicitly
      const preferSpawn = poiObjLayer.objects.find(o => (o.name || "").toLowerCase() === spawnObjectNamePreferred);
      if (preferSpawn) {
        spawnPoint = preferSpawn;
      } else {
        // find any explicit spawn
        spawnPoint = poiObjLayer.objects.find(o => (o.type || "").toLowerCase() === "spawn" || (o.name || "").toLowerCase().includes("spawn")) || null;
      }

      // Collect POI objects (non-spawn)
      poiObjLayer.objects.forEach(obj => {
        const nm = obj.name || "";
        if ((nm || "").toLowerCase() === (spawnPoint && spawnPoint.name || "").toLowerCase()) return;
        // skip spawn-like objects
        if ((obj.type || "").toLowerCase() === "spawn") return;
        // extract props
        const title = obj.properties?.find(p => p.name === "title")?.value || obj.name || "Point d'intérêt";
        const text  = obj.properties?.find(p => p.name === "text")?.value || "";
        const media = obj.properties?.find(p => p.name === "media")?.value || null;
        poiData.push({ x: obj.x, y: obj.y, title, description: text, image: media });
      });
    }

    // VILLE layer (city zones)
    const villeLayer = map.getObjectLayer("VILLE");
    villes = [];
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      villeLayer.objects.forEach(obj => {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || CONFIG.DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      });
    }

    // Spawn fallback: center-of-map when still not found
    if (!spawnPoint) {
      console.warn("spawn not found - falling back to map center");
      spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
    }

    // ---------------------------
    // PLAYER creation + hitbox adjustment
    // ---------------------------
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(CONFIG.PLAYER_SCALE);
    player.setCollideWorldBounds(true);

    // Reduce hitbox to avoid "ghost" collisions
    if (player.body) {
      const baseW = player.width * 0.45;
      const baseH = player.height * 0.32;
      const extraMobileReduction = isMobile ? CONFIG.MOBILE_EXTRA_HITBOX_REDUCTION * player.width : 0;
      player.body.setSize(baseW - extraMobileReduction, baseH - extraMobileReduction);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // ---------------------------
    // COLLISIONS: set collision flags on configured layers and remove ignored indices
    // ---------------------------
    setupCollisions(this);

    // Add colliders for player vs layers
    addLayerColliders(this);

    // Make sure decorative layers potentially collide (safe-guard)
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e){}
    }

    // ---------------------------
    // CAMERA: strictly center (no lerp)
    // ---------------------------
    this.cameras.main.startFollow(player, false, 1, 1); // no smoothing: strict follow
    this.cameras.main.setZoom(CONFIG.CAMERA_ZOOM);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // ---------------------------
    // MINIMAP camera overlay
    // ---------------------------
    const mini = CONFIG.MINIMAP;
    minimapCam = this.cameras.add(window.innerWidth - mini.width - 12, 12, mini.width, mini.height).setZoom(mini.zoom).startFollow(player);
    playerMiniArrow = this.add.triangle(minimapCam.x + mini.width/2, minimapCam.y + mini.height/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);
    playerMiniArrow.setVisible(true);

    // ---------------------------
    // INPUTS + DOM references
    // ---------------------------
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    toggleCollisionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // interaction box DOM element
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
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "idle-down", frames: [{ key: "player", frame: 1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key: "player", frame: 4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key: "player", frame: 7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key: "player", frame: 10 }] });

    // ---------------------------
    // PARTICLES (dust when running)
    // ---------------------------
    const gfx = this.make.graphics({ x: 0, y: 0, add: false });
    gfx.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    gfx.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x: 0, y: 0, speed: { min: -40, max: 40 }, angle: { min: 200, max: 340 },
      scale: { start: 0.27, end: 0 }, alpha: { start: 0.8, end: 0 }, lifespan: 400, on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // ---------------------------
    // MOBILE CONTROLS + GOD MODE BUTTON
    // ---------------------------
    bindMobileControls();

    // If there's an intro button (web UI), wire it to fade intro and optionally play bgm
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

  // ==============================
  // UPDATE: main loop
  // ==============================
  function update() {
    if (!player) return;

    // Toggle collisions with D key (only on key down -> toggle)
    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      collisionsEnabled = !collisionsEnabled;
      if (collisionsEnabled) {
        enableCollisions(getScene());
        showTempDebugNotice("Collisions réactivées (D)");
      } else {
        disableCollisions(getScene());
        showTempDebugNotice("God Mode activé (D)");
      }
    }

    // Movement
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

    // Animations
    if (vx < 0) playAnim("left", isRunning);
    else if (vx > 0) playAnim("right", isRunning);
    else if (vy < 0) playAnim("up", isRunning);
    else if (vy > 0) playAnim("down", isRunning);
    else {
      if (player.anims.currentAnim) {
        const dir = player.anims.currentAnim.key;
        if (["up", "down", "left", "right"].includes(dir)) player.anims.play("idle-" + dir, true);
      }
    }

    player.setDepth(player.y);
    dustEmitter.on = isRunning && (Math.abs(vx) > 1 || Math.abs(vy) > 1);

    // Minimap arrow update
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

    // POI detection + interactions (E)
    currentPOI = null;
    for (const poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < CONFIG.POI_RADIUS) {
        currentPOI = poi;
        if (!isMobile) showPressE();
        break;
      }
    }
    if (!currentPOI && !isMobile) hidePressE();
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
      showInteraction(currentPOI);
    }

    // VILLE proximity detection
    let inVille = null;
    for (const v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // lightweight debug: check for true blocking tiles (will not spam if collisions disabled)
    debugCheckBlockingWhenRelevant();
  }

  // ==============================
  // Helper: play animation helper
  // ==============================
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) player.anims.play(key, true);
    player.anims.timeScale = isRunning ? 2 : 1;
  }

  // ==============================
  // UI helpers: show/hide press E and Interaction box
  // ==============================
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
  function hidePressE() { const e = document.getElementById("pressE"); if (e) e.remove(); }

  function showInteraction(poi) {
    let imgPath = poi.image;
    if (imgPath && !imgPath.startsWith("images/")) imgPath = "images/" + imgPath;
    try { document.getElementById("sfx-open")?.play(); } catch (_) {}
    interactionBox.innerHTML = `
      <div class="interaction-content">
        <button id="closeBox">✖</button>
        <h2>${escapeHtml(poi.title)}</h2>
        <p>${escapeHtml(poi.description)}</p>
        ${imgPath ? `<img src="${escapeAttr(imgPath)}" alt="${escapeHtml(poi.title)}">` : ""}
      </div>
    `;
    interactionBox.style.display = "flex";
    const closeBtn = document.getElementById("closeBox");
    if (closeBtn) closeBtn.onclick = () => {
      interactionBox.style.display = "none";
      try { document.getElementById("sfx-close")?.play(); } catch (_) {}
    };
  }

  // ==============================
  // City banner + overlay
  // ==============================
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

  // ==============================
  // COLLISIONS MANAGEMENT
  // Provide robust enable/disable that truly allows passing through everything when disabled
  // ==============================
  function setupCollisions(scene) {
    // Mark collision on layers and remove flags for ignored indices
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (CONFIG.COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1]);
          // Try to unset collisions for known bad indices
          try { layer.setCollision(CONFIG.IGNORE_TILE_INDICES, false, true); } catch (e) {}
          // Also remove per-tile collision on ignored indices
          layer.forEachTile(tile => {
            if (tile && CONFIG.IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch (e) {}
            }
          });
          if (CONFIG.PROD_VERBOSE) console.log("Collision setup for layer:", name);
        } catch (err) {
          console.warn("Collision setup error for", name, err);
        }
      }
    }
  }

  function addLayerColliders(scene) {
    removeLayerColliders(scene); // ensure no duplicates
    layerColliders = [];
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (CONFIG.COLLISION_LAYERS.includes(name) && layer) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch (err) {
          // ignore individual errors
        }
      }
    }
  }

  function removeLayerColliders(scene) {
    for (const col of layerColliders) {
      try { scene.physics.world.removeCollider(col); } catch (e) {}
    }
    layerColliders = [];
  }

  // Fully disable collisions by:
  // - removing colliders
  // - clearing collision flags on tile layers
  // - disabling player body collision checks so it doesn't collide with world bounds or tiles
  function disableCollisions(scene) {
    // Remove colliders and clear collision flags on layers
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (CONFIG.COLLISION_LAYERS.includes(name)) {
        try {
          // try to clear all collisions for layer
          layer.setCollisionByExclusion([-1], false);
          layer.forEachTile(tile => { if (tile) { try { tile.setCollision(false, false, false, false); } catch(e){} } });
        } catch (err) {
          // fallback - iterate tiles regardless
          try { layer.forEachTile(tile => { if (tile) tile.setCollision(false,false,false,false); }); } catch(e) {}
        }
      }
    }
    removeLayerColliders(scene);

    // Disable player body collision checks (so it doesn't collide with world bounds or anything)
    if (player && player.body) {
      try {
        player.body.checkCollision.none = true;
        // Also set collideWorldBounds false while in god mode to allow moving past world edges if desired
        player.setCollideWorldBounds(false);
      } catch (e) {}
    }
  }

  // Re-enable collisions - restore tile flags and add colliders
  function enableCollisions(scene) {
    // restore per-layer collision flags (using setup logic)
    setupCollisions(scene);
    addLayerColliders(scene);

    // restore player body to normal collision checks
    if (player && player.body) {
      try {
        player.body.checkCollision.none = false;
        player.setCollideWorldBounds(true);
      } catch (e) {}
    }
  }

  // Utility to get current Scene when called from non-scene scoped functions
  function getScene() {
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  // ==============================
  // DEBUG: check blocking tiles and report only when there is actual collidable tile (not ignored)
  // ==============================
  function debugCheckBlockingWhenRelevant() {
    if (!player || !player.body) return;
    const b = player.body;
    if (!(b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down)) return;
    // only run when collisions enabled
    if (!collisionsEnabled) return;

    const checks = [
      { dir: "left", dx: -16, dy: 0 },
      { dir: "right", dx: 16, dy: 0 },
      { dir: "up", dx: 0, dy: -16 },
      { dir: "down", dx: 0, dy: 16 }
    ];

    for (const c of checks) {
      if (!b.blocked[c.dir]) continue;
      const wx = Math.round(player.x + c.dx);
      const wy = Math.round(player.y + c.dy);

      const realBlocking = [];
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (CONFIG.IGNORE_TILE_INDICES.includes(tile.index)) {
            if (CONFIG.PROD_VERBOSE) console.log(`IGNORED tile ${tile.index} at ${tile.x},${tile.y} on ${layerName}`);
          } else if (tileCollides) {
            realBlocking.push({ layerName, tile });
          }
        } catch (err) { /* ignore */ }
      }

      if (realBlocking.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${wx}, ${wy})`);
        for (const r of realBlocking) {
          console.log(`    → blocking on layer "${r.layerName}" tile index=${r.tile.index} at (${r.tile.x},${r.tile.y})`, r.tile.properties || {});
        }
      } else {
        // lightweight informational log only when verbose
        if (CONFIG.PROD_VERBOSE) console.log(`(debug) faux blocage ${c.dir} à (${wx},${wy}) — aucune tuile collidable trouvée.`);
      }
    }
  }

  // ==============================
  // MOBILE CONTROLS: binds D-pad and adds a GOD button for touch devices
  // ==============================
  function bindMobileControls() {
    const bindButton = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => { e.preventDefault(); onDown && onDown(); };
      const end = (e) => { e.preventDefault(); onUp && onUp(); };
      el.addEventListener("touchstart", start, { passive: false });
      el.addEventListener("touchend", end, { passive: false });
      el.addEventListener("mousedown", start);
      el.addEventListener("mouseup", end);
      el.addEventListener("mouseleave", end);
    };

    // Bind direction buttons (if present in your HTML)
    bindButton("btn-up", () => mobileInput.up = true, () => mobileInput.up = false);
    bindButton("btn-down", () => mobileInput.down = true, () => mobileInput.down = false);
    bindButton("btn-left", () => mobileInput.left = true, () => mobileInput.left = false);
    bindButton("btn-right", () => mobileInput.right = true, () => mobileInput.right = false);
    bindButton("btn-run", () => mobileInput.run = true, () => mobileInput.run = false);

    // Interaction button (E equivalent)
    const eBtn = document.getElementById("btn-interact");
    if (eBtn) {
      const tap = (evt) => { evt.preventDefault(); if (currentPOI) showInteraction(currentPOI); };
      eBtn.addEventListener("touchstart", tap, { passive: false });
      eBtn.addEventListener("mousedown", tap);
    }

    // Mobile God Mode button - create if not present
    mobileGodBtn = document.getElementById("btn-godmode");
    if (!mobileGodBtn) {
      mobileGodBtn = document.createElement("button");
      mobileGodBtn.id = "btn-godmode";
      mobileGodBtn.innerText = "GOD";
      Object.assign(mobileGodBtn.style, {
        position: "fixed", right: "12px", bottom: "12px", padding: "10px 12px", zIndex: 99999,
        background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "6px"
      });
      document.body.appendChild(mobileGodBtn);
    }
    // Attach handler for toggling collisions on mobile
    mobileGodBtn.addEventListener("touchstart", (e) => { e.preventDefault(); toggleGodModeMobile(); }, { passive: false });
    mobileGodBtn.addEventListener("mousedown", (e) => { e.preventDefault(); toggleGodModeMobile(); });
  }

  function toggleGodModeMobile() {
    collisionsEnabled = !collisionsEnabled;
    if (collisionsEnabled) {
      enableCollisions(getScene());
      showTempDebugNotice("Collisions réactivées (mobile GOD)");
    } else {
      disableCollisions(getScene());
      showTempDebugNotice("God Mode activé (mobile GOD)");
    }
  }

  // ==============================
  // Utilities: escape and attributes for safe DOM insertion
  // ==============================
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ==============================
  // Small on-screen debug/notice helper
  // ==============================
  function showTempDebugNotice(text, ms = 1200) {
    let d = document.getElementById("tmp-debug-notice");
    if (!d) {
      d = document.createElement("div");
      d.id = "tmp-debug-notice";
      Object.assign(d.style, { position: "fixed", right: "12px", top: "12px", background: "rgba(0,0,0,0.7)", color: "#fff", padding: "8px 12px", borderRadius: "6px", zIndex: 99999 });
      document.body.appendChild(d);
    }
    d.innerText = text;
    d.style.display = "block";
    setTimeout(() => { d.style.display = "none"; }, ms);
  }

  // ==============================
  // Small helper to get scene reference for toggles
  // ==============================
  function thisSceneForToggle() {
    return getScene();
  }

  // ==============================
  // Minimal safe functions to (re)create a downloadable file if you want
  // (not used directly by game; left for convenience)
  // ==============================

  // ==============================
  // End of window.onload scope — Phaser functions are above
  // ==============================
}; // end window.onload

// ======================================================
// End of main_full_erasmus_prod.js
// ======================================================
