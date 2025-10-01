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

    let player, cursors, map;
    let poiData = [];
    let interactionKey;
    let currentPOI = null;
    let interactionBox;

    // === Mobile joystick + bouton E ===
    let joystick, interactButton;
    let isMobile = /Mobi|Android/i.test(navigator.userAgent);

    // === Mini-map ===
    let minimap;
    let arrow;

    function preload() {
        console.log("Chargement...");

        // Charger la carte
        this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");

        // Charger les tilesets
        this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
        this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
        this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

        // Charger spritesheet du joueur (12 frames, 3 colonnes × 4 lignes)
        this.load.spritesheet("player", "images/characters/player.png", {
            frameWidth: 144,
            frameHeight: 144
        });

        // Joystick plugin (phaser3-nipplejs par exemple si dispo)
        this.load.plugin('rexvirtualjoystickplugin',
            'https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexvirtualjoystickplugin.min.js',
            true);
    }

    function create() {
        console.log("Création...");

        map = this.make.tilemap({ key: "map" });

        const tileset1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
        const tileset2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
        const tileset3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");

        // Charger toutes les couches
        map.layers.forEach(layerData => {
            let layer = map.createLayer(layerData.name, [tileset1, tileset2, tileset3], 0, 0);

            // Collision sur certains calques
            const collisionLayers = [
                "water", "rails", "piscine", "bord de map",
                "vegetation 1", "vegetation 2",
                "batiments 1", "batiments 2",
                "lampadaire + bancs + panneaux"
            ];
            if (collisionLayers.includes(layerData.name)) {
                layer.setCollisionByExclusion([-1]);
            }

            if (layerData.name === "lampadaire_base") {
                layer.setCollisionByExclusion([-1]);
            }
        });

        // POI
        const objectLayer = map.getObjectLayer("POI");
        if (objectLayer) {
            objectLayer.objects.forEach(obj => {
                if (obj.name === "spawn_avezzano") {
                    player = this.physics.add.sprite(obj.x, obj.y, "player", 0);
                    player.setOrigin(0, 1);
                    player.setScale(1.2); // ✅ joueur réaliste
                    player.setCollideWorldBounds(true);
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

        // Caméra
        this.cameras.main.startFollow(player);
        this.cameras.main.setZoom(2.5);

        cursors = this.input.keyboard.createCursorKeys();
        interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

        // Interaction box
        interactionBox = document.createElement("div");
        interactionBox.id = "interaction-box";
        interactionBox.style.display = "none";
        document.body.appendChild(interactionBox);

        // Animations joueur
        this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 10, repeat: -1 });
        this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 10, repeat: -1 });
        this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 10, repeat: -1 });
        this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 10, repeat: -1 });

        // ✅ Mini-map
        minimap = this.cameras.add(config.width - 220, 20, 200, 200).setZoom(0.1).setName('mini');
        minimap.setBackgroundColor(0x002244);
        minimap.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        minimap.startFollow(player);

        // Flèche du joueur
        arrow = this.add.triangle(0, 0, 0, 20, 10, 0, 20, 20, 0xff0000);
        arrow.setScale(3);
        arrow.setDepth(2000);

        // === Mobile ===
        if (isMobile) {
            joystick = this.plugins.get('rexvirtualjoystickplugin').add(this, {
                x: 100,
                y: config.height - 100,
                radius: 50,
                base: this.add.circle(0, 0, 50, 0x888888),
                thumb: this.add.circle(0, 0, 25, 0xcccccc),
            });

            interactButton = this.add.text(config.width - 100, config.height - 100, 'E', {
                fontSize: '32px',
                backgroundColor: '#000',
                color: '#fff',
                padding: { x: 20, y: 10 }
            }).setInteractive();

            interactButton.on('pointerdown', () => {
                if (currentPOI) showInteraction(currentPOI);
            });
        }

        // Collisions joueur
        map.layers.forEach(layerData => {
            let layer = map.getLayer(layerData.name)?.tilemapLayer;
            if (layer && layer.collideIndexes.length > 0) {
                this.physics.add.collider(player, layer);
            }
        });

        // ✅ Assurer que lampadaire_haut est toujours devant
        const lampHighLayer = map.getLayer("lampadaire_haut")?.tilemapLayer;
        if (lampHighLayer) lampHighLayer.setDepth(1000);
    }

    function update() {
        if (!player) return;

        let speed = 150;
        player.setVelocity(0);

        // PC clavier
        if (!isMobile) {
            if (cursors.left.isDown) { player.setVelocityX(-speed); player.anims.play("left", true); }
            else if (cursors.right.isDown) { player.setVelocityX(speed); player.anims.play("right", true); }
            else if (cursors.up.isDown) { player.setVelocityY(-speed); player.anims.play("up", true); }
            else if (cursors.down.isDown) { player.setVelocityY(speed); player.anims.play("down", true); }
            else { player.setVelocity(0); player.anims.stop(); }
        }

        // Mobile joystick
        if (isMobile && joystick) {
            let forceX = joystick.forceX;
            let forceY = joystick.forceY;
            player.setVelocity(forceX * 2, forceY * 2);

            if (Math.abs(forceX) > Math.abs(forceY)) {
                player.anims.play(forceX > 0 ? "right" : "left", true);
            } else if (Math.abs(forceY) > 0) {
                player.anims.play(forceY > 0 ? "down" : "up", true);
            } else {
                player.anims.stop();
            }
        }

        // Profondeur dynamique
        player.setDepth(player.y);

        // Flèche mini-map
        arrow.x = player.x;
        arrow.y = player.y;
        arrow.rotation = player.body.velocity.angle();

        // POI proximité
        currentPOI = null;
        for (let poi of poiData) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
            if (dist < 40) {
                currentPOI = poi;
                if (!isMobile) showPressE();
                break;
            }
        }
        if (!currentPOI && !isMobile) hidePressE();

        if (currentPOI && !isMobile && Phaser.Input.Keyboard.JustDown(interactionKey)) {
            showInteraction(currentPOI);
        }
    }

    // UI interaction
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

