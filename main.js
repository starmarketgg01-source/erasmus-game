// ======================================================
// main_prod_with_force_toggle_fixed.js
// Robust Phaser main with force-toggle collisions (D)
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
  let toggleCollisionsKey = null;
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;
  let createdLayers = {};         // { name: TilemapLayer }
  let layerColliders = [];        // colliders returned by physics.add.collider
  let collisionsEnabled = true;   // current toggle state

  // We will save original per-tile collision flags and physics body states to restore properly
  const originalTileState = new WeakMap(); // tile -> { collides: bool, index: number }
  let originalBodiesState = [];            // [{ body, enabled, checkCollision: {left,right,up,down} }]

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // layers that should normally collide (must match Tiled)
  const COLLISION_LAYERS = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
  ];

  // problematic indices we intentionally ignore as collidable
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // Verbose debug in console? false for prod
  const VERBOSE = false;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

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

    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // create layers (safe try/catch)
    createdLayers = {};
    map.layers.forEach(ld => {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, tilesets, 0, 0);
        if (layer) createdLayers[name] = layer;
      } catch (e) {
        console.warn("Impossible de créer la layer", name, e);
      }
    });

    // record original tile collision flags BEFORE changing anything
    recordOriginalTileCollisionState();

    // POI & spawn
    let spawnPoint = null;
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      poiLayer.objects.forEach(obj => {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();
        if (name === "spawn_avezzano" || type === "spawn") {
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
        } else {
          const title = obj.properties?.find(p=>p.name==="title")?.value || obj.name || "POI";
          const text  = obj.properties?.find(p=>p.name==="text")?.value  || "";
          const media = obj.properties?.find(p=>p.name==="media")?.value || null;
          poiData.push({ x: obj.x, y: obj.y, title, description: text, image: media });
        }
      });
    }

    if (!spawnPoint && poiLayer && Array.isArray(poiLayer.objects)) {
      spawnPoint = poiLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }
    if (!spawnPoint) {
      console.warn("⚠️ spawn_avezzano introuvable — fallback centre de la map");
      spawnPoint = { x: map.widthInPixels/2, y: map.heightInPixels/2 };
    }

    // create player
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // villes layer
    const villeLayer = map.getObjectLayer("VILLE");
    villes = [];
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      villeLayer.objects.forEach(obj => {
        const cx = obj.x + (obj.width || 0)/2;
        const cy = obj.y + (obj.height || 0)/2;
        const r = Math.max(obj.width || 0, obj.height || 0)/2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      });
    }

    // set collisions carefully (see helper)
    setupCollisions(this);

    // add colliders and store for later removal
    addLayerColliders(this);

    // optional decoration colliders
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) {}
    }

    // camera strictly centered
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // minimap
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH).setZoom(miniZoom).startFollow(player);
    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);
    playerMiniArrow.setVisible(true);

    // input
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

    // animations
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player",{start:0,end:2}), frameRate:6, repeat:-1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player",{start:3,end:5}), frameRate:6, repeat:-1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player",{start:6,end:8}), frameRate:6, repeat:-1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player",{start:9,end:11}), frameRate:6, repeat:-1 });
    this.anims.create({ key: "idle-down", frames:[{ key:"player", frame:1 }] });
    this.anims.create({ key: "idle-left", frames:[{ key:"player", frame:4 }] });
    this.anims.create({ key: "idle-right", frames:[{ key:"player", frame:7 }] });
    this.anims.create({ key: "idle-up", frames:[{ key:"player", frame:10 }] });

    // particles
    const g = this.make.graphics({ x:0, y:0, add:false });
    g.fillStyle(0xffffff,1).fillCircle(4,4,4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0, y:0, speed:{min:-40,max:40}, angle:{min:200,max:340},
      scale:{start:0.27,end:0}, alpha:{start:0.8,end:0}, lifespan:400, on:false
    });
    dustEmitter.startFollow(player, 0, -6);

    // mobile controls
    bindMobileControls();

    // intro button
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }

    // capture body states for later restore
    captureOriginalBodiesState();

    if (VERBOSE) console.log("create() done");
  } // create()

  // -------------------------------
  // UPDATE
  // -------------------------------
  function update() {
    if (!player) return;

    // Toggle collisions on D (one-shot per keydown)
    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      collisionsEnabled = !collisionsEnabled;
      if (!collisionsEnabled) {
        forceDisableAllCollisions(getScene());
        showTempDebugNotice("Collisions désactivées (D)");
      } else {
        restoreAllCollisions(getScene());
        showTempDebugNotice("Collisions réactivées (D)");
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
    if (minimapCam) {
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
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) showInteraction(currentPOI);

    // villes detection
    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }
  } // update()

  // -------------------------------
  // HELPERS - collisions / bodies
  // -------------------------------
  function recordOriginalTileCollisionState() {
    for (const layer of Object.values(createdLayers)) {
      if (!layer || !layer.forEachTile) continue;
      layer.forEachTile(tile => {
        if (!tile) return;
        const coll = !!(tile.collides || (tile.properties && tile.properties.collides));
        originalTileState.set(tile, { collides: coll, index: tile.index });
      });
    }
    if (VERBOSE) console.log("Recorded original tile states");
  }

  function setupCollisions(scene) {
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (!COLLISION_LAYERS.includes(name)) continue;

      // decide whether to use tile.properties.collides
      let usesExplicit = false;
      layer.forEachTile(tile => {
        if (!tile) return;
        if (tile.properties && tile.properties.collides) usesExplicit = true;
      });

      layer.forEachTile(tile => {
        if (!tile) return;
        const idx = tile.index;
        if (idx === -1) return;
        if (IGNORE_TILE_INDICES.includes(idx)) {
          tile.setCollision(false, false, false, false);
          return;
        }
        if (usesExplicit) {
          const should = !!tile.properties?.collides;
          tile.setCollision(should, should, should, should);
        } else {
          // default: all non-empty tiles in these layers collide
          tile.setCollision(true, true, true, true);
        }
      });
    }
    if (VERBOSE) console.log("setupCollisions applied");
  }

  function addLayerColliders(scene) {
    // remove older colliders we tracked
    for (const c of layerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    layerColliders = [];
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          const c = scene.physics.add.collider(player, layer);
          layerColliders.push(c);
        } catch (e) {
          if (VERBOSE) console.warn("addLayerColliders fail for", name, e);
        }
      }
    }
    if (VERBOSE) console.log("Layer colliders added:", layerColliders.length);
  }

  function removeLayerColliders(scene) {
    for (const c of layerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(e) {}
    }
    layerColliders = [];
    if (VERBOSE) console.log("Layer colliders removed");
  }

  function captureOriginalBodiesState() {
    originalBodiesState = [];
    try {
      const entries = (getScene().physics && getScene().physics.world && getScene().physics.world.bodies && getScene().physics.world.bodies.entries)
        ? getScene().physics.world.bodies.entries : [];
      for (const body of entries) {
        try {
          const check = body.checkCollision ? { left: !!body.checkCollision.left, right: !!body.checkCollision.right, up: !!body.checkCollision.up, down: !!body.checkCollision.down } : null;
          originalBodiesState.push({ body, enabled: !!body.enable, check });
        } catch (e) {}
      }
      if (VERBOSE) console.log("Captured bodies:", originalBodiesState.length);
    } catch (e) {
      if (VERBOSE) console.warn("captureOriginalBodiesState failed", e);
    }
  }

  // Force-disable collisions (robust): remove colliders, disable tile collisions, disable other bodies
  function forceDisableAllCollisions(scene) {
    // remove any colliders we created
    removeLayerColliders(scene);

    // disable tile collisions on collision layers
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (!COLLISION_LAYERS.includes(name)) continue;
      try {
        layer.forEachTile(tile => {
          if (!tile) return;
          try { tile.setCollision(false, false, false, false); } catch (e) {}
        });
      } catch (e) {}
    }

    // disable other physics bodies (except keep player body enabled but with checkCollision none)
    try {
      const entries = (scene.physics && scene.physics.world && scene.physics.world.bodies && scene.physics.world.bodies.entries)
        ? scene.physics.world.bodies.entries : [];
      for (const b of entries) {
        if (!b) continue;
        try {
          if (b.gameObject === player) {
            if (b.checkCollision) {
              b.checkCollision.left = false; b.checkCollision.right = false; b.checkCollision.up = false; b.checkCollision.down = false;
            }
            // keep player body enabled (so movement code using setVelocity continues)
            continue;
          }
          // disable all other bodies
          try { b.enable = false; b.enabled = false; } catch(_) {}
          try { if (b.checkCollision) { b.checkCollision.left=false; b.checkCollision.right=false; b.checkCollision.up=false; b.checkCollision.down=false; } } catch(_) {}
          try { if (b.gameObject && b.gameObject.body) b.gameObject.body.enable = false; } catch(_) {}
        } catch (e) {}
      }
    } catch (e) {
      if (VERBOSE) console.warn("forceDisableAllCollisions bodies step failed", e);
    }
    collisionsEnabled = false;
    if (VERBOSE) console.log("All collisions force-disabled");
  }

  // Restore everything to captured original states
  function restoreAllCollisions(scene) {
    // restore tile collisions per originalTileState or fallback to enabling non-empty tiles
    try {
      for (const [name, layer] of Object.entries(createdLayers)) {
        if (!layer) continue;
        if (!COLLISION_LAYERS.includes(name)) continue;
        layer.forEachTile(tile => {
          if (!tile) return;
          const orig = originalTileState.get(tile);
          if (orig) {
            if (IGNORE_TILE_INDICES.includes(orig.index)) {
              try { tile.setCollision(false, false, false, false); } catch (e) {}
            } else {
              try { tile.setCollision(!!orig.collides, !!orig.collides, !!orig.collides, !!orig.collides); } catch(e) {}
            }
          } else {
            // fallback
            if (tile.index !== -1 && !IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(true, true, true, true); } catch(e) {}
            } else {
              try { tile.setCollision(false, false, false, false); } catch(e) {}
            }
          }
        });
      }
    } catch (e) {
      if (VERBOSE) console.warn("restore tile collisions failed", e);
    }

    // restore body states
    try {
      for (const rec of originalBodiesState) {
        const b = rec.body;
        if (!b) continue;
        try { b.enable = !!rec.enabled; b.enabled = !!rec.enabled; } catch(_) {}
        try {
          if (rec.check && b.checkCollision) {
            b.checkCollision.left = !!rec.check.left;
            b.checkCollision.right = !!rec.check.right;
            b.checkCollision.up = !!rec.check.up;
            b.checkCollision.down = !!rec.check.down;
          }
        } catch(_) {}
        try { if (b.gameObject && b.gameObject.body) b.gameObject.body.enable = !!rec.enabled; } catch(_) {}
      }
    } catch (e) {
      if (VERBOSE) console.warn("restore bodies failed", e);
    }

    // re-add the colliders
    addLayerColliders(scene);

    collisionsEnabled = true;
    if (VERBOSE) console.log("Collisions restored");
  }

  // -------------------------------
  // Debug helpers / UI helpers
  // -------------------------------
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
      const wx = Math.round(player.x + c.dx), wy = Math.round(player.y + c.dy);
      let found = false;
      for (const [layerName, layer] of Object.entries(createdLayers)) {
        try {
          const tile = layer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            console.log(`  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
          } else if (tileCollides) {
            found = true;
            console.warn(`Player blocked ${c.dir} — tile index=${tile.index} layer="${layerName}" at (${tile.x},${tile.y})`);
          }
        } catch(e) {}
      }
      if (!found) {
        console.log(`(debug) faux blocage détecté ${c.dir} à (${wx},${wy}) — aucune tuile 'collides' trouvée.`);
      }
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
        background: "rgba(0,0,0,0.7)", color: "#fff", padding: "6px 12px", borderRadius: "6px", zIndex: "9999"
      });
      document.body.appendChild(e);
    }
  }
  function hidePressE() { const e=document.getElementById("pressE"); if (e) e.remove(); }

  function showInteraction(poi) {
    let imgPath = poi.image; if (imgPath && !imgPath.startsWith("images/")) imgPath = "images/" + imgPath;
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

  // -------------------------------
  // mobile controls (DOM buttons)
  // -------------------------------
  function bindMobileControls() {
    const bindButton = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => { e.preventDefault(); onDown && onDown(); };
      const end   = (e) => { e.preventDefault(); onUp && onUp();   };
      el.addEventListener("touchstart", start, { passive: false });
      el.addEventListener("touchend", end,   { passive: false });
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
  // small utilities
  // -------------------------------
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function getScene() {
    return (player && player.scene) ? player.scene : game.scene.scenes[0];
  }

  // -------------------------------
}; // window.onload end
// ======================================================
// EOF
// ======================================================
