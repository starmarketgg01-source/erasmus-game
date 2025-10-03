// ======================================================
// main_fixed_full_for_phaser_3_55_2.js
// Erasmus Game - main.js (complete, fixed, compatible Phaser v3.55.2)
// - Spawns at spawn_avezzano (fallback)
// - Proper collisions restored (Solution 2): generate collidable tiles per-layer, ignore known artifact indices
// - Prevents false blocking by small "unstick" nudge when blocked but no real colliding tile detected
// - POI interactions, city banners, minimap, mobile controls, particles, keyboard controls
// - Smooth camera follow (lerp), centered and subtle sliding
// - Debug utilities (toggleable) and safe defaults
// ======================================================

window.onload = function () {
  // ---------- Configuration ----------
  const PHASER_VERSION_NOTE = "Target Phaser v3.55.2";
  const DEBUG = false; // set true to enable verbose debug logging and debug visuals
  const UNSTICK_COOLDOWN_MS = 200; // minimum time between auto-unstick nudges
  const UNSTICK_PIXELS = 2; // small nudge amount when stuck but no colliding tile
  const POI_RADIUS = 40; // radius for POI interaction
  const DEFAULT_VILLE_RADIUS = 150;
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269]; // add any bridge/artifact indices you find
  const COLLISION_LAYER_NAMES = ["water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"];
  const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ---------- Phaser config ----------
  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: "game",
    pixelArt: false,
    physics: {
      default: "arcade",
      arcade: {
        debug: false // set true if you want physics debug lines
      }
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(config);

  // ---------- Globals ----------
  let map;
  let createdLayers = {}; // map of name -> tilemap layer
  let player;
  let cursors, shiftKey, interactionKey;
  let poiData = [], currentPOI = null;
  let villes = [], currentVille = null;
  let minimapCam, playerMiniArrow, miniFrameGfx;
  let dustEmitter;
  let interactionBox;
  let mobileInput = { up:false, down:false, left:false, right:false, run:false };
  let lastUnstickTime = 0;

  // ---------- Preload ----------
  function preload() {
    // map and tilesets (filenames per your message)
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // player and assets
    this.load.spritesheet("player", "images/characters/player.png", { frameWidth: 144, frameHeight: 144 });

    // optional audio placeholders (if you have them locally)
    this.load.audio("bgm", "audio/bgm.mp3");
    this.load.audio("sfx-open", "audio/open.mp3");
    this.load.audio("sfx-close", "audio/close.mp3");
  }

  // ---------- Create ----------
  function create() {
    // create map
    map = this.make.tilemap({ key: "map" });

    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // create layers from Tiled and store references
    createdLayers = {};
    if (Array.isArray(map.layers)) {
      map.layers.forEach(ld => {
        const name = ld.name;
        try {
          const layer = map.createLayer(name, tilesets, 0, 0);
          createdLayers[name] = layer;
        } catch (err) {
          console.warn("[main] createLayer failed for:", name, err);
        }
      });
    } else {
      console.warn("[main] map.layers is not an array - check your .tmj");
    }

    // set depths for lamp layers if they exist
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // ---------- POI & spawn ----------
    let spawnPoint = null;
    const objLayer = map.getObjectLayer("POI");
    if (objLayer && Array.isArray(objLayer.objects)) {
      objLayer.objects.forEach(obj => {
        const name = (obj.name || "").toString();
        const type = (obj.type || "").toString().toLowerCase();
        if (name.toLowerCase() === "spawn_avezzano" || type === "spawn") {
          // prefer spawn_avezzano if present
          if (!spawnPoint || name.toLowerCase() === "spawn_avezzano") spawnPoint = obj;
        } else {
          // collect POI data
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

    // fallback spawn search
    if (!spawnPoint && objLayer && Array.isArray(objLayer.objects)) {
      spawnPoint = objLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }
    if (!spawnPoint) {
      spawnPoint = { x: map.widthInPixels/2, y: map.heightInPixels/2 };
      console.warn("[main] spawn_avezzano not found, fallback to map center:", spawnPoint);
    }

    // ---------- Player ----------
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    // reduce hitbox to avoid ghost collisions on thin tiles/bridges
    if (player.body) {
      player.body.setSize(Math.round(player.width * 0.45), Math.round(player.height * 0.32));
      player.body.setOffset(Math.round(player.width * 0.28), Math.round(player.height * 0.68));
    }

    // ---------- Villes (zones) ----------
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

    // ---------- Collisions setup (Solution 2 robust) ----------
    // Strategy: For each layer in COLLISION_LAYER_NAMES:
    //  - iterate over all tiles in that layer and explicitly set collision=true for tiles which are not IGNORE indices
    //  - ensure IGNORE tile indices are explicitly set non-colliding
    // This avoids calling layer.setCollision(IGNORE, false) globally which may have corner cases depending on tileset setup.

    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (COLLISION_LAYER_NAMES.includes(name)) {
        try {
          // iterate through tile rectangle for performance: from 0..layer.width-1 etc.
          const lw = layer.layer.width;
          const lh = layer.layer.height;
          for (let ty=0; ty<lh; ty++) {
            for (let tx=0; tx<lw; tx++) {
              const tile = layer.hasTileAt(tx, ty) ? layer.getTileAt(tx, ty) : null;
              if (!tile) continue;
              // if tile index is in ignore list -> ensure no collision
              if (IGNORE_TILE_INDICES.includes(tile.index)) {
                tile.setCollision(false, false, false, false);
              } else {
                // default: set tile as colliding
                tile.setCollision(true, true, true, true);
              }
            }
          }
          if (DEBUG) console.log(`[main] collisions applied for layer "${name}" (explicit per-tile).`);
        } catch (err) {
          console.warn("[main] error setting collisions for", name, err);
        }
      }
    });

    // Add arcades colliders for those layers
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (COLLISION_LAYER_NAMES.includes(name)) {
        try {
          this.physics.add.collider(player, layer);
        } catch (err) {
          console.warn("[main] failed adding collider for layer", name, err);
        }
      }
    });

    // decorative colliders if any (lampadaire + etc.)
    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e){}
    }

    // ---------- Camera + Minimap ----------
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    // smooth follow - camera follow with lerp to achieve "slide doucement" effect centered
    this.cameras.main.startFollow(player, true, 0.08, 0.08);
    this.cameras.main.setZoom(2.5);

    // mini map
    const miniW = 220, miniH = 160;
    const miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH).setZoom(miniZoom).startFollow(player);
    if (!IS_MOBILE) {
      miniFrameGfx = this.add.graphics();
      miniFrameGfx.fillStyle(0x000000, 0.30).fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.lineStyle(2, 0xffffff, 1).strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.setScrollFactor(0).setDepth(11000);
    }

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12,12,12,6,0,0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // ---------- Inputs + DOM ----------
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

    // ---------- Animations ----------
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start:0, end:2 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start:3, end:5 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start:6, end:8 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start:9, end:11 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "idle-down", frames: [{ key:"player", frame:1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key:"player", frame:4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key:"player", frame:7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key:"player", frame:10 }] });

    // ---------- Particles ----------
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1).fillCircle(4,4,4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x: 0, y: 0, speed: { min: -40, max: 40 }, angle: { min: 200, max: 340},
      scale: { start:0.27, end:0 }, alpha: { start:0.8, end:0 }, lifespan:400, on:false
    });
    dustEmitter.startFollow(player, 0, -6);

    // ---------- Mobile controls ----------
    bindMobileControls();

    // ---------- Intro / music ----------
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }
  } // end create

  // ---------- Update ----------
  function update(time, delta) {
    if (!player) return;
    const isRunning = (shiftKey && shiftKey.isDown) || mobileInput.run;
    const speed = isRunning ? 150 : 70;
    let vx = 0, vy = 0;

    if (!IS_MOBILE) {
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
        const dir = player.anims.currentAnim.key;
        if (["up","down","left","right"].includes(dir)) player.anims.play("idle-" + dir, true);
      }
    }

    player.setDepth(player.y);
    dustEmitter.on = isRunning && (Math.abs(vx) > 1 || Math.abs(vy) > 1);

    // minimap arrow update
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
      if (d < POI_RADIUS) { currentPOI = poi; if (!IS_MOBILE) showPressE(); break; }
    }
    if (!currentPOI && !IS_MOBILE) hidePressE();
    if (!IS_MOBILE && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) showInteraction(currentPOI);

    // Villes detection
    let inVille = null;
    for (const v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // debug & unstuck handling
    debugCheckBlockingAndMaybeUnstick();
  }

  // ---------- Helpers ----------
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
  function hidePressE() { const el = document.getElementById("pressE"); if (el) el.remove(); }

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

  // ---------- Debug check + auto-unstick ----------
  function debugCheckBlockingAndMaybeUnstick() {
    if (!player || !player.body) return;

    const b = player.body;
    if (!(b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down)) return;

    // for each blocked direction, examine tiles at small offset and determine if any real collidable tile exists
    const checks = [
      { dir: "left", dx: -Math.max(8, Math.round(player.width*0.25)), dy: 0 },
      { dir: "right", dx: Math.max(8, Math.round(player.width*0.25)), dy: 0 },
      { dir: "up", dx: 0, dy: -Math.max(8, Math.round(player.height*0.25)) },
      { dir: "down", dx: 0, dy: Math.max(8, Math.round(player.height*0.25)) }
    ];

    for (const c of checks) {
      if (!b.blocked[c.dir]) continue;
      const wx = player.x + c.dx;
      const wy = player.y + c.dy;
      // search for any tile with collides=true and not in IGNORE list
      let foundRealBlocking = false;
      for (const [layerName, layer] of Object.entries(createdLayers)) {
        try {
          const tile = layer.getTileAtWorldXY(wx, wy, true);
          if (!tile || tile.index === -1) continue;
          const tileCollides = tile.collides || (tile.properties && tile.properties.collides) || false;
          if (IGNORE_TILE_INDICES.includes(tile.index)) {
            if (DEBUG) console.log(`[main] ignored tile index=${tile.index} on layer "${layerName}" at (${tile.x},${tile.y})`);
            continue;
          } else if (tileCollides) {
            foundRealBlocking = true;
            if (DEBUG) console.log(`[main] real blocking tile index=${tile.index} on layer "${layerName}" at (${tile.x},${tile.y})`);
            break;
          }
        } catch (err) {
          // some layers aren't tile layers; skip silently
        }
      }

      if (!foundRealBlocking) {
        // false positive: apply a tiny nudge in the blocked direction to unstuck the player
        const now = Date.now();
        if (now - lastUnstickTime > UNSTICK_COOLDOWN_MS) {
          lastUnstickTime = now;
          if (c.dir === "down") player.y += UNSTICK_PIXELS;
          else if (c.dir === "up") player.y -= UNSTICK_PIXELS;
          else if (c.dir === "left") player.x -= UNSTICK_PIXELS;
          else if (c.dir === "right") player.x += UNSTICK_PIXELS;
          // after nudging, update body position to match new x/y
          if (player.body) {
            player.body.reset(player.x - player.body.width * player.originX, player.y - player.body.height * (1 - player.originY));
          }
          if (DEBUG) console.log(`[main] applied unstuck nudge ${c.dir} at (${Math.round(wx)},${Math.round(wy)})`);
        }
      } else {
        // found real blocking - log for debugging
        if (DEBUG) console.warn(`[main] Player blocked ${c.dir} — real colliding tile exists at approx (${Math.round(wx)},${Math.round(wy)})`);
      }
    }
  }

  // ---------- Mobile controls binding ----------
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
      eBtn.addEventListener("touchstart", tap, { passive: false });
      eBtn.addEventListener("mousedown", tap);
    }
  }

  // ---------- End ----------
}; // end window.onload
