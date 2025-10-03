// ======================================================
// main_prod_complete_with_toggle.js  (Production build)
// Erasmus Game - main script (production-ready)
// - Loads erasmus.tmj + tilesets
// - Player spawn (spawn_avezzano fallback)
// - POI interactions (E + mobile)
// - VILLE zones (city banners)
// - Collisions applied to configured layers; ignores specified tile indices
// - Camera strictly centered on player (no lerp)
// - Minimap, particles, mobile controls
// - Key "D" toggles collisions on/off (useful for debugging or bypassing stuck areas)
// - Drop-in replacement for previous main.js
// ======================================================

window.onload = function () {
  // -------------------------------
  // CONFIG - production settings
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
  let createdLayers = {}; // name -> layer
  let layerColliders = []; // store colliders so we can remove/recreate them when toggling
  let collisionsEnabled = true;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // Layers that should have collisions (string names must match Tiled layers)
  const COLLISION_LAYERS = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
  ];

  // Tile indices we want to ignore as collidable (bridge artifacts etc)
  // Add any indices you observed in logs here.
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // Gameplay radii
  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    // map + tilesets (file names you provided)
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // player and optional audio
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // -------------------------------
  // CREATE
  // -------------------------------
  function create() {
    map = this.make.tilemap({ key: "map" });

    // Add tilesets by the names Tiled uses (first arg = name in Tiled, second = key used in preload)
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // Create layers and keep references
    createdLayers = {};
    for (let ld of map.layers) {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, tilesets, 0, 0);
        if (layer) createdLayers[name] = layer;
      } catch (err) {
        console.warn("Layer creation failed:", name, err);
      }
    }

    // Decorative depth adjustments (optional)
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // -------------------------------
    // OBJECTS: POI + spawn detection
    // -------------------------------
    let spawnPoint = null;
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      for (let obj of poiLayer.objects) {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();
        if (name === "spawn_avezzano" || type === "spawn") {
          // prefer explicit spawn_avezzano
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
          continue;
        }
        // Collect POIs: support properties 'title','text','media' as in your examples
        const titleProp = obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI";
        const textProp = obj.properties?.find(p => p.name === "text")?.value || "";
        const mediaProp = obj.properties?.find(p => p.name === "media")?.value || null;
        poiData.push({ x: obj.x, y: obj.y, title: titleProp, description: textProp, image: mediaProp });
      }
    }

    // fallback: try to find any object with 'spawn' in name
    if (!spawnPoint && poiLayer && Array.isArray(poiLayer.objects)) {
      spawnPoint = poiLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }

    // final fallback: center of map
    if (!spawnPoint) spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };

    // -------------------------------
    // Create player
    // -------------------------------
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // Make sure body exists then reduce hitbox to avoid ghost collisions
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // -------------------------------
    // VILLE zones (object layer 'VILLE')
    // -------------------------------
    const villeLayer = map.getObjectLayer("VILLE");
    villes = [];
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      for (let obj of villeLayer.objects) {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      }
    }

    // -------------------------------
    // COLLISIONS: apply to target layers and remove IGNORE indices
    // -------------------------------
    setupCollisions(this);

    // Add collision between player and each collidable tile layer
    addLayerColliders(this);

    // Collide with decorations if needed
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) {}
    }

    // -------------------------------
    // Camera - strictly centered on player (no lerp) as requested
    // -------------------------------
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // -------------------------------
    // Minimap (small overlay camera)
    // -------------------------------
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH).setZoom(miniZoom).startFollow(player);
    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);
    playerMiniArrow.setVisible(true);

    // -------------------------------
    // Input & DOM
    // -------------------------------
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    toggleCollisionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

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
    // Animations
    // -------------------------------
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start:0, end:2 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start:3, end:5 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start:6, end:8 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start:9, end:11 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "idle-down", frames: [{ key:"player", frame:1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key:"player", frame:4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key:"player", frame:7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key:"player", frame:10 }] });

    // -------------------------------
    // Particles - dust when running
    // -------------------------------
    const gfx = this.make.graphics({ x:0, y:0, add:false });
    gfx.fillStyle(0xffffff,1).fillCircle(4,4,4);
    gfx.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0,y:0, speed:{min:-40,max:40}, angle:{min:200,max:340},
      scale:{start:0.27,end:0}, alpha:{start:0.8,end:0}, lifespan:400, on:false
    });
    dustEmitter.startFollow(player, 0, -6);

    // -------------------------------
    // Mobile controls binding
    // -------------------------------
    bindMobileControls();

    // Auto-show initial banner for Avezzano if intro element present
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

  // -------------------------------
  // UPDATE
  // -------------------------------
  function update() {
    if (!player) return;

    // Toggle collisions with D key (on keydown only)
    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      collisionsEnabled = !collisionsEnabled;
      if (collisionsEnabled) {
        enableCollisions(thisSceneForToggle()); // re-enable collisions
        showTempDebugNotice("Collisions réactivées");
      } else {
        disableCollisions(thisSceneForToggle()); // disable collisions
        showTempDebugNotice("Collisions désactivées");
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

    // play animations based on velocity
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

    // Villes detection - show banner only once when entering a new ville
    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // minimal blocking debug: only warn on real blocking tiles
    debugCheckBlockingProd();
  }

  // -------------------------------
  // HELPER FUNCTIONS
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
        position:"absolute", top:"20px", left:"50%", transform:"translateX(-50%)",
        background:"rgba(0,0,0,0.7)", color:"#fff", padding:"6px 12px", borderRadius:"6px", zIndex:"9999"
      });
      document.body.appendChild(e);
    }
  }
  function hidePressE() { const e=document.getElementById("pressE"); if (e) e.remove(); }

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
  // Collisions control helpers
  // -------------------------------
  function setupCollisions(scene) {
    for (let [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1]);
          // remove collisions for specific indices
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e) {}
          // also clear per-tile flags for safety
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              tile.setCollision(false, false, false, false);
            }
          });
        } catch (err) {
          console.warn("Collision setup error for layer", name, err);
        }
      }
    }
  }

  function addLayerColliders(scene) {
    // clear any old colliders we tracked
    for (let col of layerColliders) {
      try { scene.physics.world.removeCollider(col); } catch(e) {}
    }
    layerColliders = [];
    for (let [name, layer] of Object.entries(createdLayers)) {
      if (COLLISION_LAYERS.includes(name) && layer) {
        try {
          const c = scene.physics.add.collider(player, layer);
          if (c) layerColliders.push(c);
        } catch (err) { /* ignore */ }
      }
    }
  }

  function removeLayerColliders(scene) {
    for (let col of layerColliders) {
      try { scene.physics.world.removeCollider(col); } catch(e) {}
    }
    layerColliders = [];
  }

  function disableCollisions(scene) {
    // Disable collisions on the collidable layers (keep visuals but remove collision flags)
    for (let [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          // set all tiles non-colliding
          layer.setCollisionByExclusion([-1], false);
          layer.forEachTile(tile => {
            if (tile) tile.setCollision(false, false, false, false);
          });
        } catch (err) {
          // fallback per-tile approach
          layer.forEachTile(tile => { try { if (tile) tile.setCollision(false, false, false, false); } catch(e){} });
        }
      }
    }
    removeLayerColliders(scene);
  }

  function enableCollisions(scene) {
    setupCollisions(scene);
    addLayerColliders(scene);
  }

  // Helper to supply scene context when called from update()
  function thisSceneForToggle() {
    // Phaser uses the callback context as the Scene when create/update are called.
    // 'this' inside update refers to the Scene, but here we need to return it.
    // We can access a global via player.scene if player exists.
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  // -------------------------------
  // minimal blocking debug for production
  // -------------------------------
  function debugCheckBlockingProd() {
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
      let foundRealBlocking = false;
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        if (!tLayer) continue;
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            console.log(`  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
          } else if (tileCollides) {
            foundRealBlocking = true;
            console.warn(`Player blocked ${c.dir} — collidable tile index=${tile.index} on layer "${layerName}" at (${tile.x},${tile.y})`);
          }
        } catch (err) {}
      }
      if (!foundRealBlocking) {
        // do not spam console in prod; lightweight info for debugging
        console.log(`(debug) faux blocage détecté ${c.dir} à (${wx},${wy}) — aucune tuile 'collides' trouvée.`);
      }
    }
  }

  // -------------------------------
  // MOBILE CONTROLS - binds to DOM buttons if present
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

    bindButton("btn-up", () => mobileInput.up=true, () => mobileInput.up=false);
    bindButton("btn-down", () => mobileInput.down=true, () => mobileInput.down=false);
    bindButton("btn-left", () => mobileInput.left=true, () => mobileInput.left=false);
    bindButton("btn-right", () => mobileInput.right=true, () => mobileInput.right=false);
    bindButton("btn-run", () => mobileInput.run=true, () => mobileInput.run=false);

    const eBtn = document.getElementById("btn-interact");
    if (eBtn) {
      const tap = (evt) => { evt.preventDefault(); if (currentPOI) showInteraction(currentPOI); };
      eBtn.addEventListener("touchstart", tap, { passive:false });
      eBtn.addEventListener("mousedown", tap);
    }
  }

  // -------------------------------
  // Utilities
  // -------------------------------
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // temporary onscreen debug notice
  function showTempDebugNotice(text, ms=1100) {
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

  // Helper to get scene context inside handlers
  function getScene() {
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  // -------------------------------
  // End window.onload
  // -------------------------------
}; // window.onload end

// ======================================================
// EOF - main_prod_complete_with_toggle.js
// ======================================================
