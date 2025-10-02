// ==================================
// Erasmus Game - main.js (COMPLET)
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
  let interactionBox;

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

    // --- Carte + tilesets (respecter le nom exact exporté par Tiled)
    this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
    this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
    this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
    this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

    // --- Sprite joueur (feuille 3x4, frame 144x144)
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

    // Les noms doivent matcher "name" dans le TMJ
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    const tilesets = [ts1, ts2, ts3];

    // --- Créer toutes les couches, en gérant les collisions
    const collisionLayers = [
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

      // On retarde ces couches pour gérer la profondeur à part
      if (["lampadaire + bancs + panneaux", "lampadaire_base", "lampadaire_haut"].includes(name)) return;

      const layer = map.createLayer(name, tilesets, 0, 0);
      createdLayers[name] = layer;

      if (collisionLayers.includes(name)) {
        layer.setCollisionByExclusion([-1]); // collision sur tout sauf > -1
      }
    });

    // --- Décor (avec collisions)
    const decorLayer = map.createLayer("lampadaire + bancs + panneaux", tilesets, 0, 0);
    if (decorLayer) {
      decorLayer.setCollisionByExclusion([-1]);
    }

    // --- Lampadaire base : pas de collision → le joueur peut passer derrière
    const lampBaseLayer = map.createLayer("lampadaire_base", tilesets, 0, 0);
    if (lampBaseLayer) {
      // On n'active PAS de collision
      // On le place au-dessus des couches basses pour que le joueur passe visuellement derrière (setDepth dynamique géré par player.setDepth(player.y))
      lampBaseLayer.setDepth(3000);
    }

    // --- Lampadaire haut : toujours devant
    const lampTopLayer = map.createLayer("lampadaire_haut", tilesets, 0, 0);
    if (lampTopLayer) {
      lampTopLayer.setDepth(9999);
    }

    // --- Objet layer : spawn + POI
    const objLayer = map.getObjectLayer("POI");
    if (objLayer) {
      objLayer.objects.forEach(obj => {
        if (obj.name === "spawn_avezzano") {
          // Spawn joueur
          player = this.physics.add.sprite(obj.x, obj.y, "player", 0);
          player.setOrigin(0.5, 1);   // pieds au sol
          player.setScale(0.20);      // style Pokémon compact
          player.setCollideWorldBounds(true);
        } else {
          // POI
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

    // --- Colliders joueur ↔ couches collision
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (collisionLayers.includes(name)) {
        this.physics.add.collider(player, layer);
        // console.log("Collision ON:", name);
      }
    });
    if (decorLayer) {
      this.physics.add.collider(player, decorLayer);
    }
    // lampadaire_base : pas de collision volontairement

    // --- Caméra
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.5);

    // --- Mini-map (vue d'ensemble)
    const miniW = 220;
    const miniH = 160;
    const miniZoom = 0.22;

    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    // Cadre visuel de la mini-map (dessiné en HUD)
    miniFrameGfx = this.add.graphics();
    miniFrameGfx.fillStyle(0x000000, 0.30).fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.lineStyle(2, 0xffffff, 1).strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.setScrollFactor(0).setDepth(11000);

    // Flèche joueur sur mini-map (HUD)
    playerMiniArrow = this.add.triangle(
      minimapCam.x + miniW / 2,     // x
      minimapCam.y + miniH / 2,     // y
      0, 12, 12, 12, 6, 0,          // triangle
      0xff0000                      // couleur
    ).setScrollFactor(0).setDepth(11001);

    // --- Contrôles clavier (PC)
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // --- Boîte DOM pour les interactions (POI)
    interactionBox = document.createElement("div");
    interactionBox.id = "interaction-box";
    interactionBox.style.display = "none";
    document.body.appendChild(interactionBox);

    // --- Animations du joueur (5 FPS, boostées par timeScale si run)
    this.anims.create({
      key: "down",
      frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }),
      frameRate: 5, repeat: -1
    });
    this.anims.create({
      key: "left",
      frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }),
      frameRate: 5, repeat: -1
    });
    this.anims.create({
      key: "right",
      frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }),
      frameRate: 5, repeat: -1
    });
    this.anims.create({
      key: "up",
      frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }),
      frameRate: 5, repeat: -1
    });

    // --- Particules de poussière (quand on court)
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
    // légèrement derrière les pieds
    dustEmitter.startFollow(player, 0, -6);

    // --- Bind des contrôles mobiles (D-pad GameBoy)
    bindMobileControls();

    // --- Adaptation resize (optionnel mais utile sur mobile en orientation)
    window.addEventListener("resize", () => {
      game.scale.resize(window.innerWidth, window.innerHeight);
      // Reposition mini-map HUD
      miniFrameGfx?.clear();
      const x = window.innerWidth - miniW - 12;
      const y = 12;
      minimapCam?.setPosition(x, y);
      miniFrameGfx?.fillStyle(0x000000, 0.30).fillRoundedRect(x - 6, y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx?.lineStyle(2, 0xffffff, 1).strokeRoundedRect(x - 6, y - 6, miniW + 12, miniH + 12, 10);
      if (playerMiniArrow) {
        playerMiniArrow.x = x + miniW / 2;
        playerMiniArrow.y = y + miniH / 2;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  function update() {
    if (!player) return;

    // Détection "run" : Shift (PC) ou bouton Run (mobile)
    const isRunning = (shiftKey && shiftKey.isDown) || mobileInput.run;
    const speed = isRunning ? 150 : 70;

    player.setVelocity(0);
    let moved = false;

    // --- INPUTS PC ---
    if (!isMobile) {
      // Horizontal
      if (cursors.left.isDown) {
        player.setVelocityX(-speed);
        playAnim("left", isRunning);
        moved = true;
      } else if (cursors.right.isDown) {
        player.setVelocityX(speed);
        playAnim("right", isRunning);
        moved = true;
      }

      // Vertical
      if (cursors.up.isDown) {
        player.setVelocityY(-speed);
        playAnim("up", isRunning);
        moved = true;
      } else if (cursors.down.isDown) {
        player.setVelocityY(speed);
        playAnim("down", isRunning);
        moved = true;
      }

      if (!moved) player.anims.stop();
    }

    // --- INPUTS MOBILE (D-pad) ---
    if (isMobile) {
      if (mobileInput.left) {
        player.setVelocityX(-speed);
        playAnim("left", isRunning);
        moved = true;
      } else if (mobileInput.right) {
        player.setVelocityX(speed);
        playAnim("right", isRunning);
        moved = true;
      }

      if (mobileInput.up) {
        player.setVelocityY(-speed);
        playAnim("up", isRunning);
        moved = true;
      } else if (mobileInput.down) {
        player.setVelocityY(speed);
        playAnim("down", isRunning);
        moved = true;
      }

      if (!moved) player.anims.stop();
    }

    // Profondeur = Y pour un tri naturel (derrière/devant décor)
    player.setDepth(player.y);

    // Poussière seulement si on court ET qu'on bouge
    const moving = Math.abs(player.body.velocity.x) > 1 || Math.abs(player.body.velocity.y) > 1;
    dustEmitter.on = isRunning && moving;

    // --- Mini-map : orienter la flèche
    if (player.anims.currentAnim) {
      const dir = player.anims.currentAnim.key;
      if (dir === "up") playerMiniArrow.rotation = 0;
      else if (dir === "right") playerMiniArrow.rotation = Phaser.Math.DegToRad(90);
      else if (dir === "down") playerMiniArrow.rotation = Phaser.Math.DegToRad(180);
      else if (dir === "left") playerMiniArrow.rotation = Phaser.Math.DegToRad(-90);
    }
    // Repositionner la flèche (HUD)
    if (minimapCam && playerMiniArrow) {
      playerMiniArrow.x = minimapCam.worldView.x + player.x * minimapCam.zoom;
      playerMiniArrow.y = minimapCam.worldView.y + player.y * minimapCam.zoom;
    }

    // --- Proximité POI + interaction E (sur PC)
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
        position: "absolute",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "6px 12px",
        borderRadius: "6px",
        zIndex: "9999",
        fontFamily: "system-ui, sans-serif"
      });
      document.body.appendChild(e);
    }
  }

  function hidePressE() {
    const e = document.getElementById("pressE");
    if (e) e.remove();
  }

  function showInteraction(poi) {
    // Appliquer fond assombri (si tu veux un effet body overlay)
    document.body.classList.add("overlay-active");

    let imgPath = poi.image;
    // Tolère "images/..." déjà présent ; sinon, préfixe
    if (imgPath && !imgPath.startsWith("images/")) {
      imgPath = "images/" + imgPath;
    }

    interactionBox.innerHTML = `
      <div class="interaction-content">
        <button id="closeBox" aria-label="Fermer">✖</button>
        <h2>${poi.title}</h2>
        <p>${poi.description}</p>
        ${imgPath ? `<img src="${imgPath}" alt="${poi.title}">` : ""}
      </div>
    `;
    interactionBox.style.display = "flex";

    const closeBtn = document.getElementById("closeBox");
    if (closeBtn) {
      closeBtn.onclick = () => {
        interactionBox.style.display = "none";
        document.body.classList.remove("overlay-active");
      };
    }
  }

  // ---------------------------------------------------------------------------
  // MOBILE CONTROLS (D-pad GameBoy + boutons)
  // ---------------------------------------------------------------------------
  function bindMobileControls() {
    // Helper : bind simple (touch + souris) pour compatibilité mobile/desktop
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

    // D-pad
    bindButton("btn-up",    () => mobileInput.up = true,    () => mobileInput.up = false);
    bindButton("btn-down",  () => mobileInput.down = true,  () => mobileInput.down = false);
    bindButton("btn-left",  () => mobileInput.left = true,  () => mobileInput.left = false);
    bindButton("btn-right", () => mobileInput.right = true, () => mobileInput.right = false);

    // RUN (maintenir)
    bindButton("btn-run",   () => mobileInput.run = true,   () => mobileInput.run = false);

    // E (action ponctuelle)
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
