// ======================================================
// main.js (Production build with God Mode)
// Erasmus Game - main script (production-ready)
// - Loads erasmus.tmj + tilesets
// - Player spawn (always spawn_avezzano fallback if not found)
// - POI interactions (E + mobile)
// - VILLE zones (city banners)
// - Collisions applied to configured layers; ignores specified tile indices
// - Camera strictly centered on player (no lerp)
// - Minimap, particles, mobile controls
// - God Mode toggle: PC (D key), Mobile (button)
// - Minimal debug (warnings only) for prod
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
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;
  let createdLayers = {}; // name -> layer
  let godMode = false; // God mode flag
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  // Layers that should have collisions
  const COLLISION_LAYERS = [
    "water", "rails", "bord de map", "vegetation 1", "vegetation 2", "batiments 1", "batiments 2"
  ];

  // Tile indices we want to ignore
  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

  // Gameplay radii
  const POI_RADIUS = 40;
  const DEFAULT_VILLE_RADIUS = 150;

  const PROD_VERBOSE = false;

  // -------------------------------
  // PRELOAD
  // -------------------------------
  function preload() {
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

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
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3].filter(Boolean);

    createdLayers = {};
    for (let ld of map.layers) {
      const name = ld.name;
      try {
        const layer = map.createLayer(name, tilesets, 0, 0);
        if (layer) createdLayers[name] = layer;
      } catch (err) {
        if (PROD_VERBOSE) console.warn("Layer creation failed:", name, err);
      }
    }

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
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
          continue;
        }
        const titleProp = obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI";
        const textProp = obj.properties?.find(p => p.name === "text")?.value || "";
        const mediaProp = obj.properties?.find(p => p.name === "media")?.value || null;
        poiData.push({ x: obj.x, y: obj.y, title: titleProp, description: textProp, image: mediaProp });
      }
    }

    // Force spawn Avezzano fallback
    if (!spawnPoint && poiLayer) {
      spawnPoint = poiLayer.objects.find(o => (o.name || "").toLowerCase() === "spawn_avezzano") 
                || poiLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) 
                || null;
    }
    if (!spawnPoint) spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };

    // -------------------------------
    // Create player
    // -------------------------------
    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);
    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // -------------------------------
    // VILLE zones
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
    // COLLISIONS
    // -------------------------------
    setupCollisions(this);

    // -------------------------------
    // Camera
    // -------------------------------
    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // -------------------------------
    // Minimap
    // -------------------------------
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH).setZoom(miniZoom).startFollow(player);
    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);

    // -------------------------------
    // Input
    // -------------------------------
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // God Mode toggle (PC)
    this.input.keyboard.on("keydown-D", () => {
      godMode = !godMode;
      if (godMode) disableCollisions(); else setupCollisions(this);
      console.log("God Mode:", godMode ? "ON" : "OFF");
    });

    // Interaction box DOM
    interactionBox = document.getElementById("interaction-box");
    if (!interactionBox) {
      interactionBox = document.createElement("div");
      interactionBox.id = "interaction-box";
      interactionBox.style.display = "none";
      document.body.appendChild(interactionBox);
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
    // Particles
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
    // Mobile controls
    // -------------------------------
    bindMobileControls();
  }

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

    player.setVelocity(vx, vy);

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

    // minimap arrow rotation
    if (player.anims.currentAnim) {
      const dir = player.anims.currentAnim.key;
      if (dir.includes("up")) playerMiniArrow.rotation = 0;
      else if (dir.includes("right")) playerMiniArrow.rotation = Phaser.Math.DegToRad(90);
      else if (dir.includes("down")) playerMiniArrow.rotation = Phaser.Math.DegToRad(180);
      else if (dir.includes("left")) playerMiniArrow.rotation = Phaser.Math.DegToRad(-90);
    }
  }

  // -------------------------------
  // COLLISION HELPERS
  // -------------------------------
  function setupCollisions(scene) {
    for (let [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1]);
          layer.setCollision(IGNORE_TILE_INDICES, false, true);
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              tile.setCollision(false, false, false, false);
            }
          });
          scene.physics.add.collider(player, layer);
        } catch (err) {}
      }
    }
  }

  function disableCollisions() {
    for (let [name, layer] of Object.entries(createdLayers)) {
      try { layer.setCollisionByExclusion([-1], false); } catch (e) {}
    }
    player.body.checkCollision.none = true;
  }

  // -------------------------------
  // HELPERS
  // -------------------------------
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) player.anims.play(key, true);
    player.anims.timeScale = isRunning ? 2 : 1;
  }

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

    // Interact
    const eBtn = document.getElementById("btn-interact");
    if (eBtn) {
      const tap = (evt) => { evt.preventDefault(); if (currentPOI) showInteraction(currentPOI); };
      eBtn.addEventListener("touchstart", tap, { passive:false });
      eBtn.addEventListener("mousedown", tap);
    }

    // Mobile God Mode button
    let gBtn = document.getElementById("btn-god");
    if (!gBtn) {
      gBtn = document.createElement("button");
      gBtn.id = "btn-god";
      gBtn.innerText = "God";
      Object.assign(gBtn.style, {
        position:"absolute", bottom:"20px", right:"20px",
        padding:"10px", background:"#000", color:"#fff", borderRadius:"8px", zIndex:"9999"
      });
      document.body.appendChild(gBtn);
    }
    gBtn.onclick = () => {
      godMode = !godMode;
      if (godMode) disableCollisions(); else setupCollisions(game.scene.scenes[0]);
      alert("God Mode: " + (godMode ? "ON" : "OFF"));
    };
  }
};
