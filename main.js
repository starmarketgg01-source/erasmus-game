window.onload = function () {
    const config = {
        type: Phaser.AUTO,
        width: window.innerWidth,
        height: window.innerHeight,
        parent: "game",
        physics: {
            default: "arcade",
            arcade: {
                debug: false
            }
        },
        scene: {
            preload: preload,
            create: create,
            update: update
        }
    };

    const game = new Phaser.Game(config);

    let player;
    let cursors;
    let map;
    let poiData = [];
    let interactionKey;
    let currentPOI = null;
    let interactionBox;

    function preload() {
        console.log("🔄 Chargement...");

        // Charger la carte TMJ
        this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");

        // Charger les tilesets
        this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
        this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
        this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

        // Générer une texture rouge pour le joueur
        this.textures.generate("playerRed", {
            data: ["2"],
            pixelWidth: 16,
            pixelHeight: 16,
            palette: { 2: "#ff0000" }
        });
    }

    function create() {
        console.log("🛠️ Création...");

        // Charger la carte
        map = this.make.tilemap({ key: "map" });

        const tileset1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
        const tileset2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
        const tileset3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");

        // Créer toutes les couches
        const layers = map.layers.map(l => l.name);
        console.log("📜 Calques disponibles :", layers);

        const collisionLayers = [
            "water",
            "lampadaire + bancs + panneaux",
            "rails",
            "piscine",
            "bord de map",
            "vegetation 1",
            "batiments 1",
            "batiments 2"
        ];

        layers.forEach(layerName => {
            const layer = map.createLayer(layerName, [tileset1, tileset2, tileset3], 0, 0);

            if (collisionLayers.includes(layerName)) {
                layer.setCollisionByExclusion([-1]);
                console.log("✅ Collision activée sur :", layerName);

                // Important : ajouter collider
                if (player) this.physics.add.collider(player, layer);
            }
        });

        // Charger le calque des objets POI
        const objectLayer = map.getObjectLayer("POI");
        if (objectLayer) {
            objectLayer.objects.forEach(obj => {
                if (obj.name === "spawn_avezzano") {
                    // Spawn joueur
                    player = this.physics.add.sprite(obj.x, obj.y, "playerRed");
                    player.setOrigin(0, 1);
                    player.setCollideWorldBounds(true);
                    console.log("🚶 Joueur créé en spawn_avezzano :", obj.x, obj.y);
                } else {
                    // Charger infos POI
                    poiData.push({
                        x: obj.x,
                        y: obj.y,
                        title: obj.properties.find(p => p.name === "title")?.value || obj.name,
                        description: obj.properties.find(p => p.name === "text")?.value || "Aucune description disponible.",
                        image: obj.properties.find(p => p.name === "media")?.value || null
                    });
                }
            });
        }

        console.log("📍 POI trouvés :", poiData);

        // Si le joueur existe, refaire les collisions
        if (player) {
            layers.forEach(layerName => {
                if (collisionLayers.includes(layerName)) {
                    const layer = map.getLayer(layerName).tilemapLayer;
                    this.physics.add.collider(player, layer);
                }
            });
        }

        // Caméra
        if (player) {
            this.cameras.main.startFollow(player);
            this.cameras.main.setZoom(2);
        }

        // Contrôles
        cursors = this.input.keyboard.createCursorKeys();
        interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

        // Créer la box DOM pour interactions
        interactionBox = document.createElement("div");
        interactionBox.id = "interaction-box";
        interactionBox.style.display = "none";
        document.body.appendChild(interactionBox);
    }

    function update() {
        if (!player) return;

        const speed = 150;
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

        // Vérifier proximité POI
        currentPOI = null;
        for (let poi of poiData) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
            if (dist < 40) {
                currentPOI = poi;
                showPressE();
                break;
            }
        }

        if (!currentPOI) hidePressE();

        // Interaction avec POI
        if (currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
            showInteraction(currentPOI);
        }
    }

    // --- UI ---

    function showPressE() {
        if (!document.getElementById("pressE")) {
            const e = document.createElement("div");
            e.id = "pressE";
            e.innerText = "Appuie sur E";
            e.style.position = "absolute";
            e.style.top = "20px";
            e.style.left = "50%";
            e.style.transform = "translateX(-50%)";
            e.style.background = "rgba(0,0,0,0.7)";
            e.style.color = "#fff";
            e.style.padding = "5px 10px";
            e.style.borderRadius = "5px";
            e.style.zIndex = "1000";
            document.body.appendChild(e);
        }
    }

    function hidePressE() {
        const e = document.getElementById("pressE");
        if (e) e.remove();
    }

    function showInteraction(poi) {
        document.body.classList.add("overlay-active");

        interactionBox.innerHTML = `
            <div class="interaction-content">
                <button id="closeBox">✖</button>
                <h2>${poi.title}</h2>
                <p>${poi.description}</p>
                ${poi.image ? `<img src="${poi.image}" alt="${poi.title}">` : ""}
            </div>
        `;
        interactionBox.style.display = "flex";

        document.getElementById("closeBox").onclick = () => {
            interactionBox.style.display = "none";
            document.body.classList.remove("overlay-active");
        };
    }
};

