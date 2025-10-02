// ==================
// GLOBAL VARIABLES
// ==================
let map;
let player;
let cursors;
let villeText;
let villes = [];
let createdLayers = {}; // pour debug + accès global
const collisionLayers = ["bord de map", "collision", "arbre", "maison", "grotte", "rocher"];

// ==================
// CONFIG PHASER
// ==================
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  physics: {
    default: "arcade",
    arcade: {
      debug: true, // active les hitboxes visibles
    },
  },
  scene: {
    preload: preload,
    create: create,
    update: update,
  },
};

const game = new Phaser.Game(config);

// ==================
// PRELOAD
// ==================
function preload() {
  this.load.image("tiles", "assets/tiles.png");
  this.load.tilemapTiledJSON("map", "assets/erasmus.tmj");
  this.load.spritesheet("player", "assets/player.png", {
    frameWidth: 32,
    frameHeight: 48,
  });
}

// ==================
// CREATE
// ==================
function create() {
  // Load map
  map = this.make.tilemap({ key: "map" });
  const tileset = map.addTilesetImage("tiles", "tiles");

  // Crée tous les calques
  createdLayers = {}; // reset global
  map.layers.forEach((ld) => {
    const name = ld.name;
    if (["lampadaire + bancs + panneaux", "lampadaire_base", "lampadaire_haut"].includes(name)) return;
    const layer = map.createLayer(name, tileset, 0, 0);
    createdLayers[name] = layer;
    if (collisionLayers.includes(name)) {
      layer.setCollisionByExclusion([-1]);
    }
  });

  // Spawn joueur
  const spawnPoint = map.findObject("Objects", (obj) => obj.name === "spawn_avezzano");
  player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, "player", 1);
  player.setCollideWorldBounds(true);

  // Ajout collisions
  Object.entries(createdLayers).forEach(([name, layer]) => {
    if (collisionLayers.includes(name)) this.physics.add.collider(player, layer);
  });

  // Caméra
  this.cameras.main.startFollow(player);

  // Villes (layer "VILLE")
  const villeLayer = map.getObjectLayer("VILLE");
  if (villeLayer) {
    villeLayer.objects.forEach((obj) => {
      villes.push({
        name: obj.name,
        x: obj.x,
        y: obj.y,
        radius: 150,
      });
    });
  }

  // Texte nom ville
  villeText = this.add.text(16, 16, "", {
    fontSize: "24px",
    fill: "#fff",
    backgroundColor: "rgba(0,0,0,0.5)",
  });
  villeText.setScrollFactor(0);

  // Input
  cursors = this.input.keyboard.createCursorKeys();
}

// ==================
// UPDATE
// ==================
function update() {
  if (!player) return;

  const speed = 200;
  player.setVelocity(0);

  if (cursors.left.isDown) {
    player.setVelocityX(-speed);
  } else if (cursors.right.isDown) {
    player.setVelocityX(speed);
  }
  if (cursors.up.isDown) {
    player.setVelocityY(-speed);
  } else if (cursors.down.isDown) {
    player.setVelocityY(speed);
  }

  // Check villes
  let inVille = false;
  for (const ville of villes) {
    const dx = player.x - ville.x;
    const dy = player.y - ville.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < ville.radius) {
      villeText.setText(ville.name);
      inVille = true;
      break;
    }
  }
  if (!inVille) villeText.setText("");

  // Debug : check si bloqué
  debugCheckBlocking();
}

// ==================
// DEBUG FUNCTION
// ==================
function debugCheckBlocking() {
  if (!player || !player.body) return;
  const body = player.body;
  if (!(body.blocked.left || body.blocked.right || body.blocked.up || body.blocked.down)) return;

  const checks = [
    { dir: "left", dx: -16, dy: 0 },
    { dir: "right", dx: 16, dy: 0 },
    { dir: "up", dx: 0, dy: -16 },
    { dir: "down", dx: 0, dy: 16 },
  ];

  for (const c of checks) {
    if (!body.blocked[c.dir]) continue;
    const wx = player.x + c.dx;
    const wy = player.y + c.dy;
    console.warn(`⚠️ Player blocked ${c.dir} — check (${Math.round(wx)}, ${Math.round(wy)})`);

    for (const [layerName, tLayer] of Object.entries(createdLayers)) {
      try {
        const tile = tLayer.getTileAtWorldXY(wx, wy, true);
        if (tile && tile.index !== -1) {
          console.log(
            `  → layer "${layerName}" a tile index=${tile.index} at (${tile.x},${tile.y})`,
            tile.properties || {}
          );
        }
      } catch (err) {
        // ignore si pas TilemapLayer
      }
    }
  }
}
