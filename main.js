// ======================================================
// main_fixed_erasmus_full.js
// Erasmus — corrected full main.js
// - Ensures spawn_avezzano is always preferred (mobile + desktop)
// - Robust God Mode toggle (key D + mobile button) that truly disables collisions
// - Re-creates collisions correctly when toggling back on
// - Reduced hitbox on mobile to avoid invisible blocking
// - Debug utilities to show colliding tiles around player (toggle L)
// - Mobile-friendly: creates god button automatically if absent
// - Keep as a drop-in replacement for your previous main.js
// ======================================================

window.onload = function () {
  // -------------------------------
  // CONFIG
  // -------------------------------
  const CONFIG = {
    CAMERA_ZOOM: 2.5,
    MINIMAP_W: 220,
    MINIMAP_H: 160,
    MINIMAP_Z: 0.22,
    PLAYER_SCALE: 0.20,
    IGNORE_TILE_INDICES: [809, 1341, 2268, 2269], // add more if you find them
    COLLISION_LAYERS: ["water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"],
    POI_RADIUS: 40,
    DEFAULT_VILLE_RADIUS: 150,
    MOBILE_HITBOX_SCALE: 0.30, // smaller on mobile to reduce ghost collisions
    DESKTOP_HITBOX_SCALE: 0.45,
    VERBOSE: false // set to true to get extensive console logs
  };

  // -------------------------------
  // GLOBALS
  // -------------------------------
  let map = null;
  let player = null;
  let createdLayers = {};
  let layerColliders = []; // colliders created between player and tile layers
  let objectLayerColliders = []; // colliders created from object layers (if any)
  let poiData = [];
  let villes = [];
  let currentPOI = null;
  let currentVille = null;
  let interactionBox = null;
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let collisionsEnabled = true;
  let debugDrawTiles = false;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // input keys (will be set in create)
  let cursors, shiftKey, interactionKey, toggleCollisionsKey, debugTilesKey;

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
    // Map & tilesets
    map = this.make.tilemap({ key: "map" });
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    // create layers
    createdLayers = {};
    for (const ld of map.layers) {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, tilesets, 0, 0);
        if (layer) {
          createdLayers[name] = layer;
          if (CONFIG.VERBOSE) console.log("Created layer:", name);
        }
      } catch (err) {
        console.warn("Layer create failed:", name, err);
      }
    }

    // adjust decorative depths if present
    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // OBJECT LAYERS: POI + spawn detection
    const poiLayer = map.getObjectLayer("POI");
    let spawnPoint = null;
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      // prefer spawn_avezzano explicitly (case-insensitive)
      for (const obj of poiLayer.objects) {
        if ((obj.name || "").toLowerCase() === "spawn_avezzano") {
          spawnPoint = obj;
          break;
        }
      }
      // if not found exactly spawn_avezzano, look for any object of type 'spawn' or name containing 'spawn'
      if (!spawnPoint) {
        for (const obj of poiLayer.objects) {
          if ((obj.type || "").toLowerCase() === "spawn" || (obj.name || "").toLowerCase().includes("spawn")) {
            spawnPoint = obj;
            break;
          }
        }
      }
      // collect POIs
      for (const obj of poiLayer.objects) {
        const name = obj.name || "";
        const type = (obj.type || "").toLowerCase();
        if ((name || "").toLowerCase() === "spawn_avezzano") continue; // skip spawn
        if (type === "spawn") continue; // skip generic spawn
        poiData.push({
          x: obj.x,
          y: obj.y,
          title: obj.properties?.find(p=>p.name==='title')?.value || obj.name || "POI",
          description: obj.properties?.find(p=>p.name==='text')?.value || "",
          image: obj.properties?.find(p=>p.name==='media')?.value || null
        });
      }
    }

    // final fallback if no spawn found
    if (!spawnPoint) {
      console.warn("spawn_avezzano not found — falling back to map center");
      spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
    }

    // Create player at spawn_avezzano (ensures mobile uses same)
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(CONFIG.PLAYER_SCALE);
    player.setCollideWorldBounds(true);

    // Hitbox reduction: smaller on mobile to avoid invisible-blocks
    if (player.body) {
      const scale = isMobile ? CONFIG.MOBILE_HITBOX_SCALE : CONFIG.DESKTOP_HITBOX_SCALE;
      const w = player.width * scale;
      const h = player.height * (isMobile ? 0.28 : 0.32);
      const ox = Math.round((player.width - w) / 2);
      const oy = Math.round(player.height - h);
      player.body.setSize(w, h);
      player.body.setOffset(ox, oy);
      if (CONFIG.VERBOSE) console.log("Player hitbox set:", w, h, ox, oy);
    }

    // VILLE zones
    const villeLayer = map.getObjectLayer("VILLE");
    villes = [];
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      for (const obj of villeLayer.objects) {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || CONFIG.DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      }
    }

    // COLLISIONS: mark collidable layers and remove IGNORE indices
    setupCollisions(this);

    // Add colliders between player and collidable layers
    addLayerColliders(this);

    // If there are object-based collision shapes (some authors use this), try binding them too
    // We'll search object layers named 'COLLISION' or 'collision' and create static bodies for them (best-effort)
    tryAttachObjectColliders(this);

    // Camera (strict center as requested)
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(CONFIG.CAMERA_ZOOM);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Minimap
    minimapCam = this.cameras.add(window.innerWidth - CONFIG.MINIMAP_W - 12, 12, CONFIG.MINIMAP_W, CONFIG.MINIMAP_H);
    minimapCam.setZoom(CONFIG.MINIMAP_Z).startFollow(player);
    playerMiniArrow = this.add.triangle(minimapCam.x + CONFIG.MINIMAP_W/2, minimapCam.y + CONFIG.MINIMAP_H/2, 0,12,12,12,6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // Particles (dust)
    const g = this.make.graphics({ x:0,y:0,add:false });
    g.fillStyle(0xffffff,1).fillCircle(4,4,4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0,y:0, speed:{min:-40,max:40}, angle:{min:200,max:340},
      scale:{start:0.27,end:0}, alpha:{start:0.8,end:0}, lifespan:400, on:false
    });
    dustEmitter.startFollow(player, 0, -6);

    // Inputs & keys
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    toggleCollisionsKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    debugTilesKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L); // press L to draw debug colliding tiles

    // Interaction box DOM
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
    this.anims.create({ key:"down", frames:this.anims.generateFrameNumbers("player",{start:0,end:2}), frameRate:6, repeat:-1 });
    this.anims.create({ key:"left", frames:this.anims.generateFrameNumbers("player",{start:3,end:5}), frameRate:6, repeat:-1 });
    this.anims.create({ key:"right", frames:this.anims.generateFrameNumbers("player",{start:6,end:8}), frameRate:6, repeat:-1 });
    this.anims.create({ key:"up", frames:this.anims.generateFrameNumbers("player",{start:9,end:11}), frameRate:6, repeat:-1 });
    this.anims.create({ key:"idle-down", frames:[{key:"player",frame:1}] });
    this.anims.create({ key:"idle-left", frames:[{key:"player",frame:4}] });
    this.anims.create({ key:"idle-right", frames:[{key:"player",frame:7}] });
    this.anims.create({ key:"idle-up", frames:[{key:"player",frame:10}] });

    // Mobile controls binding + spawn forced to avezzano already
    bindMobileControls();

    // Ensure mobile has a god-mode button
    createMobileGodButton();

    // Intro button usage (optional)
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }

    // Optional: draw a debug rectangle representing player's body for mobile debugging
    if (CONFIG.VERBOSE) createPlayerDebugBox(this);
  } // end create()

  // -------------------------------
  // UPDATE
  // -------------------------------
  function update() {
    if (!player) return;

    // Toggle collisions/god-mode by D key
    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      toggleGodMode(this);
    }

    // Toggle debug tile drawing
    if (Phaser.Input.Keyboard.JustDown(debugTilesKey)) {
      debugDrawTiles = !debugDrawTiles;
      if (!debugDrawTiles) clearDebugTileGraphics(this);
      else drawDebugTileGraphics(this);
      showTempNotice("Debug tiles " + (debugDrawTiles ? "ON" : "OFF"));
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
        const key = player.anims.currentAnim.key;
        if (["up","down","left","right"].includes(key)) player.anims.play("idle-" + key, true);
      }
    }

    player.setDepth(player.y);
    dustEmitter.on = isRunning && (Math.abs(vx) > 1 || Math.abs(vy) > 1);

    // update minimap arrow rotation + position
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
      if (d < CONFIG.POI_RADIUS) {
        currentPOI = poi;
        if (!isMobile) showPressE();
        break;
      }
    }
    if (!currentPOI && !isMobile) hidePressE();
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) showInteraction(currentPOI);

    // Villes detection (show banner)
    let inVille = null;
    for (const v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    // draw debug tile overlay near player if enabled
    if (debugDrawTiles) drawDebugTileGraphics(this);
  }

  // -------------------------------
  // HELPERS
  // -------------------------------
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) player.anims.play(key, true);
    player.anims.timeScale = isRunning ? 2 : 1;
  }

  function showPressE() {
    if (document.getElementById("pressE")) return;
    const e = document.createElement("div");
    e.id = "pressE"; e.innerText = "Appuie sur E";
    Object.assign(e.style, { position:"absolute", top:"20px", left:"50%", transform:"translateX(-50%)", background:"rgba(0,0,0,0.7)", color:"#fff", padding:"6px 12px", borderRadius:"6px", zIndex:99999 });
    document.body.appendChild(e);
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
    setTimeout(()=>{
      banner.innerText = name;
      banner.classList.add("show");
      overlay.classList.remove("active");
      setTimeout(()=>banner.classList.remove("show"), 4000);
    }, 420);
  }

  // -------------------------------
  // COLLISIONS MANAGEMENT
  // -------------------------------
  function setupCollisions(scene) {
    // Mark collision tiles for configured layers, but remove problematic indices
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (!CONFIG.COLLISION_LAYERS.includes(name)) continue;
      try {
        layer.setCollisionByExclusion([-1]);
        // disable specific indices on this layer
        try { layer.setCollision(CONFIG.IGNORE_TILE_INDICES, false, true); } catch(e) { /* ignore */ }
        layer.forEachTile(tile => {
          if (tile && CONFIG.IGNORE_TILE_INDICES.includes(tile.index)) {
            try { tile.setCollision(false, false, false, false); } catch(e) {}
          }
        });
        if (CONFIG.VERBOSE) console.log("Collision setup on layer:", name);
      } catch (err) {
        console.warn("Error setting collisions on", name, err);
      }
    }
  }

  function addLayerColliders(scene) {
    // remove old colliders first
    removeLayerColliders(scene);
    layerColliders = [];
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (!CONFIG.COLLISION_LAYERS.includes(name)) continue;
      try {
        const c = scene.physics.add.collider(player, layer);
        if (c) layerColliders.push(c);
      } catch (err) {
        if (CONFIG.VERBOSE) console.warn("Failed to add collider for layer", name, err);
      }
    }
  }

  function removeLayerColliders(scene) {
    for (const c of layerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(_) {}
    }
    layerColliders = [];
  }

  function disableCollisions(scene) {
    // remove colliders and set tiles to non-colliding
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (!CONFIG.COLLISION_LAYERS.includes(name)) continue;
      try {
        // mark layer tiles non-colliding
        try { layer.setCollisionByExclusion([-1], false); } catch(e) {} // may not be supported in some versions
        layer.forEachTile(tile => { try { if (tile) tile.setCollision(false, false, false, false); } catch(e){} });
      } catch (err) {
        if (CONFIG.VERBOSE) console.warn("disableCollisions error on layer", name, err);
      }
    }
    removeLayerColliders(scene);

    // Also set player's checkCollision to none so it truly ignores remaining colliders
    if (player && player.body) {
      if (player.body.checkCollision) {
        player.body.checkCollision.none = true;
      } else {
        // older versions: set all sides false
        try { player.body.checkCollision = { up:false, down:false, left:false, right:false }; } catch(e) {}
      }
    }

    // Also remove object layer colliders if any
    for (const c of objectLayerColliders) {
      try { scene.physics.world.removeCollider(c); } catch(_) {}
    }
    objectLayerColliders = [];
  }

  function enableCollisions(scene) {
    // restore tile flags and recreate colliders
    setupCollisions(scene);
    addLayerColliders(scene);

    // re-enable player's checkCollision
    if (player && player.body) {
      if (player.body.checkCollision) player.body.checkCollision.none = false;
      else try { player.body.checkCollision = { up:true, down:true, left:true, right:true }; } catch(e) {}
    }

    // reattach object colliders if needed
    tryAttachObjectColliders(scene);
  }

  // Toggle god mode helper
  function toggleGodMode(scene) {
    collisionsEnabled = !collisionsEnabled;
    if (!collisionsEnabled) {
      disableCollisions(scene);
      setMobileGodButtonState(true);
      showTempNotice("God Mode ON (collisions disabled)");
      if (CONFIG.VERBOSE) console.log("God Mode ON: collisions disabled");
    } else {
      enableCollisions(scene);
      setMobileGodButtonState(false);
      showTempNotice("God Mode OFF (collisions enabled)");
      if (CONFIG.VERBOSE) console.log("God Mode OFF: collisions enabled");
    }
  }

  // -------------------------------
  // Try to attach object layer rectangles (if author used objects for collisions)
  // -------------------------------
  function tryAttachObjectColliders(scene) {
    // find candidate object layers
    for (const olName of Object.keys(map.objects || {})) {
      const ol = map.objects[olName];
      // 'map.objects' structure can vary - use getObjectLayer instead
    }
    // use getObjectLayer API safely
    for (const mlName of map.objects ? Object.keys(map.objects) : []) {
      // skip - deprecated path
    }
    // Preferred: check known object layer names
    const candidateNames = ["collision", "COLLISION", "Collisions", "collisions"];
    for (const cn of candidateNames) {
      const objLayer = map.getObjectLayer(cn);
      if (!objLayer || !Array.isArray(objLayer.objects)) continue;
      // create static group shapes from rectangles
      const bodies = thisAddStaticObjectsFromLayer(scene, objLayer);
      for (const b of bodies) {
        try {
          const c = scene.physics.add.collider(player, b);
          if (c) objectLayerColliders.push(c);
        } catch(e) {}
      }
    }

    // Also check any object layer with rectangle objects and not named COLLISION
    for (const ol of map.objects || []) {
      // "map.objects" sometimes not an object by name; skip - we already attempted known names
    }
  }

  function thisAddStaticObjectsFromLayer(scene, objLayer) {
    const created = [];
    for (const obj of objLayer.objects) {
      if (obj.rectangle || obj.width || obj.height) {
        const x = obj.x + (obj.width || 0) / 2;
        const y = obj.y + (obj.height || 0) / 2;
        const w = obj.width || 0;
        const h = obj.height || 0;
        try {
          const g = scene.add.rectangle(x, y, w, h).setOrigin(0.5, 0.5).setVisible(false);
          scene.physics.add.existing(g, true);
          created.push(g);
        } catch(e) {
          if (CONFIG.VERBOSE) console.warn("object collider create error", e);
        }
      }
    }
    return created;
  }

  // -------------------------------
  // Debug drawing (highlight tiles that would collide)
  // -------------------------------
  let debugTileGraphics = null;
  function drawDebugTileGraphics(scene) {
    if (!scene || !player) return;
    if (!debugTileGraphics) {
      debugTileGraphics = scene.add.graphics();
      debugTileGraphics.setScrollFactor(0);
      debugTileGraphics.setDepth(12000);
    }
    debugTileGraphics.clear();
    const radiusPx = 64;
    const startX = player.x - radiusPx;
    const startY = player.y - radiusPx;
    const endX = player.x + radiusPx;
    const endY = player.y + radiusPx;
    for (const [layerName, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      try {
        const tileW = layer.tilemap.tileWidth;
        const tileH = layer.tilemap.tileHeight;
        const x0 = Math.floor(startX / tileW) * tileW;
        const y0 = Math.floor(startY / tileH) * tileH;
        for (let tx = x0; tx <= endX; tx += tileW) {
          for (let ty = y0; ty <= endY; ty += tileH) {
            const tile = layer.getTileAtWorldXY(tx + tileW/2, ty + tileH/2, true);
            if (tile && tile.index !== -1) {
              const collides = tile.collides || (tile.properties && tile.properties.collides) || false;
              if (collides && !CONFIG.IGNORE_TILE_INDICES.includes(tile.index)) {
                // draw red box on screen at tile's world position
                debugTileGraphics.lineStyle(2, 0xff0000, 0.9);
                const screenX = tile.pixelX - scene.cameras.main.worldView.x;
                const screenY = tile.pixelY - scene.cameras.main.worldView.y;
                debugTileGraphics.strokeRect(screenX, screenY, tileW, tileH);
              } else if (CONFIG.IGNORE_TILE_INDICES.includes(tile.index)) {
                debugTileGraphics.lineStyle(1, 0xffff00, 0.6);
                const screenX = tile.pixelX - scene.cameras.main.worldView.x;
                const screenY = tile.pixelY - scene.cameras.main.worldView.y;
                debugTileGraphics.strokeRect(screenX, screenY, tileW, tileH);
              }
            }
          }
        }
      } catch(e){}
    }
  }
  function clearDebugTileGraphics(scene) {
    if (debugTileGraphics) debugTileGraphics.clear();
  }

  // -------------------------------
  // Mobile controls binding
  // -------------------------------
  function bindMobileControls() {
    const bindButton = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = e => { e.preventDefault(); onDown && onDown(); };
      const end = e => { e.preventDefault(); onUp && onUp(); };
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
      const tap = evt => { evt.preventDefault(); if (currentPOI) showInteraction(currentPOI); };
      eBtn.addEventListener("touchstart", tap, { passive:false });
      eBtn.addEventListener("mousedown", tap);
    }
  }

  // -------------------------------
  // Mobile God button creation
  // -------------------------------
  function createMobileGodButton() {
    let btn = document.getElementById("btn-godmode");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btn-godmode";
      btn.innerText = "GOD";
      Object.assign(btn.style, {
        position:"fixed", left:"12px", bottom:"12px", zIndex:99999, padding:"10px 14px", borderRadius:"8px",
        background:"rgba(0,0,0,0.6)", color:"#fff", border:"1px solid rgba(255,255,255,0.12)"
      });
      document.body.appendChild(btn);
    }
    const toggle = (e)=>{ e.preventDefault(); toggleGodMode(getScene()); };
    btn.addEventListener("touchstart", toggle, { passive:false });
    btn.addEventListener("mousedown", toggle);
    setMobileGodButtonState(!collisionsEnabled); // reflect current state
  }

  function setMobileGodButtonState(active) {
    const btn = document.getElementById("btn-godmode");
    if (!btn) return;
    if (active) {
      btn.style.background = "rgba(200,0,0,0.9)";
      btn.style.color = "#fff";
    } else {
      btn.style.background = "rgba(0,0,0,0.6)";
      btn.style.color = "#fff";
    }
  }

  // -------------------------------
  // Player debug box (optional) - shows hitbox visually
  // -------------------------------
  let playerDebugRect = null;
  function createPlayerDebugBox(scene) {
    if (playerDebugRect) return;
    playerDebugRect = scene.add.graphics().setDepth(12001);
    scene.events.on("postupdate", () => {
      if (!player || !player.body) return;
      playerDebugRect.clear();
      const bx = player.body.x - scene.cameras.main.worldView.x;
      const by = player.body.y - scene.cameras.main.worldView.y;
      playerDebugRect.lineStyle(1, 0x00ff00, 0.9);
      playerDebugRect.strokeRect(bx, by, player.body.width, player.body.height);
    });
  }

  // -------------------------------
  // Small UI helper: temporary on-screen notice
  // -------------------------------
  function showTempNotice(text, ms=1000) {
    let el = document.getElementById("tmp-notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "tmp-notice";
      Object.assign(el.style, { position:"fixed", right:"12px", top:"12px", background:"rgba(0,0,0,0.8)", color:"#fff", padding:"8px 12px", borderRadius:"6px", zIndex:99999 });
      document.body.appendChild(el);
    }
    el.innerText = text;
    el.style.display = "block";
    setTimeout(()=>{ el.style.display = "none"; }, ms);
  }

  // -------------------------------
  // Utilities
  // -------------------------------
  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, function (m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; });
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function getScene() { return (player && player.scene) ? player.scene : (window._phaser_game && window._phaser_game.scene ? window._phaser_game.scene.scenes[0] : null); }

  // -------------------------------
  // Expose small helper for console debugging (optional)
  // -------------------------------
  window._erasmusDebug = {
    toggleGod: () => { toggleGodMode(getScene()); },
    enableCollisions: () => { collisionsEnabled = true; enableCollisions(getScene()); },
    disableCollisions: () => { collisionsEnabled = false; disableCollisions(getScene()); },
    drawDebugTiles: (on) => { debugDrawTiles = !!on; if (!on) clearDebugTileGraphics(getScene()); }
  };

  // -------------------------------
  // End window.onload
  // -------------------------------
}; // end window.onload

// ======================================================
// End of main_fixed_erasmus_full.js
// ======================================================
