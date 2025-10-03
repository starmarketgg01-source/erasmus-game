// ======================================================
// main_toggle_godmode_full.js
// Erasmus Game — Full main.js with robust collision toggle (God Mode)
// - Loads erasmus.tmj + tilesets
// - Player spawn (spawn_avezzano fallback)
// - POI interactions (E + mobile)
// - VILLE zones (city banners)
// - Collisions applied to configured layers; ignores specified tile indices
// - Camera strictly centered on player (no lerp)
// - Minimap, particles, mobile controls
// - D key toggles God Mode: disables collision completely (and re-enables it on repeat)
// - Defensive handling to avoid phantom collisions and ensure toggle works everywhere
// ======================================================

window.onload = function () {

  // -------------------------------
  // CONFIG / CONSTANTS
  // -------------------------------
  const VERBOSE = false; // set true to see detailed console logs
  const PROD = true;      // set false to enable more debug output if needed

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

  // Globals
  let map = null;
  let player = null;
  let cursors = null;
  let shiftKey = null;
  let interactionKey = null;
  let godModeKey = null; // D key
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;
  let createdLayers = {};     // name -> TilemapLayer
  let layerColliders = [];    // collider objects returned by physics.add.collider
  let collisionsEnabled = true;
  let playerCollisionBackup = null; // to store original player collision config

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // Layers that should have collisions (strings must match Tiled layer names)
  const COLLISION_LAYERS = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
  ];

  // Known problematic tile indices (from your logs) to IGNORE for collisions
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // Gameplay radii
  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    // Map & tilesets
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // Player
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // Optional audio
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // -------------------------------
  // CREATE
  // -------------------------------
  function create() {
    // 1) load map
    map = this.make.tilemap({ key: "map" });

    // tileset names used inside Tiled must match the first arg of addTilesetImage.
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // 2) create all layers and keep refs
    createdLayers = {};
    if (Array.isArray(map.layers)) {
      map.layers.forEach(ld => {
        const name = ld.name;
        try {
          const layer = map.createLayer(name, tilesets, 0, 0);
          if (layer) {
            createdLayers[name] = layer;
            if (VERBOSE) console.log("Layer created:", name);
          }
        } catch (err) {
          console.warn("Layer creation failed for:", name, err);
        }
      });
    } else {
      console.warn("Map.layers is not an array — map parsing may have failed.");
    }

    // optional depth tweaks
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // 3) parse POI object layer and spawn
    let spawnPoint = null;
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      poiLayer.objects.forEach(obj => {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();
        if (name === "spawn_avezzano" || type === "spawn") {
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
          return;
        }
        // gather POI props
        const title = obj.properties?.find(p=>p.name==="title")?.value || obj.name || "POI";
        const description = obj.properties?.find(p=>p.name==="text")?.value || "";
        const media = obj.properties?.find(p=>p.name==="media")?.value || null;
        poiData.push({ x: obj.x, y: obj.y, title, description, image: media });
      });
    } else {
      if (VERBOSE) console.log("POI layer missing or empty");
    }

    // fallback for spawn
    if (!spawnPoint && poiLayer && Array.isArray(poiLayer.objects)) {
      spawnPoint = poiLayer.objects.find(o => (o.name||"").toLowerCase().includes("spawn")) || null;
    }
    if (!spawnPoint) {
      console.warn("spawn_avezzano not found, falling back to map center");
      spawnPoint = { x: map.widthInPixels/2, y: map.heightInPixels/2 };
    }

    // 4) create player at spawn
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // shrink hitbox to avoid ghost collisions on thin features
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // keep a backup of player's collision flags so we can restore later
    if (player.body) {
      playerCollisionBackup = {
        checkCollision: Object.assign({}, player.body.checkCollision),
        // store any other flags if needed later
      };
    }

    // 5) parse VILLE object layer for city zones
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

    // 6) set collisions on designated layers (and remove ignore indices)
    setupCollisions(this);

    // 7) create colliders between player and tile layers
    addLayerColliders(this);

    // also allow collisions with decorative object layer if present
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) { if (VERBOSE) console.warn(e); }
    }

    // 8) camera strict follow (no lerp)
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // 9) minimap camera
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH).setZoom(miniZoom).startFollow(player);
    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // 10) inputs & DOM refs
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    godModeKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    interactionBox = document.getElementById("interaction-box");
    if (!interactionBox) {
      interactionBox = document.createElement("div");
      interactionBox.id = "interaction-box";
      interactionBox.style.display = "none";
      document.body.appendChild(interactionBox);
    } else {
      interactionBox.style.display = "none";
    }

    // 11) animations
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start:0, end:2 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start:3, end:5 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start:6, end:8 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start:9, end:11 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "idle-down", frames: [{ key:"player", frame:1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key:"player", frame:4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key:"player", frame:7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key:"player", frame:10 }] });

    // 12) particles for running dust
    const gfx = this.make.graphics({ x:0, y:0, add:false });
    gfx.fillStyle(0xffffff,1).fillCircle(4,4,4);
    gfx.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0, y:0, speed:{min:-40,max:40}, angle:{min:200,max:340},
      scale:{start:0.27,end:0}, alpha:{start:0.8,end:0}, lifespan:400, on:false
    });
    dustEmitter.startFollow(player, 0, -6);

    // 13) mobile controls
    bindMobileControls();

    // 14) optional UI: intro button
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }

    if (VERBOSE) console.log("Create complete. Collisions enabled:", collisionsEnabled);
  } // end create()

  // -------------------------------
  // UPDATE loop
  // -------------------------------
  function update() {
    if (!player) return;

    // Toggle God Mode with D (only on keydown)
    if (Phaser.Input.Keyboard.JustDown(godModeKey)) {
      collisionsEnabled = !collisionsEnabled;
      if (!collisionsEnabled) {
        // disable collisions globally
        disableCollisions(getScene());
        // additionally, set player body to not check collision (safeguard)
        if (player.body) player.body.checkCollision.none = true;
        showTempDebugNotice("God Mode ON (collisions off)");
        if (VERBOSE) console.log("God Mode ON: collisions removed");
      } else {
        // enable collisions back
        if (player.body) player.body.checkCollision.none = false;
        enableCollisions(getScene());
        showTempDebugNotice("God Mode OFF (collisions on)");
        if (VERBOSE) console.log("God Mode OFF: collisions restored");
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

    // apply velocity
    player.setVelocity(vx, vy);

    // animations
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

    // minimap arrow
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

    // POI detection + interactions
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

    // Minimal blocking debug: warn only if real collidable tile found
    debugCheckBlocking();
  } // end update()

  // -------------------------------
  // HELPERS & UTILITIES
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
        borderRadius: "6px", zIndex: "9999", fontFamily: "sans-serif"
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
      <div class="interaction-content" style="background:#fff;color:#000;padding:12px;border-radius:8px;max-width:420px;">
        <button id="closeBox" style="float:right;border:none;background:transparent;font-size:18px;cursor:pointer;">✖</button>
        <h2 style="margin:0 0 6px 0">${escapeHtml(poi.title)}</h2>
        <p style="margin:0 0 8px 0">${escapeHtml(poi.description)}</p>
        ${imgPath?`<img src="${escapeAttr(imgPath)}" alt="${escapeHtml(poi.title)}" style="max-width:100%;">`:""}
      </div>
    `;
    Object.assign(interactionBox.style, { display: "flex", alignItems: "center", justifyContent: "center", position: "fixed", left:0, top:0, width:"100%", height:"100%", background:"rgba(0,0,0,0.5)", zIndex:99998 });
    const closeBtn = document.getElementById("closeBox");
    if (closeBtn) closeBtn.onclick = () => { interactionBox.style.display = "none"; try { document.getElementById("sfx-close")?.play(); } catch(_) {} };
  }

  function showCityBanner(name) {
    let banner = document.getElementById("city-banner");
    if (!banner) { banner = document.createElement("div"); banner.id = "city-banner"; document.body.appendChild(banner); }
    let overlay = document.getElementById("fade-overlay");
    if (!overlay) { overlay = document.createElement("div"); overlay.id = "fade-overlay"; document.body.appendChild(overlay); }
    overlay.classList.add("active");
    // apply styles if not present
    Object.assign(overlay.style, { position:"fixed", left:0, top:0, width:"100%", height:"100%", background:"rgba(0,0,0,0.3)", zIndex:99990, display:"block" });
    Object.assign(banner.style, { position:"fixed", left:"50%", top:"14%", transform:"translateX(-50%)", padding:"14px 28px", background:"rgba(0,0,0,0.7)", color:"#fff", fontSize:"28px", borderRadius:"8px", zIndex:99991, display:"block", fontFamily:"sans-serif" });
    setTimeout(() => {
      banner.innerText = name;
      overlay.style.display = "none";
      setTimeout(()=>{ banner.style.display = "none"; }, 4000);
    }, 260);
  }

  // -------------------------------
  // COLLISION MANAGEMENT
  // -------------------------------
  // Carefully set collisions on tile layers, ignore indices, and clear per-tile flags for known problematic indices.
  function setupCollisions(scene) {
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // Mark non-empty tiles as collidable
          // setCollisionByExclusion accepts an array of indices to exclude from collision — [-1] means exclude empty
          layer.setCollisionByExclusion([-1]);
          // Attempt to remove collisions for known indices
          try {
            layer.setCollision(IGNORE_TILE_INDICES, false, true); // try to clear collision on these indices
          } catch (e) {
            if (VERBOSE) console.warn("setCollision(IGNORE) failed:", e);
          }
          // Ensure per tile collision flags cleared for ignore indices (extra safety)
          layer.forEachTile(tile => {
            try {
              if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
                tile.setCollision(false, false, false, false);
              }
            } catch (err) {
              // ignore per tile errors
            }
          });
          if (VERBOSE) console.log(`Collision: layer="${name}" configured (ignored indices: ${IGNORE_TILE_INDICES.join(",")})`);
        } catch (err) {
          console.warn("Error configuring collisions for layer", name, err);
        }
      } else {
        // not in collision layers: ensure no collisions
        try {
          layer.setCollisionByExclusion([-1], false);
        } catch (e) {}
      }
    }
  }

  // create colliders and store them so we can remove them on toggle
  function addLayerColliders(scene) {
    // Clear existing colliders tracked
    removeLayerColliders(scene);

    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const col = scene.physics.add.collider(player, layer);
          if (col) layerColliders.push(col);
          if (VERBOSE) console.log("Added collider for layer", name);
        } catch (err) {
          if (VERBOSE) console.warn("Failed to add collider for layer", name, err);
        }
      }
    }
  }

  function removeLayerColliders(scene) {
    for (const col of layerColliders) {
      try {
        scene.physics.world.removeCollider(col);
      } catch (err) {
        if (VERBOSE) console.warn("Failed to remove collider", err);
      }
    }
    layerColliders = [];
  }

  // Fully disable collisions: remove colliders, clear tile collision flags, set player to ignore collision checks.
  function disableCollisions(scene) {
    // remove physics colliders first
    removeLayerColliders(scene);

    // clear per-tile collision flags on collision layers
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // clear collisions for all tiles
          layer.forEachTile(tile => {
            try { if (tile) tile.setCollision(false, false, false, false); } catch(e) {}
          });
          // try to set no collisions by exclusion
          try { layer.setCollisionByExclusion([-1], false); } catch(e) {}
        } catch (err) {
          if (VERBOSE) console.warn("Error clearing tile collisions for", name, err);
        }
      }
    }

    // ensure player doesn't check collision
    if (player && player.body) {
      try {
        if (player.body.checkCollision) {
          player.body.checkCollision.none = true;
        } else {
          // older Phaser versions: try disabling body
          player.body.enable = false;
        }
      } catch (err) {
        if (VERBOSE) console.warn("Couldn't set player checkCollision.none:", err);
      }
    }

    // store flag
    collisionsEnabled = false;
  }

  // Re-enable collisions: restore tile collisions and recreate colliders
  function enableCollisions(scene) {
    // restore tile collisions sensibly
    setupCollisions(scene);

    // re-add colliders
    addLayerColliders(scene);

    // restore player collision checks
    if (player && player.body) {
      try {
        if (player.body.checkCollision) {
          player.body.checkCollision.none = false;
          // restore individual sides to previous state if available
          if (playerCollisionBackup && playerCollisionBackup.checkCollision) {
            Object.assign(player.body.checkCollision, playerCollisionBackup.checkCollision);
          }
        } else {
          player.body.enable = true;
        }
      } catch (err) {
        if (VERBOSE) console.warn("Couldn't restore player collision:", err);
      }
    }

    collisionsEnabled = true;
  }

  function getScene() {
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  // -------------------------------
  // DEBUG: check blocking tiles; only warns on real collidable tiles
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

      const blocking = [];
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        if (!tLayer) continue;
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            if (VERBOSE) console.log(`  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
            continue;
          } else if (tileCollides) {
            blocking.push({ layerName, tile });
          }
        } catch (err) {
          // ignore
        }
      }

      if (blocking.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${wx}, ${wy})`);
        for (const binfo of blocking) {
          const t = binfo.tile;
          console.log(`    → blocking on layer "${binfo.layerName}" tile index=${t.index} at (${t.x},${t.y})`, t.properties || {});
        }
      } else {
        // If we are in God Mode, this is expected; otherwise it's a physics edge case
        if (VERBOSE) console.log(`(debug) faux blocage détecté ${c.dir} à (${wx}, ${wy}) — aucune tuile 'collides' trouvée.`);
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
      const end = (e) => { e.preventDefault(); onUp && onUp(); };
      el.addEventListener("touchstart", start, { passive:false });
      el.addEventListener("touchend", end, { passive:false });
      el.addEventListener("mousedown", start);
      el.addEventListener("mouseup", end);
      el.addEventListener("mouseleave", end);
    };

    bindButton("btn-up", () => mobileInput.up = true, () => mobileInput.up = false);
    bindButton("btn-down", () => mobileInput.down = true, () => mobileInput.down = false);
    bindButton("btn-left", () => mobileInput.left = true, () => mobileInput.left = false);
    bindButton("btn-right", () => mobileInput.right = true, () => mobileInput.right = false);
    bindButton("btn-run", () => mobileInput.run = true, () => mobileInput.run = false);

    const eBtn = document.getElementById("btn-interact");
    if (eBtn) {
      const tap = (evt) => { evt.preventDefault(); if (currentPOI) showInteraction(currentPOI); };
      eBtn.addEventListener("touchstart", tap, { passive:false });
      eBtn.addEventListener("mousedown", tap);
    }
  }

  // -------------------------------
  // UI small helpers
  // -------------------------------
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // tiny temporary onscreen notice
  function showTempDebugNotice(text, ms=1200) {
    let d = document.getElementById("tmp-debug-notice");
    if (!d) {
      d = document.createElement("div");
      d.id = "tmp-debug-notice";
      Object.assign(d.style, { position:"fixed", right:"12px", top:"12px", background:"rgba(0,0,0,0.7)", color:"#fff", padding:"8px 12px", borderRadius:"6px", zIndex:99999, fontFamily:"sans-serif" });
      document.body.appendChild(d);
    }
    d.innerText = text;
    d.style.display = "block";
    setTimeout(()=>{ d.style.display = "none"; }, ms);
  }

  // convenience scene getter
  function getScene() { return (player && player.scene) ? player.scene : game.scene.scenes[0]; }

  // -------------------------------
  // END window.onload
  // -------------------------------
}; // window.onload end

// ======================================================
// End of main_toggle_godmode_full.js
// ======================================================
