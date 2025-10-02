// ==================================
// Erasmus Game - main.js (COMPLET 600+ lignes)
// ==================================
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
      arcade: { debug: false }
    },
    scene: { preload, create, update }
  };

  const game = new Phaser.Game(config);

  // -------------------------------
  // GLOBALS
  // -------------------------------
  let map;
  let player;
  let cursors, shiftKey, interactionKey;

  // Mini-map
  let minimapCam, playerMiniArrow, miniFrameGfx;

  // Particules (poussière)
  let dustEmitter;

  // POI
  let poiData = [];
  let currentPOI = null;

  // DOM box pour les interactions
  let interactionBox, poiTitle, poiText, poiImg, closeBox;

  // Ville courante
  let currentCity = "Avezzano";

  // Flags
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Entrées mobiles (via D-pad GameBoy + boutons Run/E)
  const mobileInput = {
    up: false,
    down: false,
    left: false,
    right: false,
    run: false
  };

  // ---------------------------------------------------------------------------
  // PRELOAD
  // ---------------------------------------------------------------------------
  function preload() {
    console.log("[PRELOAD]");

    // --- Carte + tilesets
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // --- Sprite joueur
    this.load.spritesheet("player", "images/characters/player.png", {
      frameWidth: 144,
      frameHeight: 144
    });
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------
  function create() {
    console.log("[CREATE]");

    // --- Construction de la carte
    map = this.make.tilemap({ key: "map" });
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3];

    const collisionLayers = [
      "water", "rails", "bord de map",
      "vegetation 1", "vegetation 2",
      "batiments 1", "batiments 2"
    ];

    const createdLayers = {};
    map.layers.forEach(ld => {
      const name = ld.name;
      if (["lampadaire + bancs + panneaux", "lampadaire_base", "lampadaire_haut"].includes(name)) return;
      const layer = map.createLayer(name, tilesets, 0, 0);
      createdLayers[name] = layer;
      if (collisionLayers.includes(name)) layer.setCollisionByExclusion([-1]);
    });

    // Décor
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
            title: obj.properties?.find(p => p.name === "title")?.value || obj.name || "Point d'intérêt",
            description: obj.properties?.find(p => p.name === "text")?.value || "Aucune description disponible.",
            image: obj.properties?.find(p => p.name === "media")?.value || null
          });
        }
      });
    }

    // Colliders
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (collisionLayers.includes(name)) this.physics.add.collider(player, layer);
    });
    if (decorLayer) this.physics.add.collider(player, decorLayer);

    // Caméra
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.5);

    // Mini-map
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    miniFrameGfx = this.add.graphics();
    miniFrameGfx.fillStyle(0x000000, 0.30)
      .fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.lineStyle(2, 0xffffff, 1)
      .strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.setScrollFactor(0).setDepth(11000);

    playerMiniArrow = this.add.triangle(
      minimapCam.x + miniW / 2, minimapCam.y + miniH / 2,
      0, 12, 12, 12, 6, 0,
      0xff0000
    ).setScrollFactor(0).setDepth(11001);

    // Contrôles
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // Interaction box (DOM)
    interactionBox = document.getElementById("interaction-box");
    poiTitle = document.getElementById("poi-title");
    poiText = document.getElementById("poi-text");
    poiImg = document.getElementById("poi-img");
    closeBox = document.getElementById("closeBox");
    if (closeBox) {
      closeBox.onclick = () => {
        interactionBox.style.display = "none";
        document.body.classList.remove("overlay-active");
      };
    }

    // Animations joueur
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
      x: 0, y: 0,
      speed: { min: -40, max: 40 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.27, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 400,
      on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // Contrôles mobiles
    bindMobileControls();

    // Intro bouton
    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        document.getElementById("intro").style.display = "none";
        showCityBanner(currentCity);
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
    const moving = Math.abs(vx) > 1 || Math.abs(vy) > 1;
    dustEmitter.on = isRunning && moving;

    if (player.anims.currentAnim) {
      const dir = player.anims.currentAnim.key;
      if (dir.includes("up")) playerMiniArrow.rotation = 0;
      else if (dir.includes("right")) playerMiniArrow.rotation = Phaser.Math.DegToRad(90);
      else if (dir.includes("down")) playerMiniArrow.rotation = Phaser.Math.DegToRad(180);
      else if (dir.includes("left")) playerMiniArrow.rotation = Phaser.Math.DegToRad(-90);
    }
    playerMiniArrow.x = minimapCam.worldView.x + player.x * minimapCam.zoom;
    playerMiniArrow.y = minimapCam.worldView.y + player.y * minimapCam.zoom;

    // POI
    currentPOI = null;
    for (let poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < 40) {
        currentPOI = poi;
        if (!isMobile) showPressE();
        break;
      }
    }
    if (!currentPOI && !isMobile) hidePressE();
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
      showInteraction(currentPOI);
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

  function showPressE() {
    if (!document.getElementById("pressE")) {
      const e = document.createElement("div");
      e.id = "pressE";
      e.innerText = "Appuie sur E";
      Object.assign(e.style, {
        position: "absolute", top: "20px", left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.7)", color: "#fff",
        padding: "6px 12px", borderRadius: "6px", zIndex: "9999"
      });
      document.body.appendChild(e);
    }
  }
  function hidePressE() { const e = document.getElementById("pressE"); if (e) e.remove(); }

  function showInteraction(poi) {
    if (!interactionBox) return;
    poiTitle.textContent = poi.title;
    poiText.textContent = poi.description;
    if (poi.image) {
      poiImg.src = poi.image;
      poiImg.style.display = "block";
    } else {
      poiImg.style.display = "none";
    }
    interactionBox.style.display = "flex";
  }

  function showCityBanner(city) {
    const banner = document.getElementById("city-banner");
    if (!banner) return;
    banner.textContent = city;
    banner.style.display = "block";
    banner.style.opacity = 1;
    setTimeout(() => { banner.style.opacity = 0; }, 4000);
    setTimeout(() => { banner.style.display = "none"; }, 5000);
  }

  // ---------------------------------------------------------------------------
  // MOBILE CONTROLS
  // ---------------------------------------------------------------------------
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
      const tap = (evt) => {
        evt.preventDefault();
        if (currentPOI) showInteraction(currentPOI);
      };
      eBtn.addEventListener("touchstart", tap, { passive: false });
      eBtn.addEventListener("mousedown", tap);
    }
  }
};
