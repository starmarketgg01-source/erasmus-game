// ======================================================
// main.js - Erasmus Game (complete, corrected)
// - Loads erasmus.tmj and tilesets (tileset_part1/2/3.png.png)
// - Spawns player at spawn_avezzano (fallback if missing)
// - POI interactions (E key + mobile button)
// - City banners when entering VILLE object zones
// - Collision fixes: ignores false colliding tile indices and avoids phantom blocking
// - Reduced player hitbox to avoid ghost collisions on thin bridges/paths
// - Minimap, particles, mobile D-pad, and debug utilities
// - Drop-in replacement for your previous main.js
// ======================================================

window.onload = function () {
  // -------------------------------
  // CONFIG
  // -------------------------------
  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: "game", // matches your HTML div id="game"
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
  let map, player;
  let cursors, shiftKey, interactionKey;
  let minimapCam, playerMiniArrow, miniFrameGfx;
  let dustEmitter;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up: false, down: false, left: false, right: false, run: false };

  // Layers + collision configuration
  let createdLayers = {};
  const collisionLayers = ["water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"];

  // If you saw tile indices in logs that looked like bridge tiles, add them here to IGNORE them
  // Common indices from your logs: 809, 1341, 2268, 2269. Add any others you find.
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // POI and city radii
  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // optional audio (if present)
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

    // add tilesets (names must match what Tiled uses)
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // create layers and store references
    createdLayers = {};
    map.layers.forEach(ld => {
      const name = ld.name;
      try {
        // createLayer might fail if referenced tileset not found; wrap safely
        const layer = map.createLayer(name, tilesets, 0, 0);
        createdLayers[name] = layer;
      } catch (e) {
        console.warn("Impossible de créer la layer", name, e);
      }
    });

    // depth tweak for lampadaire layers if exist
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // -------------------------------
    // OBJECTS: POI + spawn
    // -------------------------------
    let spawnPoint = null;
    const poiObjLayer = map.getObjectLayer("POI"); // you used "POI" in earlier code
    if (poiObjLayer && Array.isArray(poiObjLayer.objects)) {
      poiObjLayer.objects.forEach(obj => {
        const name = obj.name || "";
        const type = (obj.type || "").toLowerCase();
        if (name.toLowerCase() === "spawn_avezzano" || type === "spawn") {
          // prefer spawn_avezzano if available
          if (!spawnPoint || name.toLowerCase() === "spawn_avezzano") spawnPoint = obj;
        } else {
          poiData.push({
            x: obj.x,
            y: obj.y,
            title: obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI",
            description: obj.properties?.find(p => p.name === "text")?.value || "",
            image: obj.properties?.find(p => p.name === "media")?.value || null
          });
        }
      });
    }

    // fallback search for any spawn named with 'spawn'
    if (!spawnPoint && poiObjLayer && Array.isArray(poiObjLayer.objects)) {
      spawnPoint = poiObjLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }

    // fallback if still not found
    if (!spawnPoint) {
      console.warn("⚠️ spawn_avezzano introuvable — fallback en centre de la map");
      spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
    }

    // create player at spawn
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // reduce hitbox (important to prevent ghost collisions on thin tiles)
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // -------------------------------
    // VILLE object layer -> create city zones
    // -------------------------------
    const villeLayer = map.getObjectLayer("VILLE");
    villes = [];
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      villeLayer.objects.forEach(obj => {
        // use object center for zone
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      });
    }

    // -------------------------------
    // COLLISIONS: set up collidable layers and clear annoying tile indices
    // -------------------------------
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (collisionLayers.includes(name)) {
        try {
          // default: set all non-empty tiles as colliding
          layer.setCollisionByExclusion([-1]);
          // remove collisions for specific indices we know cause issues
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e) {}
          // also clear collision flags per tile (safe cleanup)
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              tile.setCollision(false, false, false, false);
            }
          });
        } catch (err) {
          console.warn("Erreur en réglant collisions pour", name, err);
        }
      }
    });

    // add colliders
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (collisionLayers.includes(name)) {
        try { this.physics.add.collider(player, layer); } catch(e) { /* ignore */ }
      }
    });

    // decorative colliders (lampadaire+ bancs)
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) {}
    }

    // -------------------------------
    // CAMERA + MINIMAP
    // -------------------------------
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH).setZoom(miniZoom).startFollow(player);

    if (!isMobile) {
      miniFrameGfx = this.add.graphics();
      miniFrameGfx.fillStyle(0x000000, 0.30).fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.lineStyle(2, 0xffffff, 1).strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.setScrollFactor(0).setDepth(11000);
    } else {
      miniFrameGfx = null;
    }

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW / 2, minimapCam.y + miniH / 2, 0, 12, 12, 12, 6, 0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // -------------------------------
    // Controls & DOM references
    // -------------------------------
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

    // -------------------------------
    // Animations
    // -------------------------------
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 6, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 6, repeat: -1 });
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
    // Mobile control bindings
    // -------------------------------
    bindMobileControls();

    // Intro button (if present)
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

    // set velocity (Phaser Arcade)
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

    // update minimap arrow
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

    // Villes detection - show banner when entering
    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // check for blocking tiles - improved logic that avoids false positives
    debugCheckBlocking();
  }

  // -------------------------------
  // HELPERS
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
    let imgPath = poi.image; if (imgPath && !imgPath.startsWith("images/")) imgPath = "images/" + imgPath;
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

  // Banner + fade overlay
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
  // DEBUG: improved blocking detection
  // If a blocked direction has NO colliding tiles, we consider it a "false" block
  // and we "nudge" the player slightly so they can continue moving.
  // -------------------------------
  function debugCheckBlocking() {
    if (!player || !player.body) return;
    const b = player.body;

    // only act if blocked on any side
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

      // look for ANY tile that is actually collidable (and NOT in IGNORE list)
      const realBlocking = [];
      for (const [layerName, tLayer] of Object.entries(createdLayers)) {
        try {
          const tile = tLayer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          // determine if tile is collidable: Phaser stores tile.collides OR tile.properties.collides
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            // it's an ignored index -> log for info but don't treat as blocking
            console.log(`  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y}) (IGNORED)`);
          } else if (tileCollides) {
            realBlocking.push({ layerName, tile });
          }
        } catch (err) {
          // layer might not be tile layer; ignore errors
        }
      }

      if (realBlocking.length > 0) {
        console.warn(`⚠️ Player blocked ${c.dir} — check (${Math.round(wx)}, ${Math.round(wy)})`);
        for (const binfo of realBlocking) {
          const t = binfo.tile;
          console.log(`    → blocking on layer "${binfo.layerName}" tile index=${t.index} at (${t.x},${t.y})`, t.properties || {});
        }
      } else {
        // no real blocking tiles found -> this is probably a physics/floating point false positive
        console.log(`(debug) faux blocage détecté ${c.dir} à (${Math.round(wx)}, ${Math.round(wy)}) — aucune tuile collidable trouvée. Autorisation de passage.`);
        // Nudge player slightly to escape phantom block and clear the blocked flag so movement continues smoothly.
        // Small nudge values; adjust if necessary.
        const NUDGE = 2;
        if (c.dir === "up") player.y -= NUDGE;
        if (c.dir === "down") player.y += NUDGE;
        if (c.dir === "left") player.x -= NUDGE;
        if (c.dir === "right") player.x += NUDGE;
        // Clear blocked flag for this direction
        try { b.blocked[c.dir] = false; } catch(_) {}
      }
    }
  }

  // -------------------------------
  // MOBILE CONTROLS (D-pad + action buttons)
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
  // End window.onload
  // -------------------------------
}; // window.onload end

// ======================================================
// End of main.js
// ======================================================
