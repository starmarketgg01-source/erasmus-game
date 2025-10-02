// ==================================
// Erasmus Game - main.js (COMPLET)
// ==================================
window.onload = function () {
  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: "game",
    physics: { default: "arcade", arcade: { debug: false } },
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
  let cityData = [];
  let currentPOI = null;

  let interactionBox;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const mobileInput = { up: false, down: false, left: false, right: false, run: false };

  let currentCity = null; // pour bannière

  // ---------------------------------------------------------------------------
  // PRELOAD
  // ---------------------------------------------------------------------------
  function preload() {
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    this.load.spritesheet("player", "images/characters/player.png", {
      frameWidth: 144,
      frameHeight: 144
    });
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  function create() {
    map = this.make.tilemap({ key: "map" });
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3];

    const collisionLayers = ["water", "rails", "bord de map", "vegetation 1", "vegetation 2", "batiments 1", "batiments 2"];
    const createdLayers = {};

    map.layers.forEach(ld => {
      const name = ld.name;
      if (["lampadaire + bancs + panneaux", "lampadaire_base", "lampadaire_haut"].includes(name)) return;
      const layer = map.createLayer(name, tilesets, 0, 0);
      createdLayers[name] = layer;
      if (collisionLayers.includes(name)) {
        layer.setCollisionByExclusion([-1]);
      }
    });

    const decorLayer = map.createLayer("lampadaire + bancs + panneaux", tilesets, 0, 0);
    if (decorLayer) decorLayer.setCollisionByExclusion([-1]);
    const lampBaseLayer = map.createLayer("lampadaire_base", tilesets, 0, 0);
    if (lampBaseLayer) lampBaseLayer.setDepth(3000);
    const lampTopLayer = map.createLayer("lampadaire_haut", tilesets, 0, 0);
    if (lampTopLayer) lampTopLayer.setDepth(9999);

    // --- Spawn + POI
    const objLayer = map.getObjectLayer("POI");
    if (objLayer) {
      objLayer.objects.forEach(obj => {
        if (obj.name === "spawn_avezzano") {
          player = this.physics.add.sprite(obj.x, obj.y, "player", 0);
          player.setOrigin(0.5, 1);
          player.setScale(0.20);
          player.setCollideWorldBounds(true);
        } else {
          poiData.push({
            x: obj.x,
            y: obj.y,
            title: obj.properties?.find(p => p.name === "title")?.value || obj.name,
            description: obj.properties?.find(p => p.name === "text")?.value || "",
            image: obj.properties?.find(p => p.name === "media")?.value || null
          });
        }
      });
    }

    // --- Villes (nouveau calque)
    const cityLayer = map.getObjectLayer("VILLE");
    if (cityLayer) {
      cityLayer.objects.forEach(obj => {
        cityData.push({
          name: obj.name,
          x: obj.x,
          y: obj.y
        });
      });
    }

    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (collisionLayers.includes(name)) this.physics.add.collider(player, layer);
    });
    if (decorLayer) this.physics.add.collider(player, decorLayer);

    // Camera
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.5);

    // Minimap
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    miniFrameGfx = this.add.graphics();
    miniFrameGfx.fillStyle(0x000000, 0.30).fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.lineStyle(2, 0xffffff, 1).strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.setScrollFactor(0).setDepth(11000);

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW / 2, minimapCam.y + miniH / 2,
      0, 12, 12, 12, 6, 0, 0xff0000).setScrollFactor(0).setDepth(11001);

    // Clavier
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // Interaction box
    interactionBox = document.getElementById("interaction-box");

    // Animations
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 5, repeat: -1 });

    this.anims.create({ key: "idle-down", frames: [{ key: "player", frame: 1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key: "player", frame: 4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key: "player", frame: 7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key: "player", frame: 10 }] });

    // Poussière
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x: 0, y: 0, speed: { min: -40, max: 40 }, angle: { min: 200, max: 340 },
      scale: { start: 0.27, end: 0 }, alpha: { start: 0.8, end: 0 },
      lifespan: 400, on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // Contrôles mobiles
    bindMobileControls();

    // --- Intro start
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        document.getElementById("intro").style.display = "none";
        try { document.getElementById("bgm").play(); } catch (_) {}
        showCityBanner("Avezzano");
      };
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
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
    }
    if (isMobile) {
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
      player.setVelocity(0);
      if (player.anims.currentAnim) {
        const dir = player.anims.currentAnim.key;
        if (["up", "down", "left", "right"].includes(dir)) {
          player.anims.play("idle-" + dir, true);
        }
      }
    }
    player.setDepth(player.y);

    // Dust
    const moving = Math.abs(vx) > 1 || Math.abs(vy) > 1;
    dustEmitter.on = isRunning && moving;

    // Arrow
    if (player.anims.currentAnim) {
      const dir = player.anims.currentAnim.key;
      if (dir.includes("up")) playerMiniArrow.rotation = 0;
      else if (dir.includes("right")) playerMiniArrow.rotation = Phaser.Math.DegToRad(90);
      else if (dir.includes("down")) playerMiniArrow.rotation = Phaser.Math.DegToRad(180);
      else if (dir.includes("left")) playerMiniArrow.rotation = Phaser.Math.DegToRad(-90);
    }
    playerMiniArrow.x = minimapCam.worldView.x + player.x * minimapCam.zoom;
    playerMiniArrow.y = minimapCam.worldView.y + player.y * minimapCam.zoom;

    // --- POI
    currentPOI = null;
    for (let poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < 40) { currentPOI = poi; break; }
    }
    if (currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
      showInteraction(currentPOI);
    }

    // --- Ville (bannière)
    for (let city of cityData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, city.x, city.y);
      if (d < 100 && currentCity !== city.name) {
        currentCity = city.name;
        showCityBanner(city.name);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) {
      player.anims.play(key, true);
    }
    player.anims.timeScale = isRunning ? 2 : 1;
  }

  function showInteraction(poi) {
    try { document.getElementById("sfx-open").play(); } catch (_) {}
    document.getElementById("poi-title").innerText = poi.title;
    document.getElementById("poi-text").innerText = poi.description;
    if (poi.image) {
      document.getElementById("poi-img").src = poi.image;
      document.getElementById("poi-img").style.display = "block";
    } else {
      document.getElementById("poi-img").style.display = "none";
    }
    interactionBox.style.display = "flex";
    document.getElementById("closeBox").onclick = () => {
      interactionBox.style.display = "none";
      try { document.getElementById("sfx-close").play(); } catch (_) {}
    };
  }

  function showCityBanner(name) {
    const banner = document.getElementById("city-banner");
    banner.innerText = name;
    banner.classList.add("show");
    setTimeout(() => banner.classList.remove("show"), 4000);
  }

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
};

