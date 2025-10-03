// ======================================================
// main_godmode_complete.js
// Erasmus — main.js complet (God Mode + toggle D + POI + VILLE + minimap + mobile controls)
// - Toggle God Mode with D (disable collisions globally + re-enable)
// - Robust collision removal & restoration logic
// - Debug utilities and safe fallbacks
// - Drop-in replacement; compatible Phaser v3.55.x
// ======================================================

window.onload = function () {
  // -------------------------------
  // CONFIG (phaser)
  // -------------------------------
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

  // -------------------------------
  // GLOBALS
  // -------------------------------
  let map = null;
  let player = null;
  let cursors = null;
  let shiftKey = null;
  let interactionKey = null;
  let toggleCollisionsKey = null;
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;

  // Layers
  let createdLayers = {}; // { layerName: tilemapLayer }
  let layerColliders = []; // physics collider objects created between player and layers (we store to remove)
  let collisionsEnabled = true; // reflects "normal" collisions state
  let godModeActive = false;    // reflects toggled god mode

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // Layers that we intend to use as collidable (must match names in TMJ)
  const COLLISION_LAYERS = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
  ];

  // Indices to ignore (bridge artifacts). Add more indices here if seen.
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // Gameplay radii
  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    // Tiled map & tilesets (use the filenames you reported)
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // player
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // audio (optional)
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // -------------------------------
  // CREATE
  // -------------------------------
  function create() {
    // create map
    map = this.make.tilemap({ key: "map" });

    // add tilesets (first arg must match the tileset name used in Tiled)
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // create all layers, keep reference
    createdLayers = {};
    for (let ld of map.layers) {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, tilesets, 0, 0);
        createdLayers[name] = layer;
        // default tile layer depthing handled by tilemap; we may tweak some layers later.
      } catch (err) {
        console.warn("createLayer failed for", name, err);
      }
    }

    // decorative depth tweak - keep if exist
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // -------------------------------
    // OBJECTS: POI + spawn
    // -------------------------------
    let spawnPoint = null;
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      for (let obj of poiLayer.objects) {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();
        if (name === "spawn_avezzano" || type === "spawn") {
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
        } else {
          // parse properties
          const title = obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI";
          const desc  = obj.properties?.find(p => p.name === "text")?.value  || "";
          const img   = obj.properties?.find(p => p.name === "media")?.value || null;
          poiData.push({ x: obj.x, y: obj.y, title, description: desc, image: img });
        }
      }
    }

    // fallback: look for any object with spawn in name
    if (!spawnPoint && poiLayer && Array.isArray(poiLayer.objects)) {
      spawnPoint = poiLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }

    // final fallback: center of map
    if (!spawnPoint) {
      console.warn("spawn_avezzano introuvable, fallback centre map");
      spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
    }

    // create player
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // reduce hitbox (prevents ghost collisions on thin bridges)
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // -------------------------------
    // VILLE zones (object layer VILLE)
    // -------------------------------
    villes = [];
    const villeLayer = map.getObjectLayer("VILLE");
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      for (let obj of villeLayer.objects) {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      }
    }

    // -------------------------------
    // COLLISIONS: initial setup
    // -------------------------------
    setupCollisions(this);

    // add layer colliders to physics world
    addLayerColliders(this);

    // collide with decorative objects if present
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) {}
    }

    // -------------------------------
    // CAMERA: strict follow (centree strictement)
    // -------------------------------
    this.cameras.main.startFollow(player, false, 1, 1); // lerp disabled -> camera strictly centered
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0,0, map.widthInPixels, map.heightInPixels);

    // -------------------------------
    // MINIMAP
    // -------------------------------
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);
    playerMiniArrow.setVisible(true);

    // -------------------------------
    // INPUTS & DOM
    // -------------------------------
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    toggleCollisionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    // interaction box overlay (DOM)
    interactionBox = document.getElementById("interaction-box");
    if (!interactionBox) {
      interactionBox = document.createElement("div");
      interactionBox.id = "interaction-box";
      interactionBox.style.display = "none";
      document.body.appendChild(interactionBox);
    } else {
      interactionBox.style.display = "none";
    }

    // -------------------------------
    // ANIMATIONS
    // -------------------------------
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player",{ start:0, end:2 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player",{ start:3, end:5 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player",{ start:6, end:8 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player",{ start:9, end:11 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "idle-down", frames: [{ key:"player", frame:1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key:"player", frame:4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key:"player", frame:7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key:"player", frame:10 }] });

    // -------------------------------
    // PARTICLES (dust while running)
    // -------------------------------
    const g = this.make.graphics({ x:0, y:0, add:false });
    g.fillStyle(0xffffff, 1).fillCircle(4,4,4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0, y:0, speed:{ min:-40, max:40 }, angle:{ min:200, max:340 },
      scale:{ start:0.27, end:0 }, alpha:{ start:0.8, end:0 }, lifespan:400, on:false
    });
    dustEmitter.startFollow(player, 0, -6);

    // -------------------------------
    // MOBILE CONTROLS
    // -------------------------------
    bindMobileControls();

    // -------------------------------
    // intro button if present
    // -------------------------------
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }

    // show initial banner if desired (comment/uncomment)
    // showCityBanner("Avezzano");
  } // end create()

  // -------------------------------
  // UPDATE (game loop)
  // -------------------------------
  function update() {
    if (!player) return;

    // handle D toggle (JustDown ensures single toggle per press)
    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      // toggle flag
      godModeActive = !godModeActive;
      if (godModeActive) {
        // enable god mode: disable all collisions
        disableCollisionsForGodMode(getScene());
        showTempDebugNotice("GOD MODE ON (D) — collisions désactivées");
      } else {
        // restore collisions
        enableCollisionsFromGodMode(getScene());
        showTempDebugNotice("GOD MODE OFF (D) — collisions réactivées");
      }
    }

    // movement input
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

    // animations
    if (vx < 0) playAnim("left", isRunning);
    else if (vx > 0) playAnim("right", isRunning);
    else if (vy < 0) playAnim("up", isRunning);
    else if (vy > 0) playAnim("down", isRunning);
    else {
      if (player.anims.currentAnim) {
        const d = player.anims.currentAnim.key;
        if (["up","down","left","right"].includes(d)) player.anims.play("idle-" + d, true);
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

    // POI detection + E interaction
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

    // Villes proximity detection
    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // Debug blocking: shows warnings for *real* blocking tiles (only if not in god mode)
    if (!godModeActive) debugCheckBlocking();
  }

  // -------------------------------
  // HELPERS - Anim / UI / Interaction
  // -------------------------------
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
        ${imgPath?`<img src="${escapeAttr(imgPath)}" alt="${escapeHtml(poi.title)}">`:""}
      </div>
    `;
    interactionBox.style.display = "flex";
    const closeBtn = document.getElementById("closeBox");
    if (closeBtn) closeBtn.onclick = () => { interactionBox.style.display = "none"; try { document.getElementById("sfx-close")?.play(); } catch(_) {} };
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
      setTimeout(()=>banner.classList.remove("show"), 4000);
    }, 420);
  }

  // -------------------------------
  // COLLISION UTILITIES (robust god-mode toggles)
  // -------------------------------

  // Setup collisions initially: setCollisionByExclusion for configured layers and clear IGNORE indices per-tile
  function setupCollisions(scene) {
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // mark non-empty tiles as colliding by default
          layer.setCollisionByExclusion([-1]);
          // ensure ignore tile indices are not collidable
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e) {}
          // also clear per-tile flags (safe cleanup)
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch (err) {
          console.warn("setupCollisions error for", name, err);
        }
      }
    }
  }

  // create physics colliders between player and each tile layer we want collidable
  function addLayerColliders(scene) {
    // remove existing tracked colliders first
    for (let c of layerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    layerColliders = [];

    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const collider = scene.physics.add.collider(player, layer);
          if (collider) layerColliders.push(collider);
        } catch (err) {
          // ignore
        }
      }
    }
    collisionsEnabled = true;
  }

  // Remove colliders tracked between player and layers
  function removeLayerColliders(scene) {
    for (let c of layerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    layerColliders = [];
    collisionsEnabled = false;
  }

  // Disable collisions in a robust way (for God Mode):
  // - remove layer colliders
  // - set all tile collisions off for COLLISION_LAYERS
  // - set player's checkCollision flags to false and disable collideWorldBounds
  function disableCollisionsForGodMode(scene) {
    // remove physics colliders
    removeLayerColliders(scene);

    // clear collidable flags on tile layers (the visuals remain)
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // set all tiles non-colliding:
          // layer.setCollisionByExclusion([-1], false) is not always reliable on all versions, so iterate
          layer.forEachTile(tile => {
            if (tile) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch (err) { /* ignore */ }
      }
    }

    // disable player's world bounds collision and per-side collisions
    try {
      if (player.body) {
        player.setCollideWorldBounds(false);
        if (player.body.checkCollision) {
          player.body.checkCollision.up = false;
          player.body.checkCollision.down = false;
          player.body.checkCollision.left = false;
          player.body.checkCollision.right = false;
        } else {
          // older/newer phaser differences: attempt to set properties defensively
          player.body.checkCollision = { up:false, down:false, left:false, right:false };
        }
      }
    } catch (err) {
      console.warn("disableCollisionsForGodMode: player body adjust failed", err);
    }

    // mark state
    collisionsEnabled = false;
  }

  // Re-enable collisions after God Mode:
  // - restore tile collisions by setCollisionByExclusion, re-apply IGNORE indices
  // - recreate colliders
  // - restore player body collision flags and world bounds
  function enableCollisionsFromGodMode(scene) {
    // First restore tile collision flags for configured layers
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // mark all non-empty tiles as colliding (this uses tile properties set in Tiled)
          layer.setCollisionByExclusion([-1]);
          // ensure ignore indices are not collidable
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e){}
          // clear per-tile flags for ignored indices again
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch(e) {}
            }
          });
        } catch (err) {
          console.warn("enableCollisionsFromGodMode: restore collision flags failed for", name, err);
        }
      }
    }

    // recreate colliders between player and layers
    addLayerColliders(scene);

    // restore player body collision sides and world bounds
    try {
      if (player.body) {
        if (player.body.checkCollision) {
          player.body.checkCollision.up = true;
          player.body.checkCollision.down = true;
          player.body.checkCollision.left = true;
          player.body.checkCollision.right = true;
        } else {
          player.body.checkCollision = { up:true, down:true, left:true, right:true };
        }
        player.setCollideWorldBounds(true);
      }
    } catch (err) {
      console.warn("enableCollisionsFromGodMode: restoring player body flags failed", err);
    }

    collisionsEnabled = true;
  }

  // -------------------------------
  // DEBUG: blocking detection (detailed)
  // Only logs real collidable tiles (not IGNORE indices). Helpful to see where blocking is coming from.
  // -------------------------------
  function debugCheckBlocking() {
    if (!player || !player.body) return;
    const body = player.body;
    if (!(body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down)) return;

    const checks = [
      { dir: "left", dx: -16, dy: 0 },
      { dir: "right", dx: 16, dy: 0 },
      { dir: "up", dx: 0, dy: -16 },
      { dir: "down", dx: 0, dy: 16 }
    ];

    for (const c of checks) {
      if (!body.blocked[c.dir]) continue;
      const wx = Math.round(player.x + c.dx);
      const wy = Math.round(player.y + c.dy);
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
          } else {
            // non-collide tile (fine)
          }
        } catch (err) {
          // ignore read errors
        }
      }
      if (blocking.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${wx}, ${wy})`);
        for (const b of blocking) {
          const t = b.tile;
          console.log(`    → blocking on layer "${b.layerName}" tile index=${t.index} at (${t.x},${t.y})`, t.properties || {});
        }
      } else {
        // no real blocking tiles found; likely a physics edge case
        console.log(`(debug) faux blocage détecté ${c.dir} à (${wx}, ${wy}) — aucune tuile 'collides' trouvée.`);
      }
    }
  }

  // -------------------------------
  // MOBILE CONTROLS binding
  // -------------------------------
  function bindMobileControls() {
    const bindButton = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => { e.preventDefault(); onDown && onDown(); };
      const end   = (e) => { e.preventDefault(); onUp && onUp();   };
      el.addEventListener("touchstart", start, { passive:false });
      el.addEventListener("touchend", end,   { passive:false });
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
  }

  // -------------------------------
  // Small DOM helpers + escaping
  // -------------------------------
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // temporary debug notice on-screen
  function showTempDebugNotice(text, ms=1200) {
    let d = document.getElementById("tmp-debug-notice");
    if (!d) {
      d = document.createElement("div");
      d.id = "tmp-debug-notice";
      Object.assign(d.style, { position:"fixed", right:"12px", top:"12px", background:"rgba(0,0,0,0.7)", color:"#fff", padding:"8px 12px", borderRadius:"6px", zIndex:99999 });
      document.body.appendChild(d);
    }
    d.innerText = text;
    d.style.display = "block";
    setTimeout(()=>{ d.style.display = "none"; }, ms);
  }

  function getScene() {
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  // -------------------------------
  // Utility: add/remove collisions exposed for debugging or CLI usage
  // -------------------------------
  // remove all collisions quickly (not tied to godmode) - useful for debugging
  function removeAllCollisionsImmediate(scene) {
    try { removeLayerColliders(scene); } catch(e) {}
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      try { layer.forEachTile(tile => { if (tile) tile.setCollision(false, false, false, false); }); } catch(e) {}
    }
    if (player && player.body) {
      try {
        player.setCollideWorldBounds(false);
        if (player.body.checkCollision) {
          player.body.checkCollision.up = false;
          player.body.checkCollision.down = false;
          player.body.checkCollision.left = false;
          player.body.checkCollision.right = false;
        }
      } catch(e) {}
    }
  }

  // restore collisions immediate (use with caution)
  function restoreAllCollisionsImmediate(scene) {
    try {
      setupCollisions(scene);
      addLayerColliders(scene);
    } catch(e) {}
  }

  // -------------------------------
  // End window.onload
  // -------------------------------
}; // window.onload end

// ======================================================
// EOF - main_godmode_complete.js
// ======================================================
