// ======================================================
// main_full_fixed.js
// Erasmus Game — Full main.js (robust, mobile+desktop fixes)
// Features:
//  - Loads erasmus.tmj and tilesets
//  - Ensures spawn_avezzano is used both on PC and mobile (case-insensitive search)
//  - Reduced player hitbox to avoid ghost collisions
//  - Collision system with reliable toggle (D key) & mobile GOD button
//      -> Disabling collisions uses both removing colliders AND disabling player's collision check
//      -> Re-enabling restores tile collisions and colliders reliably
//  - POI interactions (E key + mobile button)
//  - City banner appears when entering 'VILLE' zones
//  - Minimap, particles, mobile controls, debug utilities
//  - Camera strictly centered on player (no lerp)
//  - Defensive: handles missing layers/tilesets gracefully
// ======================================================

window.onload = function () {
  // -------------------------------
  // CONFIG
  // -------------------------------
  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: "game",
    physics: {
      default: "arcade",
      arcade: { debug: false, gravity: { y: 0 } }
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(config);

  // -------------------------------
  // GLOBALS
  // -------------------------------
  let map = null;
  let player = null;
  let cursors = null;
  let shiftKey = null;
  let interactionKey = null;
  let toggleCollisionsKey = null; // D
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;
  let createdLayers = {}; // name -> layer object
  let layerColliders = []; // colliders for tile layers
  let genericColliders = []; // other colliders we've added
  let collisionsEnabled = true;
  let playerCollisionBackup = null; // to restore pre-toggle settings

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };
  const MOBILE_GOD_BTN_ID = "btn-godmode";

  // Layers and collision configuration
  const COLLISION_LAYERS = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
  ];

  // Known tile indices that are false positives for collisions (bridge/road artifacts)
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    // Map + tilesets - adjust paths to match your project
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // player sprite
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // optional audio
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // -------------------------------
  // CREATE
  // -------------------------------
  function create() {
    map = this.make.tilemap({ key: "map" });
    if (!map) {
      console.error("Map failed to load. Check path to erasmus.tmj");
      return;
    }

    // Add tilesets. First parameter must match the name used in Tiled.
    const ts1 = safeAddTileset(map, "tileset_part1.png", "tileset_part1");
    const ts2 = safeAddTileset(map, "tileset_part2.png", "tileset_part2");
    const ts3 = safeAddTileset(map, "tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // Create all layers found in the map (defensive)
    createdLayers = {};
    try {
      map.layers.forEach(ld => {
        const name = ld.name;
        try {
          const layer = map.createLayer(name, tilesets, 0, 0);
          if (layer) createdLayers[name] = layer;
        } catch (err) {
          console.warn("Could not create layer:", name, err);
        }
      });
    } catch (err) {
      console.warn("Map.layers iteration failed:", err);
    }

    // Depth adjustments for specific decorative layers (if present)
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // -------------------------------
    // Objects: spawn, POIs
    // -------------------------------
    let spawnPoint = null;
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      poiLayer.objects.forEach(obj => {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();
        // Prefer explicit spawn_avezzano (case-insensitive)
        if (name === "spawn_avezzano" || type === "spawn") {
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
          return;
        }
        // Collect POI properties (title, text, media)
        poiData.push({
          x: obj.x,
          y: obj.y,
          title: obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI",
          description: obj.properties?.find(p => p.name === "text")?.value || "",
          image: obj.properties?.find(p => p.name === "media")?.value || null
        });
      });
    }

    // fallback: find any object with 'spawn' in the name
    if (!spawnPoint && poiLayer && Array.isArray(poiLayer.objects)) {
      spawnPoint = poiLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }

    // Final fallback: map center
    if (!spawnPoint) {
      console.warn("spawn_avezzano not found, fallback to center of map");
      spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
    }

    // On mobile the previous issue was spawning at an unwanted point - force spawn_avezzano when available
    const forcedSpawn = findSpawnAvezzano(poiLayer);
    if (isMobile && forcedSpawn) {
      spawnPoint = forcedSpawn;
    }

    // Create player
    player = this.physics.add.sprite(spawnPoint.x || 0, spawnPoint.y || 0, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // reduce the hitbox to avoid ghost collisions
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // Save backup of player's collision settings to restore later
    playerCollisionBackup = {
      checkCollision: Object.assign({}, player.body.checkCollision),
      collideWorldBounds: player.body.collideWorldBounds
    };

    // -------------------------------
    // VILLE object layer -> city proximity zones
    // -------------------------------
    const villeLayer = map.getObjectLayer("VILLE");
    villes = [];
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      villeLayer.objects.forEach(obj => {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      });
    }

    // -------------------------------
    // COLLISION SETUP
    // Mark collidable tile layers, remove problematic tile indices
    // -------------------------------
    setupCollisions(this);

    // Add colliders (store them so we can remove later)
    addLayerColliders(this);

    // -------------------------------
    // Camera - strictly centered (no lerp)
    // -------------------------------
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // -------------------------------
    // Minimap
    // -------------------------------
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW / 2, minimapCam.y + miniH / 2, 0, 12, 12, 12, 6, 0, 0xff0000);
    playerMiniArrow.setScrollFactor(0).setDepth(11001);

    // -------------------------------
    // Inputs & DOM
    // -------------------------------
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    toggleCollisionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Interaction box overlay
    interactionBox = document.getElementById("interaction-box");
    if (!interactionBox) {
      interactionBox = document.createElement("div");
      interactionBox.id = "interaction-box";
      interactionBox.style.display = "none";
      document.body.appendChild(interactionBox);
    } else {
      interactionBox.style.display = "none";
    }

    // Add mobile god mode button (if mobile)
    if (isMobile) {
      addMobileGodButton();
    }

    // -------------------------------
    // Animations
    // -------------------------------
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start:0, end:2 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start:3, end:5 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start:6, end:8 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start:9, end:11 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "idle-down", frames: [{ key: "player", frame: 1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key: "player", frame: 4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key: "player", frame: 7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key: "player", frame: 10 }] });

    // -------------------------------
    // Particles (dust)
    // -------------------------------
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x: 0, y: 0, speed: { min: -40, max: 40 }, angle: { min: 200, max: 340 },
      scale: { start: 0.27, end: 0 }, alpha: { start: 0.8, end: 0 }, lifespan: 400, on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // -------------------------------
    // Mobile controls binding
    // -------------------------------
    bindMobileControls();

    // Intro button behavior (if present)
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch (_) {}
        showCityBanner("Avezzano");
      };
    }
  } // end create()

  // -------------------------------
  // UPDATE
  // -------------------------------
  function update() {
    if (!player) return;

    // Toggle collisions (D) - use JustDown to avoid repeats
    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      collisionsEnabled = !collisionsEnabled;
      if (!collisionsEnabled) {
        disableCollisions(getScene());
        showTempDebugNotice("GOD MODE ON - collisions disabled");
      } else {
        enableCollisions(getScene());
        showTempDebugNotice("GOD MODE OFF - collisions enabled");
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

    // Animate
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

    // Minimap arrow
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

    // POI detection & interaction hint
    currentPOI = null;
    for (let poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < POI_RADIUS) {
        currentPOI = poi;
        if (!isMobile) showPressE();
        break;
      }
    }
    if (!currentPOI && !isMobile) hidePressE();
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) showInteraction(currentPOI);

    // Villes detection
    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // Debug check for true blocking tiles (non-invasive)
    debugCheckBlocking();
  }

  // -------------------------------
  // HELPERS
  // -------------------------------
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) {
      player.anims.play(key, true);
    }
    player.anims.timeScale = isRunning ? 2 : 1;
  }

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
    try { document.getElementById("sfx-open")?.play(); } catch(_) {}
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

  // -------------------------------
  // Collision utilities
  // -------------------------------
  function setupCollisions(scene) {
    // For each named layer, set collisions by exclusion then clear problematic tile indices
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (!layer) return;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1]);
          // Remove collisions for ignore indices
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e) {}
          // Ensure per-tile flags removed
          layer.forEachTile(tile => {
            try {
              if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
                tile.setCollision(false, false, false, false);
              }
            } catch (err) {}
          });
        } catch (err) {
          console.warn("Collision setup error for layer", name, err);
        }
      }
    });
  }

  function addLayerColliders(scene) {
    // remove old if any
    removeLayerColliders(scene);
    layerColliders = [];
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (!layer) return;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch (err) {
          // ignore collider add errors
        }
      }
    });
  }

  function removeLayerColliders(scene) {
    layerColliders.forEach(col => {
      try { scene.physics.world.removeCollider(col); } catch(e) {}
    });
    layerColliders = [];
  }

  function disableCollisions(scene) {
    // Disable collisions robustly: remove colliders, disable tile collision and turn off player's checks
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (!layer) return;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // clear collisions on layer
          layer.setCollisionByExclusion([-1], false);
        } catch (err) {
          // fallback: iterate tiles
          try {
            layer.forEachTile(tile => { if (tile) tile.setCollision(false, false, false, false); });
          } catch (e) {}
        }
      }
    });

    // remove colliders tracked
    removeLayerColliders(scene);

    // disable player's built-in collision checks (so it won't block on world/body collisions)
    if (player && player.body) {
      player.body.checkCollision.left = false;
      player.body.checkCollision.right = false;
      player.body.checkCollision.up = false;
      player.body.checkCollision.down = false;
    }
  }

  function enableCollisions(scene) {
    // Re-apply layer tile collisions and add colliders back
    setupCollisions(scene);
    addLayerColliders(scene);

    // restore player's collision checks (from backup if available)
    if (player && player.body) {
      if (playerCollisionBackup && playerCollisionBackup.checkCollision) {
        Object.assign(player.body.checkCollision, playerCollisionBackup.checkCollision);
      } else {
        player.body.checkCollision.left = true;
        player.body.checkCollision.right = true;
        player.body.checkCollision.up = true;
        player.body.checkCollision.down = true;
      }
    }
  }

  // -------------------------------
  // Debug blocking checks (non-invasive)
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
      const wx = Math.round(player.x + c.dx);
      const wy = Math.round(player.y + c.dy);

      // look for any real collidable tiles (exclude IGNORE indices)
      const blocking = [];
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        if (!tLayer) continue;
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            console.log(`  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
          } else if (tileCollides) {
            blocking.push({ layerName, tile });
          }
        } catch (err) {}
      }

      if (blocking.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${wx}, ${wy})`);
        blocking.forEach(bi => console.log(`    → blocking on layer "${bi.layerName}" tile index=${bi.tile.index} at (${bi.tile.x},${bi.tile.y})`, bi.tile.properties || {}));
      } else {
        console.log(`(debug) faux blocage détecté ${c.dir} à (${wx}, ${wy}) — aucune tuile 'collides' trouvée.`);
      }
    }
  }

  // -------------------------------
  // Mobile specific: God button
  // -------------------------------
  function addMobileGodButton() {
    if (document.getElementById(MOBILE_GOD_BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = MOBILE_GOD_BTN_ID;
    btn.innerText = "GOD";
    Object.assign(btn.style, {
      position: "fixed", left: "12px", bottom: "12px", padding: "10px 14px", zIndex: 99999,
      background: "rgba(0,0,0,0.7)", color: "#fff", borderRadius: "8px", border: "none", fontSize: "14px"
    });
    document.body.appendChild(btn);
    const toggle = () => {
      collisionsEnabled = !collisionsEnabled;
      if (!collisionsEnabled) {
        disableCollisions(getScene());
        showTempDebugNotice("GOD MODE ON (mobile)");
      } else {
        enableCollisions(getScene());
        showTempDebugNotice("GOD MODE OFF (mobile)");
      }
    };
    btn.addEventListener("touchstart", (e) => { e.preventDefault(); toggle(); }, { passive: false });
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); toggle(); });
  }

  // -------------------------------
  // Mobile controls binding (D-pad buttons expected in DOM)
  // -------------------------------
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
  // Utility helpers
  // -------------------------------
  function safeAddTileset(map, tiledName, key) {
    try {
      return map.addTilesetImage(tiledName, key);
    } catch (err) {
      try { return map.addTilesetImage(tiledName); } catch (e) { return null; }
    }
  }

  function findSpawnAvezzano(objLayer) {
    if (!objLayer || !Array.isArray(objLayer.objects)) return null;
    for (let obj of objLayer.objects) {
      const name = (obj.name || "").toLowerCase();
      if (name === "spawn_avezzano") return obj;
    }
    return null;
  }

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

  function getScene() {
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // -------------------------------
  // Export / End
  // -------------------------------
  // nothing to export, everything runs within window.onload
};
// ======================================================
// EOF - main_full_fixed.js
// ======================================================
