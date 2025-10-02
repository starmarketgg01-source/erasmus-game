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
  let started = false;                 // bloquer les inputs tant que l'intro n'est pas validée

  let map;
  let tilesets = [];
  let collisionLayersNames = [
    "water",
    "rails",
    "bord de map",
    "vegetation 1",
    "vegetation 2",
    "batiments 1",
    "batiments 2"
  ];
  let createdLayers = {};              // { name: layer }
  let decorLayer = null;
  let lampBaseLayer = null;
  let lampTopLayer = null;

  let player;
  let cursors, shiftKey, interactionKey;

  // Mini-map
  let minimapCam = null;
  let playerMiniArrow = null;
  let miniFrameGfx = null;

  // Particules (poussière)
  let dustEmitter = null;

  // POI
  let poiData = [];
  let currentPOI = null;

  // DOM box pour les interactions
  let interactionBox;

  // Audio DOM (gérés par policies navigateur)
  const bgm      = document.getElementById("bgm");
  const sfxOpen  = document.getElementById("sfx-open");
  const sfxClose = document.getElementById("sfx-close");

  // City label DOM
  const cityLabel = document.getElementById("city-name");

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

  // ===================================================================
  // PRELOAD
  // ===================================================================
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

  // ===================================================================
  // CREATE
  // ===================================================================
  function create() {
    console.log("[CREATE]");

    // ------------------------------------------------------------
    // Construction de la carte
    // ------------------------------------------------------------
    buildMap.call(this);

    // ------------------------------------------------------------
    // Caméra & Mini-map
    // ------------------------------------------------------------
    setupCameras.call(this);

    // ------------------------------------------------------------
    // Contrôles & UI DOM
    // ------------------------------------------------------------
    setupControlsAndUI.call(this);

    // ------------------------------------------------------------
    // Animations Joueur
    // ------------------------------------------------------------
    setupAnimations.call(this);

    // ------------------------------------------------------------
    // Particules poussière
    // ------------------------------------------------------------
    setupDust.call(this);

    // ------------------------------------------------------------
    // Intro bouton COMMENCER
    // ------------------------------------------------------------
    wireIntroStart();

    // ------------------------------------------------------------
    // Resize
    // ------------------------------------------------------------
    window.addEventListener("resize", onResize);
  }

  // ===================================================================
  // UPDATE
  // ===================================================================
  function update() {
    // Pas de joueur ou pas démarré : on ne bouge pas.
    if (!player) return;
    if (!started) return;

    // Courir ? (Shift ou bouton mobile RUN)
    const isRunning = (shiftKey && shiftKey.isDown) || mobileInput.run;
    const speed = isRunning ? 150 : 70;

    // Calcule vitesse X/Y (PC + mobile combinés)
    let vx = 0, vy = 0;

    // PC
    if (!isMobile) {
      if (cursors.left.isDown)  vx -= speed;
      if (cursors.right.isDown) vx += speed;
      if (cursors.up.isDown)    vy -= speed;
      if (cursors.down.isDown)  vy += speed;
    }

    // Mobile
    if (isMobile) {
      if (mobileInput.left)  vx -= speed;
      if (mobileInput.right) vx += speed;
      if (mobileInput.up)    vy -= speed;
      if (mobileInput.down)  vy += speed;
    }

    // Applique la vélocité
    player.setVelocity(vx, vy);

    // Animations directionnelles
    if (vx < 0)      playAnim("left",  isRunning);
    else if (vx > 0) playAnim("right", isRunning);
    else if (vy < 0) playAnim("up",    isRunning);
    else if (vy > 0) playAnim("down",  isRunning);
    else {
      player.setVelocity(0);
      if (player.anims.currentAnim) {
        const dir = player.anims.currentAnim.key;
        if (["up", "down", "left", "right"].includes(dir)) {
          player.anims.play("idle-" + dir, true);
        }
      }
    }

    // Profondeur (dessin)
    player.setDepth(player.y);

    // Poussière seulement si on court ET qu’on bouge
    const moving = Math.abs(vx) > 1 || Math.abs(vy) > 1;
    if (dustEmitter) {
      dustEmitter.on = isRunning && moving;
    }

    // Mini-map : flèche orientation + position
    if (playerMiniArrow && minimapCam && player.anims.currentAnim) {
      const dir = player.anims.currentAnim.key;
      if (dir.includes("up"))        playerMiniArrow.rotation = 0;
      else if (dir.includes("right")) playerMiniArrow.rotation = Phaser.Math.DegToRad(90);
      else if (dir.includes("down"))  playerMiniArrow.rotation = Phaser.Math.DegToRad(180);
      else if (dir.includes("left"))  playerMiniArrow.rotation = Phaser.Math.DegToRad(-90);

      playerMiniArrow.x = minimapCam.worldView.x + player.x * minimapCam.zoom;
      playerMiniArrow.y = minimapCam.worldView.y + player.y * minimapCam.zoom;
    }

    // POI : proximité + Appuie sur E
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

  // ===================================================================
  // BUILD MAP & LAYERS
  // ===================================================================
  function buildMap() {
    // --- Map
    map = this.make.tilemap({ key: "map" });

    // Les noms doivent matcher "name" dans le TMJ
    const ts1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
    const ts2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
    const ts3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");
    tilesets = [ts1, ts2, ts3];

    // --- Créer toutes les couches (hors lampadaires*)
    createdLayers = {};
    map.layers.forEach(ld => {
      const name = ld.name;

      // On retarde ces couches pour gérer la profondeur à part
      if (["lampadaire + bancs + panneaux", "lampadaire_base", "lampadaire_haut"].includes(name)) return;

      const layer = map.createLayer(name, tilesets, 0, 0);
      createdLayers[name] = layer;

      if (collisionLayersNames.includes(name)) {
        layer.setCollisionByExclusion([-1]); // collision sur tout sauf -1
      }
    });

    // --- Décor (avec collisions)
    decorLayer = map.createLayer("lampadaire + bancs + panneaux", tilesets, 0, 0);
    if (decorLayer) {
      decorLayer.setCollisionByExclusion([-1]);
    }

    // --- Lampadaire base : PAS de collision → le joueur peut passer DERRIÈRE
    lampBaseLayer = map.createLayer("lampadaire_base", tilesets, 0, 0);
    if (lampBaseLayer) {
      lampBaseLayer.setDepth(3000); // devant le sol, mais pas de collision
      // Pas de setCollisionByExclusion : on laisse passer
    }

    // --- Lampadaire haut : toujours DEVANT le joueur
    lampTopLayer = map.createLayer("lampadaire_haut", tilesets, 0, 0);
    if (lampTopLayer) {
      lampTopLayer.setDepth(9999);
    }

    // --- Objet layer : spawn + POI
    poiData = [];
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

    // --- Petits halos discrets pour visualiser les POI
    poiData.forEach(p => {
      const halo = this.add.circle(p.x, p.y - 18, 10, 0x00d1ff, 0.15);
      halo.setDepth(p.y + 1);
      this.tweens.add({
        targets: halo, scale: 1.3, alpha: 0.35,
        yoyo: true, repeat: -1, duration: 800
      });
    });

    // --- Colliders joueur ↔ couches collision
    Object.entries(createdLayers).forEach(([name, layer]) => {
      if (collisionLayersNames.includes(name)) {
        this.physics.add.collider(player, layer);
      }
    });
    if (decorLayer) {
      this.physics.add.collider(player, decorLayer);
    }
    // lampBaseLayer = sans collider → le joueur peut passer derrière
  }

  // ===================================================================
  // CAMERAS (main + minimap)
  // ===================================================================
  function setupCameras() {
    // Caméra principale
    this.cameras.main.startFollow(player, true, 0.12, 0.12);
    this.cameras.main.setZoom(2.5);

    // Mini-map
    const miniW = 220;
    const miniH = 160;
    const miniZoom = 0.22;

    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    // Cadre
    miniFrameGfx = this.add.graphics();
    miniFrameGfx.fillStyle(0x000000, 0.30)
      .fillRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.lineStyle(2, 0xffffff, 1)
      .strokeRoundedRect(minimapCam.x - 6, minimapCam.y - 6, miniW + 12, miniH + 12, 10);
    miniFrameGfx.setScrollFactor(0).setDepth(11000);

    // Flèche joueur
    playerMiniArrow = this.add.triangle(
      minimapCam.x + miniW / 2,
      minimapCam.y + miniH / 2,
      0, 12, 12, 12, 6, 0,
      0xff0000
    ).setScrollFactor(0).setDepth(11001);
  }

  // ===================================================================
  // CONTROLS + UI DOM
  // ===================================================================
  function setupControlsAndUI() {
    // Clavier
    cursors = this.input.keyboard.createCursorKeys();
    shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // Interaction box
    interactionBox = document.createElement("div");
    interactionBox.id = "interaction-box";
    interactionBox.style.display = "none";
    document.body.appendChild(interactionBox);

    // Contrôles mobiles (pad GameBoy + E + RUN)
    bindMobileControls();
  }

  // ===================================================================
  // ANIMS
  // ===================================================================
  function setupAnimations() {
    // Walk
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

    // Idle (frame centrale de chaque rangée)
    this.anims.create({ key: "idle-down",  frames: [{ key: "player", frame: 1 }] });
    this.anims.create({ key: "idle-left",  frames: [{ key: "player", frame: 4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key: "player", frame: 7 }] });
    this.anims.create({ key: "idle-up",    frames: [{ key: "player", frame: 10 }] });
  }

  // ===================================================================
  // DUST
  // ===================================================================
  function setupDust() {
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
  }

  // ===================================================================
  // INTRO BUTTON
  // ===================================================================
  function wireIntroStart() {
    const introBtn = document.getElementById("introStart");
    const intro    = document.getElementById("intro");

    if (introBtn) {
      introBtn.addEventListener("click", () => {
        // Démarrage audio si possible (policy mobile)
        try { if (bgm && bgm.paused) { bgm.volume = 0.35; bgm.play().catch(()=>{}); } } catch(e){}

        // Masquer l'intro et autoriser les inputs
        intro?.classList.add("fade-out");
        started = true;

        // Afficher le nom de la ville au lancement
        showCityBanner("AVEZZANO");
      }, { once: true });
    }
  }

  // ===================================================================
  // UPDATE HELPERS
  // ===================================================================
  function playAnim(key, isRunning) {
    if (!player.anims.isPlaying || player.anims.currentAnim?.key !== key) {
      player.anims.play(key, true);
    }
    player.anims.timeScale = isRunning ? 2 : 1; // courir = ×2 (≈10 fps)
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
  if (!interactionBox) return;

  document.body.classList.add("overlay-active");

  let imgPath = poi.image;
  if (imgPath && !imgPath.startsWith("images/")) {
    imgPath = "images/" + imgPath;
  }

  // On insère le contenu d’abord
  interactionBox.innerHTML = `
    <div class="interaction-content">
      <button id="closeBox" aria-label="Fermer">✖</button>
      <h2>${poi.title}</h2>
      <p>${poi.description}</p>
      ${imgPath ? `<img src="${imgPath}" alt="${poi.title}">` : ""}
    </div>
  `;

  // Affiche la box
  interactionBox.style.display = "flex";

  // Joue le son d’ouverture
  try { sfxOpen?.play().catch(()=>{}); } catch(_){}

  // Attache le bouton ✖
  const closeBtn = document.getElementById("closeBox");
  if (closeBtn) {
    closeBtn.onclick = () => {
      interactionBox.style.display = "none";
      document.body.classList.remove("overlay-active");
      try { sfxClose?.play().catch(()=>{}); } catch(_){}
    };
  }
}

  // ===================================================================
  // MOBILE CONTROLS (D-pad + Run + E)
  // ===================================================================
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
        if (!started) return; // avant start, on ignore
        if (currentPOI) showInteraction(currentPOI);
      };
      eBtn.addEventListener("touchstart", tap, { passive: false });
      eBtn.addEventListener("mousedown", tap);
    }
  }

  // ===================================================================
  // CITY BANNER (5s) — utilisé au start et quand tu changeras d'île
  // ===================================================================
  function showCityBanner(name) {
    if (!cityLabel) return;
    cityLabel.textContent = name.toUpperCase();
    cityLabel.style.opacity = "0";
    cityLabel.style.display = "block";
    cityLabel.style.transition = "opacity 400ms ease";

    requestAnimationFrame(() => {
      cityLabel.style.opacity = "1";
    });

    setTimeout(() => {
      cityLabel.style.opacity = "0";
      setTimeout(() => {
        cityLabel.style.display = "none";
      }, 450);
    }, 5000);
  }

  // Appel d’exemple quand tu changeras d’île plus tard :
  // changeIsland("aquila.tmj", "L'AQUILA") etc. (exemple ci-dessous)
  async function changeIsland(newMapKey, cityName) {
    // NOTE: exemple pour plus tard — ici on montre juste le bandeau
    showCityBanner(cityName);
    // Si tu veux charger une autre TMJ dynamiquement,
    // il faudra ajouter un Loader pour la nouvelle map et reconstruire les layers
    // (on pourra te le coder si tu ajoutes les fichiers).
  }

  // ===================================================================
  // RESIZE
  // ===================================================================
  function onResize() {
    game.scale.resize(window.innerWidth, window.innerHeight);

    // reposition mini-map frame et flèche
    const miniW = 220, miniH = 160;
    const x = window.innerWidth - miniW - 12;
    const y = 12;
    if (minimapCam) minimapCam.setPosition(x, y);

    if (miniFrameGfx) {
      miniFrameGfx.clear();
      miniFrameGfx.fillStyle(0x000000, 0.30)
        .fillRoundedRect(x - 6, y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.lineStyle(2, 0xffffff, 1)
        .strokeRoundedRect(x - 6, y - 6, miniW + 12, miniH + 12, 10);
      miniFrameGfx.setDepth(11000);
    }

    if (playerMiniArrow) {
      playerMiniArrow.x = x + miniW / 2;
      playerMiniArrow.y = y + miniH / 2;
    }
  }
};

