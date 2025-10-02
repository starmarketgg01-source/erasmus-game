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

  // --- Globals ---
  let map;
  let player;
  let cursors, shiftKey, interactionKey;
  let poiData = [];
  let currentPOI = null;
  let interactionBox;
  let minimapCam, playerMiniArrow;
  let dustEmitter;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Mobile buttons state
  let mobileInput = { up: false, down: false, left: false, right: false, run: false };

  // --------------------------------
  // PRELOAD
  // --------------------------------
  function preload() {
    console.log("Preload…");

    // Map + tilesets
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // Player spritesheet 3x4
    this.load.spritesheet("player", "images/characters/player.png", {
      frameWidth: 144,
      frameHeight: 144
    });
  }

  // --------------------------------
  // CREATE
  // --------------------------------
  function create() {
    console.log("Create…");

    // Map
    map = this.make.tilemap({ key: "map" });
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3];

    const collisionLayersNames = [
      "water",
      "rails",
      "bord de map",
      "vegetation 1",
      "vegetation 2",
      "batiments 1",
      "batiments 2"
    ];

    const createdLayers = {};
    map.layers.forEach(ld => {
      const name = ld.name;
      if (["lampadaire + bancs + panneaux", "lampadaire_base", "lampadaire_haut"].includes(name)) return;
      const layer = map.createLayer(name, tilesets, 0, 0);
      createdLayers[name] = layer;
      if (collisionLayersNames.includes(name)) {
        layer.setCollisionByExclusion([-1]);
      }
    });

    const decorLayer = map.createLayer("lampadaire + bancs + panneaux", tilesets, 0, 0);
    if (decorLayer) decorLayer.setCollisionByExclusion([-1]);

    // Lampadaire base : PAS de collision → joueur passe derrière
    const lampBaseLayer = map.createLayer("lampadaire_base", tilesets, 0, 0);

    const lampTopLayer = map.createLayer("lampadaire_haut", tilesets, 0, 0);
    if (lampTopLayer) lampTopLayer.setDepth(9999);

    // Spawn joueur et POI
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
            description: obj.properties?.find(p => p.name === "text")?.value || "Aucune description disponible.",
            image: obj.properties?.find(p => p.name === "media")?.value || null
          });
        }
      });
    }

    // Collisions
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (collisionLayersNames.includes(name)) {
        this.physics.add.collider(player, layer);
        console.log("Collision ON:", name);
      }
    });
    if (decorLayer) this.physics.add.collider(player, decorLayer);

    // Caméra
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.5);

    // Mini map
    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    const miniBg = this.add.graphics();
    miniBg.fillStyle(0x000000, 0.30).fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniBg.lineStyle(2, 0xffffff, 1).strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniBg.setScrollFactor(0).setDepth(10000);

    playerMiniArrow = this.add.triangle(
      minimapCam.x + miniW / 2,
      minimapCam.y + miniH / 2,
      0, 12, 12, 12, 6, 0,
      0xff0000
    ).setScrollFactor(0).setDepth(10001);

    // Controls
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // Interaction modal
    interactionBox = document.createElement("div");
    interactionBox.id = "interaction-box";
    interactionBox.style.display = "none";
    document.body.appendChild(interactionBox);

    // Animations
    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 5, repeat: -1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 5, repeat: -1 });

    // Dust
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x: 0, y: 0,
      speed: { min: -40, max: 40 },
      angle: { min: 200, max: 340 },
      scale: { start: 0.27, end: 0 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 400,
      on: false
    });
    dustEmitter.startFollow(player, 0, -6);

    // --- Mobile buttons binding ---
    bindMobileButtons();
  }

  // --------------------------------
  // UPDATE
  // --------------------------------
  function update() {
    if (!player) return;

    const isRunning = (shiftKey && shiftKey.isDown) || mobileInput.run;
    const speed = isRunning ? 150 : 70;

    player.setVelocity(0);
    let moved = false;

    // PC inputs
    if (!isMobile) {
      if (cursors.left.isDown) { player.setVelocityX(-speed); playAnim("left", isRunning); moved = true; }
      else if (cursors.right.isDown) { player.setVelocityX(speed); playAnim("right", isRunning); moved = true; }
      if (cursors.up.isDown) { player.setVelocityY(-speed); playAnim("up", isRunning); moved = true; }
      else if (cursors.down.isDown) { player.setVelocityY(speed); playAnim("down", isRunning); moved = true; }
      if (!moved) player.anims.stop();
    }

    // Mobile inputs
    if (isMobile) {
      if (mobileInput.left) { player.setVelocityX(-speed); playAnim("left", isRunning); moved = true; }
      else if (mobileInput.right) { player.setVelocityX(speed); playAnim("right", isRunning); moved = true; }
      if (mobileInput.up) { player.setVelocityY(-speed); playAnim("up", isRunning); moved = true; }
      else if (mobileInput.down) { player.setVelocityY(speed); playAnim("down", isRunning); moved = true; }
      if (!moved) player.anims.stop();
    }

    player.setDepth(player.y);

    const moving = Math.abs(player.body.velocity.x) > 1 || Math.abs(player.body.velocity.y) > 1;
    dustEmitter.on = isRunning && moving;

    if (player.anims.currentAnim) {
      const dir = player.anims.currentAnim.key;
      if (dir === "up") playerMiniArrow.rotation = 0;
      else if (dir === "right") playerMiniArrow.rotation = Phaser.Math.DegToRad(90);
      else if (dir === "down") playerMiniArrow.rotation = Phaser.Math.DegToRad(180);
      else if (dir === "left") playerMiniArrow.rotation = Phaser.Math.DegToRad(-90);
    }
    playerMiniArrow.x = minimapCam.worldView.x + player.x * minimapCam.zoom;
    playerMiniArrow.y = minimapCam.worldView.y + player.y * minimapCam.zoom;

    currentPOI = null;
    for (let poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < 40) { currentPOI = poi; if (!isMobile) showPressE(); break; }
    }
    if (!currentPOI && !isMobile) hidePressE();
    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
      showInteraction(currentPOI);
    }
  }

  // Helpers
  function playAnim(key, isRunning) {
    if (player.anims.currentAnim?.key !== key) {
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
        position: "absolute",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "6px 12px",
        borderRadius: "6px",
        zIndex: "9999"
      });
      document.body.appendChild(e);
    }
  }

  function hidePressE() {
    const e = document.getElementById("pressE");
    if (e) e.remove();
  }

  function showInteraction(poi) {
    document.body.classList.add("overlay-active");
    let imgPath = poi.image;
    if (imgPath && !imgPath.startsWith("images/")) imgPath = "images/" + imgPath;
    interactionBox.innerHTML = `
      <div class="interaction-content">
        <button id="closeBox" aria-label="Fermer">✖</button>
        <h2>${poi.title}</h2>
        <p>${poi.description}</p>
        ${imgPath ? `<img src="${imgPath}" alt="${poi.title}">` : ""}
      </div>
    `;
    interactionBox.style.display = "flex";
    document.getElementById("closeBox").onclick = () => {
      interactionBox.style.display = "none";
      document.body.classList.remove("overlay-active");
    };
  }

  // --- Bind mobile buttons ---
  function bindMobileButtons() {
    function bindBtn(id, key) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("touchstart", () => { mobileInput[key] = true; });
      btn.addEventListener("touchend", () => { mobileInput[key] = false; });
    }
    bindBtn("btn-up", "up");
    bindBtn("btn-down", "down");
    bindBtn("btn-left", "left");
    bindBtn("btn-right", "right");
    bindBtn("btn-run", "run");

    const btnInteract = document.getElementById("btn-interact");
    if (btnInteract) {
      btnInteract.addEventListener("touchstart", () => {
        if (currentPOI) showInteraction(currentPOI);
      });
    }
  }
};


