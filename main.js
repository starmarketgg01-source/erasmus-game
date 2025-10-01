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
        console.log("Chargement…");

        // Charger la carte
        this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");

        // Charger les tilesets
        this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
        this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
        this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

        // Spritesheet du joueur
        this.load.spritesheet("player", "images/characters/player.png", {
            frameWidth: 32,
            frameHeight: 32
        });
    }

    function create() {
        console.log("Création…");

        map = this.make.tilemap({ key: "map" });

        const tileset1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
        const tileset2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
        const tileset3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");

        const layers = map.layers.map(l => l.name);
        console.log("Calques disponibles :", layers);

        // Créer toutes les couches visibles
        layers.forEach(layerName => {
            const layer = map.createLayer(layerName, [tileset1, tileset2, tileset3], 0, 0);

            // Collision sur certains calques
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

            if (collisionLayers.includes(layerName)) {
                layer.setCollisionByExclusion([-1]);
                console.log("Collision activée sur :", layerName);
            }
        });

        // Charger le calque d’objets POI
        const objectLayer = map.getObjectLayer("POI");
        if (objectLayer) {
            objectLayer.objects.forEach(obj => {
                if (obj.name === "spawn_avezzano") {
                    // Spawn du joueur
                    player = this.physics.add.sprite(obj.x, obj.y, "player", 1);
                    player.setOrigin(0.5, 0.5);
                    player.setCollideWorldBounds(true);
                    player.setScale(1); // taille correcte du sprite
                } else {
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

        console.log("POI trouvés :", poiData);

        // Animations du joueur
        this.anims.create({
            key: "down",
            frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }),
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: "left",
            frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }),
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: "right",
            frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }),
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: "up",
            frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }),
            frameRate: 8,
            repeat: -1
        });

        // Caméra suit le joueur
        this.cameras.main.startFollow(player);
        this.cameras.main.setZoom(1.2); // zoom équilibré

        cursors = this.input.keyboard.createCursorKeys();
        interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

        // Interaction box (DOM)
        interactionBox = document.createElement("div");
        interactionBox.id = "interaction-box";
        interactionBox.style.display = "none";
        document.body.appendChild(interactionBox);
    }

    function update() {
        if (!player) return;

        let speed = 150;
        player.setVelocity(0);

        if (cursors.left.isDown) {
            player.setVelocityX(-speed);
            player.anims.play("left", true);
        } else if (cursors.right.isDown) {
            player.setVelocityX(speed);
            player.anims.play("right", true);
        } else if (cursors.up.isDown) {
            player.setVelocityY(-speed);
            player.anims.play("up", true);
        } else if (cursors.down.isDown) {
            player.setVelocityY(speed);
            player.anims.play("down", true);
        } else {
            player.anims.stop();
        }

        // Vérifier proximité avec un POI
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

        // Ouvrir interaction
        if (currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) {
            showInteraction(currentPOI);
        }
    }

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
            document.body.appendChild(e);
        }
    }

    function hidePressE() {
        const e = document.getElementById("pressE");
        if (e) e.remove();
    }

    function showInteraction(poi) {
        // Fond assombri
        document.body.classList.add("overlay-active");

        interactionBox.innerHTML = `
            <div class="interaction-content">
                <button id="closeBox">✖</button>
                <h2>${poi.title}</h2>
                <p>${poi.description}</p>
                ${poi.image ? `<img src="images/${poi.image}" alt="${poi.title}">` : ""}
            </div>
        `;
        interactionBox.style.display = "flex";

        document.getElementById("closeBox").onclick = () => {
            interactionBox.style.display = "none";
            document.body.classList.remove("overlay-active");
        };
    }
};
