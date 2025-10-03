// ============================================================
// main.js - Erasmus Game (complete, production/dev friendly)
// - Loads erasmus.tmj and tileset_part1/2/3
// - Spawn forced to "spawn_avezzano" when present (mobile & desktop)
// - POI interactions (E key + mobile button)
// - VILLE zones -> city banner on entering
// - Robust collisions with IGNORE list and toggle (God Mode)
// - Mobile controls + God Mode mobile button
// - Minimap, particles, animations, debug utilities
// - Many safety checks to avoid missing layers / tilesets
// ============================================================

window.addEventListener('load', () => {

  // =========================
  // CONFIG
  // =========================
  const config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: window.innerWidth,
    height: window.innerHeight,
    physics: {
      default: 'arcade',
      arcade: {
        debug: false,
        gravity: { y: 0 }
      }
    },
    scene: { preload, create, update },
    render: { pixelArt: false, antialias: true }
  };

  const game = new Phaser.Game(config);

  // =========================
  // GLOBALS
  // =========================
  let map = null;
  let createdLayers = {};        // name -> TilemapLayer
  let layerColliders = [];       // Phaser collider objects we create between player and tile layers
  let decorationColliders = [];  // any other colliders we create (e.g. object layers)
  let player = null;
  let cursors = null;
  let shiftKey = null;
  let interactionKey = null;
  let toggleCollisionsKey = null;
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];              // list of POIs {x,y,title,description,image}
  let currentPOI = null;
  let villes = [];               // list of city zones {name,x,y,radius}
  let currentVille = null;
  let interactionBox = null;
  let isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // THESE LAYERS ARE TREATED AS COLLIDABLE (names must match exactly the layer names in Tiled)
  const COLLISION_LAYERS = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2","ponts","ground"
  ];

  // Indices to ignore (tiles that visually appear as blocking but should not collide)
  // Add indices found in your logs here. This list includes indices you previously reported.
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // Radii
  const POI_RADIUS = 40;
  const VILLE_RADIUS_DEFAULT = 150;

  // Toggle state
  let collisionsEnabled = true; // collisions active by default

  // For debugging and logs — set to true to see more console output
  const VERBOSE = false;

  // -------------------------
  // PRELOAD
  // -------------------------
  function preload() {
    // tilemap (you said your file is uploaded as erasmus.tmj)
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");

    // tilesets (names should match what the TMJ expects)
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // player
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // sounds (optional)
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // -------------------------
  // CREATE
  // -------------------------
  function create() {
    // Make map
    try {
      map = this.make.tilemap({ key: "map" });
    } catch (e) {
      console.error("Map load failed:", e);
      return;
    }

    // Add tilesets (names MUST match the tileset names used inside Tiled TMJ)
    const ts1 = safeAddTileset(map, "tileset_part1.png", "tileset_part1");
    const ts2 = safeAddTileset(map, "tileset_part2.png", "tileset_part2");
    const ts3 = safeAddTileset(map, "tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // Create layers - iterate over map.layers (preserves Tiled ordering)
    createdLayers = {};
    map.layers.forEach(ld => {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, tilesets, 0, 0);
        if (layer) {
          createdLayers[name] = layer;
          // set depth to y for simple parallax by y if needed
          layer.setDepth(0);
        }
      } catch (err) {
        console.warn("Layer creation skipped:", name, err);
      }
    });

    // Make sure decorative lamp layers don't block rendering order (if present)
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // -------------------------
    // OBJECT LAYERS: spawn & POI
    // -------------------------
    let spawnPoint = null;
    // Look for object layer named POI OR objects in other layers
    const poiObjLayer = map.getObjectLayer("POI");
    if (poiObjLayer && Array.isArray(poiObjLayer.objects)) {
      poiObjLayer.objects.forEach(obj => {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();
        // spawn detection: prefer a named spawn "spawn_avezzano"
        if (name === "spawn_avezzano" || type === "spawn") {
          // choose spawn_avezzano if found
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
          return;
        }
        // collect POI
        const title = obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI";
        const description = obj.properties?.find(p => p.name === "text")?.value || "";
        const media = obj.properties?.find(p => p.name === "media")?.value || null;
        poiData.push({ x: obj.x, y: obj.y, title, description, image: media });
      });
    }

    // fallback: try to find any 'spawn' object in ANY object layer
    if (!spawnPoint) {
      const allObjLayers = map.objects || [];
      for (const ol of allObjLayers) {
        if (!ol.objects) continue;
        const found = ol.objects.find(o => (o.name || "").toLowerCase().includes("spawn"));
        if (found) { spawnPoint = found; break; }
      }
    }

    // final fallback to map center if spawn not found
    if (!spawnPoint) {
      console.warn("spawn_avezzano not found — fallback to map center");
      spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
    }

    // -------------------------
    // Create player sprite (physics)
    // -------------------------
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // shrink hitbox to avoid 'ghost collisions' on thin bridges
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // -------------------------
    // VILLE object layer -> create city zones
    // -------------------------
    villes = [];
    const villeLayer = map.getObjectLayer("VILLE");
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      villeLayer.objects.forEach(obj => {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || VILLE_RADIUS_DEFAULT;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      });
    }

    // -------------------------
    // COLLISIONS: set collision flags on configured layers and remove problematic indices
    // -------------------------
    setupCollisionsAndColliders(this);

    // -------------------------
    // CAMERA + MINIMAP
    // -------------------------
    // Strictly center camera on player (no lerp) if desired
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom);
    minimapCam.startFollow(player);

    // minimap player arrow (screen-space)
    playerMiniArrow = this.add.triangle(minimapCam.x + miniW / 2, minimapCam.y + miniH / 2, 0, 12, 12, 12, 6, 0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // -------------------------
    // INPUTS & DOM
    // -------------------------
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    toggleCollisionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // Interaction box DOM element (overlay)
    interactionBox = document.getElementById("interaction-box");
    if (!interactionBox) {
      interactionBox = document.createElement("div");
      interactionBox.id = "interaction-box";
      interactionBox.style.display = "none";
      document.body.appendChild(interactionBox);
    } else {
      interactionBox.style.display = "none";
    }

    // pressing D toggles collisions
    this.input.keyboard.on('keydown-D', () => {
      collisionsEnabled = !collisionsEnabled;
      if (collisionsEnabled) {
        enableAllCollisions(this);
        showTemporaryNotice("Collisions Réactivées");
      } else {
        disableAllCollisions(this);
        showTemporaryNotice("God Mode ON (Collisions désactivées)");
      }
      console.log("collisionsEnabled:", collisionsEnabled);
    });

    // -------------------------
    // ANIMATIONS
    // -------------------------
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 7, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 7, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 7, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 7, repeat: -1 });
    this.anims.create({ key: "idle-down", frames: [{ key: "player", frame: 1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key: "player", frame: 4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key: "player", frame: 7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key: "player", frame: 10 }] });

    // -------------------------
    // PARTICLES (dust when running)
    // -------------------------
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x: 0, y: 0, speed: { min: -40, max: 40 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.27, end: 0 }, alpha: { start: 0.8, end: 0 },
      lifespan: 400, on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // -------------------------
    // MOBILE CONTROLS + BINDINGS
    // -------------------------
    bindMobileControls();

    // Intro button behavior if present
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch (_) {}
        showCityBanner("Avezzano");
      };
    }

    // small safety: re-enable collisions if they were accidentally disabled by previous session
    if (!collisionsEnabled) {
      disableAllCollisions(this);
    }
  } // end create

  // -------------------------
  // UPDATE
  // -------------------------
  function update() {
    if (!player || !player.body) return;

    const isRunning = (shiftKey && shiftKey.isDown) || mobileInput.run;
    const speed = isRunning ? 150 : 70;
    let vx = 0, vy = 0;

    // Desktop controls
    if (!isMobile) {
      if (cursors.left.isDown) vx -= speed;
      if (cursors.right.isDown) vx += speed;
      if (cursors.up.isDown) vy -= speed;
      if (cursors.down.isDown) vy += speed;
    } else {
      // mobile dpad flags
      if (mobileInput.left) vx -= speed;
      if (mobileInput.right) vx += speed;
      if (mobileInput.up) vy -= speed;
      if (mobileInput.down) vy += speed;
    }

    player.setVelocity(vx, vy);

    // play animations
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

    // update minimap arrow
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

    // POI detection + interaction UI
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
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
      showInteraction(currentPOI);
    }

    // Villes proximity detection (show city banner when entering range)
    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // debug check for collisions — optional verbose logs
    debugCheckBlocking();
  }

  // =========================
  // HELPERS & UTILITIES
  // =========================

  // Safely add tileset image by name used in Tiled and key used in preload
  function safeAddTileset(mapObj, tiledName, key) {
    try {
      return mapObj.addTilesetImage(tiledName, key);
    } catch (e) {
      // Try fallback: use key as both tiledName & key
      try { return mapObj.addTilesetImage(key, key); } catch (_) { return null; }
    }
  }

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
        background: "rgba(0,0,0,0.7)", color: "#fff", padding: "6px 12px",
        borderRadius: "6px", zIndex: "9999", fontWeight: "bold"
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
    // hook close button
    const closeBtn = document.getElementById("closeBox");
    if (closeBtn) closeBtn.onclick = () => {
      interactionBox.style.display = "none";
      try { document.getElementById("sfx-close")?.play(); } catch(_) {}
    };
  }

  function showCityBanner(name) {
    let banner = document.getElementById("city-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "city-banner";
      document.body.appendChild(banner);
    }
    let overlay = document.getElementById("fade-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "fade-overlay";
      document.body.appendChild(overlay);
    }
    overlay.classList.add("active");
    setTimeout(() => {
      banner.innerText = name;
      banner.classList.add("show");
      overlay.classList.remove("active");
      setTimeout(() => banner.classList.remove("show"), 4000);
    }, 420);
  }

  // Escape helpers for interaction content
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // =========================
  // COLLISION MANAGEMENT
  // - set collision flags on layers
  // - create / remove colliders to allow toggling collisions fully
  // =========================

  function setupCollisionsAndColliders(scene) {
    // clear any previous colliders state arrays
    layerColliders = [];
    decorationColliders = [];

    // for each layer that exists and is in COLLISION_LAYERS, configure collisions but remove IGNORE indices
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // set all non-empty tiles to collide by exclusion (default behavior)
          layer.setCollisionByExclusion([-1]);

          // try to clear collision for known bad indices
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e) {}
          // also ensure per-tile collision flags are removed
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              tile.setCollision(false, false, false, false);
            }
          });
        } catch (err) {
          console.warn("Error setting collisions for layer", name, err);
        }
      }
    }

    // add collider between player and each configured layer (store to layerColliders)
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch (err) {
          // older phaser or non-tile layer may throw — ignore safely
          if (VERBOSE) console.warn("Failed to add collider for", name, err);
        }
      }
    }

    // optionally add colliders for some decorative layers if they exist
    ["lampadaire + bancs + panneaux","lampadaire_base","lampadaire_haut"].forEach(n => {
      if (createdLayers[n]) {
        try {
          const c = scene.physics.add.collider(player, createdLayers[n]);
          if (c) decorationColliders.push(c);
        } catch(e) {}
      }
    });
  }

  function removeAllLayerColliders(scene) {
    // remove tracked colliders
    for (const c of layerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    for (const c of decorationColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    layerColliders = [];
    decorationColliders = [];
  }

  // Disable collisions on tile layers but keep visuals
  function disableAllCollisions(scene) {
    // remove colliders first
    removeAllLayerColliders(scene);
    // then remove tile collision flags
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1], false); // phaser usage: second param = recalc? but we set false where possible
        } catch(e) {
          // ignore if not supported
        }
        try {
          layer.forEachTile(tile => {
            if (tile) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch(e){}
      }
    }
    // Also remove any other world-level colliders (just in case)
    // (we only track ones we created above, so this is best-effort)
  }

  // Enable collisions by restoring tile collision flags and colliders
  function enableAllCollisions(scene) {
    // restore tile collision flags based on original configuration
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1]);
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e){}
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch(e) {
          if (VERBOSE) console.warn("enableAllCollisions: couldn't set collisions for", name, e);
        }
      }
    }
    // re-add colliders
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch (err) {}
      }
    }

    // decorations
    ["lampadaire + bancs + panneaux","lampadaire_base","lampadaire_haut"].forEach(n => {
      if (createdLayers[n]) {
        try {
          const c = scene.physics.add.collider(player, createdLayers[n]);
          if (c) decorationColliders.push(c);
        } catch(e){}
      }
    });
  }

  // =========================
  // MOBILE CONTROLS
  // =========================
  function bindMobileControls() {
    // Utility to bind button by id
    const bindButton = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => { try { e.preventDefault(); } catch(_){}; onDown && onDown(); };
      const end   = (e) => { try { e.preventDefault(); } catch(_){}; onUp && onUp();   };
      el.addEventListener("touchstart", start, { passive: false });
      el.addEventListener("touchend", end, { passive: false });
      el.addEventListener("mousedown", start);
      el.addEventListener("mouseup", end);
      el.addEventListener("mouseleave", end);
    };

    // D-pad
    bindButton("btn-up",    () => mobileInput.up = true,    () => mobileInput.up = false);
    bindButton("btn-down",  () => mobileInput.down = true,  () => mobileInput.down = false);
    bindButton("btn-left",  () => mobileInput.left = true,  () => mobileInput.left = false);
    bindButton("btn-right", () => mobileInput.right = true, () => mobileInput.right = false);
    bindButton("btn-run",   () => mobileInput.run = true,   () => mobileInput.run = false);

    // Interact button
    const eBtn = document.getElementById("btn-interact");
    if (eBtn) {
      const tap = (evt) => { try { evt.preventDefault(); } catch(_){}; if (currentPOI) showInteraction(currentPOI); };
      eBtn.addEventListener("touchstart", tap, { passive: false });
      eBtn.addEventListener("mousedown", tap);
    }

    // Add a mobile GOD button if not present already
    // We'll append it to action-buttons container so CSS remains consistent
    const actionButtons = document.getElementById("action-buttons");
    if (actionButtons && !document.getElementById("btn-god-mobile")) {
      const godBtn = document.createElement("button");
      godBtn.id = "btn-god-mobile";
      godBtn.className = "action-btn";
      godBtn.innerText = "GOD";
      godBtn.style.background = "purple";
      godBtn.style.fontWeight = "bold";
      godBtn.style.pointerEvents = "auto";
      actionButtons.appendChild(godBtn);

      godBtn.addEventListener("touchstart", (e) => {
        try { e.preventDefault(); } catch(_) {}
        collisionsEnabled = !collisionsEnabled;
        if (collisionsEnabled) enableAllCollisions(getScene()); else disableAllCollisions(getScene());
        // visual feedback
        godBtn.style.transform = "scale(0.95)";
        showTemporaryNotice(collisionsEnabled ? "Collisions ON" : "God Mode ON");
        setTimeout(()=> godBtn.style.transform = "scale(1)", 120);
      });
    }
  }

  // small helper: attempt to get a Scene context for collision toggles
  function getScene() {
    if (player && player.scene) return player.scene;
    if (game && game.scene && game.scene.scenes && game.scene.scenes.length > 0) return game.scene.scenes[0];
    return null;
  }

  // show small temporary on-screen debug/notice
  function showTemporaryNotice(text, duration = 1100) {
    let d = document.getElementById("tmp-debug-notice");
    if (!d) {
      d = document.createElement("div");
      d.id = "tmp-debug-notice";
      Object.assign(d.style, {
        position:"fixed", right:"12px", top:"12px", background:"rgba(0,0,0,0.75)", color:"#fff",
        padding:"8px 12px", borderRadius:"8px", zIndex:99999, fontWeight:"bold"
      });
      document.body.appendChild(d);
    }
    d.innerText = text;
    d.style.display = "block";
    setTimeout(()=> d.style.display = "none", duration);
  }

  // =========================
  // DEBUG: check blocking tile info
  // - logs only when real collidable tile is blocking
  // - avoids spamming when IGNORE indices only found
  // =========================
  function debugCheckBlocking() {
    if (!player || !player.body) return;
    const body = player.body;
    if (!(body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down)) return;

    const checks = [
      { dir: "left", dx: -16, dy: 0 },
      { dir: "right", dx: 16, dy: 0 },
      { dir: "up", dx: 0, dy: -16 },
      { dir: "down", dx: 0, dy: 16 },
    ];

    for (const c of checks) {
      if (!body.blocked[c.dir]) continue;
      const wx = Math.round(player.x + c.dx);
      const wy = Math.round(player.y + c.dy);

      const realBlockingTiles = [];
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            if (VERBOSE) console.log(` → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
          } else if (tileCollides) {
            realBlockingTiles.push({ layerName, tile });
          }
        } catch (err) {
          // ignore read errors
        }
      }

      if (realBlockingTiles.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${wx}, ${wy})`);
        for (const b of realBlockingTiles) {
          const t = b.tile;
          console.log(`   → blocking on layer "${b.layerName}" tile index=${t.index} at (${t.x},${t.y})`, t.properties || {});
        }
      } else if (VERBOSE) {
        console.log(`(debug) faux blocage détecté ${c.dir} à (${wx}, ${wy}) — aucune tuile 'collides' trouvée.`);
      }
    }
  }

  // =========================
  // UTILITY: Setup collisions on load (called in create)
  // =========================
  function setupCollisionsAndColliders(scene) {
    // First set collision flags on layers that should collide
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // Make all non-empty tiles collidable
          layer.setCollisionByExclusion([-1]);
          // Disable collisions for IGNORE indices (if any)
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch (err) {}
          // Also clear per-tile flags for those indices (safe)
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch (err) {
          console.warn("Unable to set collisions for layer", name, err);
        }
      }
    }

    // Then add colliders between player and each collidable tile layer
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch (err) {
          if (VERBOSE) console.warn("Failed to add collider for layer", name, err);
        }
      }
    }

    // decorative colliders example
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try {
        const c = scene.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]);
        if (c) decorationColliders.push(c);
      } catch(e){}
    }
  }

  // =========================
  // Helper: disable collisions and remove colliders robustly
  // =========================
  function disableAllCollisions(scene) {
    // remove colliders (tile and decorative)
    for (const c of layerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    for (const c of decorationColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    layerColliders = [];
    decorationColliders = [];

    // clear tile collision flags on all collidable layers
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // iterate tiles and clear flags
          layer.forEachTile(tile => {
            if (tile) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch(e){}
      }
    }
  }

  // =========================
  // Helper: re-enable collisions
  // =========================
  function enableAllCollisions(scene) {
    // restore layer collision flags & colliders
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1]);
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e){}
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch(e){}
      }
    }

    // add colliders
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch(e){}
      }
    }

    // decorative colliders re-add
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try {
        const c = scene.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]);
        if (c) decorationColliders.push(c);
      } catch(e){}
    }
  }

  // =========================
  // EXTRA: when user toggles god mode with D
  // (a small helper wrapper)
  // =========================
  function toggleCollisions(scene) {
    collisionsEnabled = !collisionsEnabled;
    if (!collisionsEnabled) disableAllCollisions(scene); else enableAllCollisions(scene);
    showTemporaryNotice(collisionsEnabled ? "Collisions activées" : "God mode ON");
  }

  // =========================
  // UTILITY: show small console + UI when starting
  // =========================
  function showStartupInfo() {
    if (VERBOSE) {
      console.log("Erasmus Game loaded. COLLISION_LAYERS:", COLLISION_LAYERS);
      console.log("IGNORE_TILE_INDICES:", IGNORE_TILE_INDICES);
    }
  }

  // call for debug
  showStartupInfo();

  // expose some helpers to window for manual testing (optional)
  window._erasmus = {
    getPlayer: () => player,
    toggleGod: () => toggleCollisions(getScene()),
    collisionsEnabled: () => collisionsEnabled
  };

}); // end window load

// ============================================================
// EOF
// ============================================================
