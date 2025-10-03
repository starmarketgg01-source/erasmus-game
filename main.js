// ======================================================
// main_godmode_complete.js (corrigé)
// Erasmus — main.js complet (God Mode + toggle D + POI + VILLE + minimap + mobile controls)
// - Toggle God Mode with D (disable collisions globally + re-enable)
// - Robust collision removal & restoration logic
// - Debug utilities and safe fallbacks
// - Drop-in replacement; compatible Phaser v3.55.x
// ======================================================

window.onload = function () {
  // -------------------------------
  // CONFIG (phaser)
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
  let toggleCollisionsKey = null;
  let minimapCam = null;
  let playerMiniArrow = null;
  let dustEmitter = null;
  let poiData = [];
  let currentPOI = null;
  let villes = [];
  let currentVille = null;
  let interactionBox = null;

  // Layers
  let createdLayers = {}; 
  let layerColliders = []; 
  let collisionsEnabled = true; 
  let godModeActive = false;    

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileInput = { up:false, down:false, left:false, right:false, run:false };

  const COLLISION_LAYERS = [
    "water","rails","bord de map","vegetation 1","vegetation 2","batiments 1","batiments 2"
  ];

  const IGNORE_TILE_INDICES = [809, 1341, 2268, 2269];

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
        createdLayers[name] = layer;
      } catch (err) {
        console.warn("createLayer failed for", name, err);
      }
    }

    if (createdLayers["lampadaire + bancs + panneaux"]) createdLayers["lampadaire + bancs + panneaux"].setDepth(2000);
    if (createdLayers["lampadaire_base"]) createdLayers["lampadaire_base"].setDepth(3000);
    if (createdLayers["lampadaire_haut"]) createdLayers["lampadaire_haut"].setDepth(9999);

    // -------------------------------
    // OBJECTS: POI + spawn
    // -------------------------------
    let spawnPoint = null;
    const poiLayer = map.getObjectLayer("POI");
    if (poiLayer && Array.isArray(poiLayer.objects)) {
      for (let obj of poiLayer.objects) {
        const name = (obj.name || "").toLowerCase();
        const type = (obj.type || "").toLowerCase();
        if (name === "spawn_avezzano" || type === "spawn") {
          if (!spawnPoint || name === "spawn_avezzano") spawnPoint = obj;
        } else {
          const title = obj.properties?.find(p => p.name === "title")?.value || obj.name || "POI";
          const desc  = obj.properties?.find(p => p.name === "text")?.value  || "";
          const img   = obj.properties?.find(p => p.name === "media")?.value || null;
          poiData.push({ x: obj.x, y: obj.y, title, description: desc, image: img });
        }
      }
    }

    if (!spawnPoint && poiLayer && Array.isArray(poiLayer.objects)) {
      spawnPoint = poiLayer.objects.find(o => (o.name || "").toLowerCase().includes("spawn")) || null;
    }

    if (!spawnPoint) {
      console.warn("spawn_avezzano introuvable, fallback centre map");
      spawnPoint = { x: map.widthInPixels / 2, y: map.heightInPixels / 2 };
    }

    player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 0);
    player.setOrigin(0.5, 1);
    player.setScale(0.20);
    player.setCollideWorldBounds(true);

    if (player.body) {
      player.body.setSize(player.width * 0.45, player.height * 0.32);
      player.body.setOffset(player.width * 0.28, player.height * 0.68);
    }

    // -------------------------------
    // VILLE
    // -------------------------------
    villes = [];
    const villeLayer = map.getObjectLayer("VILLE");
    if (villeLayer && Array.isArray(villeLayer.objects)) {
      for (let obj of villeLayer.objects) {
        const cx = obj.x + (obj.width || 0) / 2;
        const cy = obj.y + (obj.height || 0) / 2;
        const r = Math.max(obj.width || 0, obj.height || 0) / 2 || DEFAULT_VILLE_RADIUS;
        villes.push({ name: obj.name || "Ville", x: cx, y: cy, radius: r });
      }
    }

    setupCollisions(this);
    addLayerColliders(this);

    if (createdLayers["lampadaire + bancs + panneaux"]) {
      try { this.physics.add.collider(player, createdLayers["lampadaire + bancs + panneaux"]); } catch(e) {}
    }

    this.cameras.main.startFollow(player, false, 1, 1);
    this.cameras.main.setZoom(2.5);
    this.cameras.main.setBounds(0,0, map.widthInPixels, map.heightInPixels);

    const miniW = 220, miniH = 160, miniZoom = 0.22;
    minimapCam = this.cameras.add(window.innerWidth - miniW - 12, 12, miniW, miniH);
    minimapCam.setZoom(miniZoom).startFollow(player);

    playerMiniArrow = this.add.triangle(minimapCam.x + miniW/2, minimapCam.y + miniH/2, 0,12, 12,12, 6,0, 0xff0000)
      .setScrollFactor(0).setDepth(11001);
    playerMiniArrow.setVisible(true);

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

    this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player",{ start:0, end:2 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player",{ start:3, end:5 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player",{ start:6, end:8 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player",{ start:9, end:11 }), frameRate:6, repeat:-1 });
    this.anims.create({ key: "idle-down", frames: [{ key:"player", frame:1 }] });
    this.anims.create({ key: "idle-left", frames: [{ key:"player", frame:4 }] });
    this.anims.create({ key: "idle-right", frames: [{ key:"player", frame:7 }] });
    this.anims.create({ key: "idle-up", frames: [{ key:"player", frame:10 }] });

    const g = this.make.graphics({ x:0, y:0, add:false });
    g.fillStyle(0xffffff, 1).fillCircle(4,4,4);
    g.generateTexture("dust", 8, 8);
    const particles = this.add.particles("dust");
    dustEmitter = particles.createEmitter({
      x:0, y:0, speed:{ min:-40, max:40 }, angle:{ min:200, max:340 },
      scale:{ start:0.27, end:0 }, alpha:{ start:0.8, end:0 }, lifespan:400, on:false
    });
    dustEmitter.startFollow(player, 0, -6);

    bindMobileControls();

    const introBtn = document.getElementById("introStart");
    if (introBtn) {
      introBtn.onclick = () => {
        const intro = document.getElementById("intro");
        if (intro) intro.style.display = "none";
        try { document.getElementById("bgm")?.play(); } catch(_) {}
        showCityBanner("Avezzano");
      };
    }
  }

  // -------------------------------
  // UPDATE
  // -------------------------------
  function update() {
    if (!player) return;

    if (Phaser.Input.Keyboard.JustDown(toggleCollisionsKey)) {
      godModeActive = !godModeActive;
      if (godModeActive) {
        disableCollisionsForGodMode(getScene());
        showTempDebugNotice("GOD MODE ON (D) — collisions désactivées");
      } else {
        enableCollisionsFromGodMode(getScene());
        showTempDebugNotice("GOD MODE OFF (D) — collisions réactivées");
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
        const d = player.anims.currentAnim.key;
        if (["up","down","left","right"].includes(d)) player.anims.play("idle-" + d, true);
      }
    }

    player.setDepth(player.y);
    dustEmitter.on = isRunning && (Math.abs(vx) > 1 || Math.abs(vy) > 1);

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

    currentPOI = null;
    for (let poi of poiData) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
      if (d < POI_RADIUS) {
        currentPOI = poi;
        if (!isMobile) showPressE();
        break;
      }
    }
    if (!currentPOI && !isMobile) hidePressE();

    if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
      showInteraction(currentPOI);
    }

    let inVille = null;
    for (let v of villes) {
      const d = Phaser.Math.Distance.Between(player.x, player.y, v.x, v.y);
      if (d < v.radius) { inVille = v.name; break; }
    }
    if (inVille && inVille !== currentVille) {
      currentVille = inVille;
      showCityBanner(inVille);
    }

    if (!godModeActive) debugCheckBlocking();
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
    setTimeout(() => {
      banner.innerText = name;
      banner.classList.add("show");
      overlay.classList.remove("active");
      setTimeout(()=>banner.classList.remove("show"), 4000);
    }, 420);
  }

  // -------------------------------
  // COLLISION UTILITIES
  // -------------------------------
  function setupCollisions(scene) {
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (!layer) continue;
      if (COLLISION_LAYERS.includes(name)) {
        try {
          layer.setCollisionByExclusion([-1]);
          try { layer.setCollision(IGNORE_TILE_INDICES, false, true); } catch(e) {}
          layer.forEachTile(tile => {
            if (tile && IGNORE_TILE_INDICES.includes(tile.index)) {
              try { tile.setCollision(false, false, false, false); } catch(e){}
            }
          });
        } catch (err) {
          console.warn("setupCollisions error for", name, err);
        }
      }
    }
  }

  function addLayerColliders(scene) {
    for (let c of layerColliders) {
      try { c.destroy(); } catch(_) {}
    }
    layerColliders = [];
    for (const [name, layer] of Object.entries(createdLayers)) {
      if (layer && COLLISION_LAYERS.includes(name)) {
        try {
          const col = scene.physics.add.collider(player, layer);
          layerColliders.push(col);
        } catch(e) { console.warn("collider fail", name, e); }
      }
    }
    collisionsEnabled = true;
  }

  function removeLayerColliders(scene) {
    for (let c of layerColliders) {
      try { c.destroy(); } catch(_) {}
    }
    layerColliders = [];
    collisionsEnabled = false;
  }

  function disableCollisionsForGodMode(scene) {
    removeLayerColliders(scene);
    if (isMobile && player && player.body) {
      player.body.enable = false;
    }
  }
  function enableCollisionsFromGodMode(scene) {
    addLayerColliders(scene);
    if (isMobile && player && player.body) {
      player.body.enable = true;
      player.setCollideWorldBounds(true);
    }
  }

  function debugCheckBlocking() {
    const blockingLayer = createdLayers["bord de map"];
    if (!blockingLayer) return;
    const tx = blockingLayer.worldToTileX(player.x);
    const ty = blockingLayer.worldToTileY(player.y);
    const tile = blockingLayer.getTileAt(tx, ty);
    if (tile && !IGNORE_TILE_INDICES.includes(tile.index)) {
      if (tile.index > 0) console.log("BLOCKING tile", tile.index, "at", tx, ty);
    }
  }

  // -------------------------------
  // MISC
  // -------------------------------
  function getScene() { return game.scene.scenes[0]; }

  function showTempDebugNotice(msg) {
    let n = document.getElementById("debugNotice");
    if (!n) {
      n = document.createElement("div");
      n.id = "debugNotice";
      Object.assign(n.style, {
        position:"absolute", top:"10px", right:"10px", background:"rgba(0,0,0,0.7)", color:"#fff",
        padding:"8px 12px", borderRadius:"8px", zIndex:"9999", fontSize:"14px"
      });
      document.body.appendChild(n);
    }
    n.innerText = msg;
    n.style.display = "block";
    setTimeout(()=>{ n.style.display="none"; }, 2000);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }
  function escapeAttr(s) {
    return String(s).replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  // -------------------------------
  // MOBILE CONTROLS
  // -------------------------------
  function bindMobileControls() {
    if (!isMobile) return;
    const mobileBtns = document.getElementById("mobile-buttons");
    if (!mobileBtns) return;
    const attach = (id,prop)=>{ const b=document.getElementById(id); if(!b) return; b.ontouchstart=()=>{mobileInput[prop]=true;}; b.ontouchend=()=>{mobileInput[prop]=false;}; };
    attach("btn-up","up"); attach("btn-down","down"); attach("btn-left","left"); attach("btn-right","right"); attach("btn-run","run");

    // add god mode toggle for mobile
    let btnGod = document.getElementById("btn-god");
    if (!btnGod) {
      btnGod = document.createElement("button");
      btnGod.id = "btn-god";
      btnGod.innerText = "GOD";
      Object.assign(btnGod.style, {
        position:"absolute", bottom:"80px", right:"20px",
        background:"red", color:"white", padding:"12px 18px",
        borderRadius:"50%", border:"none", fontWeight:"bold",
        fontSize:"16px", zIndex:"9999"
      });
      document.body.appendChild(btnGod);
    }
    btnGod.ontouchstart = () => {
      godModeActive = !godModeActive;
      if (godModeActive) {
        disableCollisionsForGodMode(getScene());
        showTempDebugNotice("GOD MODE ON (Mobile)");
      } else {
        enableCollisionsFromGodMode(getScene());
        showTempDebugNotice("GOD MODE OFF (Mobile)");
      }
    };
  }

}; // END window.onload
