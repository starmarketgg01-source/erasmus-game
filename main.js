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

    let player, cursors, map, poiData = [], interactionKey, currentPOI = null, interactionBox;
    let joystick, interactBtn;
    let minimapCam, playerMiniArrow;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    function preload() {
        console.log("Chargement...");

        // Map & tiles
        this.load.tilemapTiledJSON("map", "images/maps/erasmus.tmj");
        this.load.image("tileset_part1", "images/maps/tileset_part1.png.png");
        this.load.image("tileset_part2", "images/maps/tileset_part2.png.png");
        this.load.image("tileset_part3", "images/maps/tileset_part3.png.png");

        // Spritesheet joueur (144x144 chaque frame)
        this.load.spritesheet("player", "images/characters/player.png", {
            frameWidth: 144,
            frameHeight: 144
        });

        // Plugin joystick mobile
        if (isMobile) {
            this.load.scenePlugin({
                key: 'rexvirtualjoystickplugin',
                url: 'https://cdn.jsdelivr.net/npm/phaser3-rex-plugins/dist/rexvirtualjoystickplugin.min.js',
                sceneKey: 'rexUI'
            });
        }
    }

    function create() {
        console.log("Création...");

        map = this.make.tilemap({ key: "map" });
        const tileset1 = map.addTilesetImage("tileset_part1.png", "tileset_part1");
        const tileset2 = map.addTilesetImage("tileset_part2.png", "tileset_part2");
        const tileset3 = map.addTilesetImage("tileset_part3.png", "tileset_part3");

        // Calques + collisions
        const collisionLayers = ["water", "rails", "bord de map", "vegetation 1", "batiments 1", "batiments 2"];
        map.layers.forEach(layerData => {
            const name = layerData.name;
            const layer = map.createLayer(name, [tileset1, tileset2, tileset3], 0, 0);
            if (collisionLayers.includes(name)) {
                layer.setCollisionByExclusion([-1]);
                this.physics.add.collider(player, layer);
                console.log("Collision activée sur :", name);
            }
        });

        // Spawn joueur + POI
        const objectLayer = map.getObjectLayer("POI");
        if (objectLayer) {
            objectLayer.objects.forEach(obj => {
                if (obj.name === "spawn_avezzano") {
                    player = this.physics.add.sprite(obj.x, obj.y, "player", 0);
                    player.setOrigin(0.5, 1);
                    player.setScale(0.5); // Taille style Pokémon
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

        // Caméra principale
        this.cameras.main.startFollow(player, true, 0.1, 0.1);
        this.cameras.main.setZoom(2.5);

        // Minimap
        minimapCam = this.cameras.add(window.innerWidth - 210, 10, 200, 150)
            .setZoom(0.2)
            .startFollow(player);

        playerMiniArrow = this.add.triangle(
            minimapCam.x + 100,
            minimapCam.y + 75,
            0, 16, 16, 16, 8, 0,
            0xff0000
        ).setScrollFactor(0).setDepth(1001);

        // Clavier
        cursors = this.input.keyboard.createCursorKeys();
        interactionKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

        // Interaction box
        interactionBox = document.createElement("div");
        interactionBox.id = "interaction-box";
        interactionBox.style.display = "none";
        document.body.appendChild(interactionBox);

        // Animations joueur
        this.anims.create({ key: "down", frames: this.anims.generateFrameNumbers("player", { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
        this.anims.create({ key: "left", frames: this.anims.generateFrameNumbers("player", { start: 3, end: 5 }), frameRate: 8, repeat: -1 });
        this.anims.create({ key: "right", frames: this.anims.generateFrameNumbers("player", { start: 6, end: 8 }), frameRate: 8, repeat: -1 });
        this.anims.create({ key: "up", frames: this.anims.generateFrameNumbers("player", { start: 9, end: 11 }), frameRate: 8, repeat: -1 });

        // 🎮 Mobile joystick
        if (isMobile) {
            joystick = this.rexUI.add.joystick({
                x: 100,
                y: window.innerHeight - 100,
                radius: 50,
                base: this.add.circle(0, 0, 50, 0x888888, 0.5),
                thumb: this.add.circle(0, 0, 25, 0xcccccc, 0.8),
            });

            interactBtn = document.createElement("div");
            interactBtn.id = "interactBtn";
            interactBtn.innerText = "E";
            interactBtn.style.position = "absolute";
            interactBtn.style.bottom = "100px";
            interactBtn.style.right = "20px";
            interactBtn.style.width = "60px";
            interactBtn.style.height = "60px";
            interactBtn.style.background = "rgba(0,0,0,0.6)";
            interactBtn.style.color = "#fff";
            interactBtn.style.fontSize = "32px";
            interactBtn.style.borderRadius = "50%";
            interactBtn.style.display = "flex";
            interactBtn.style.alignItems = "center";
            interactBtn.style.justifyContent = "center";
            interactBtn.style.zIndex = "999";
            document.body.appendChild(interactBtn);

            interactBtn.addEventListener("click", () => { if (currentPOI) showInteraction(currentPOI); });
        }
    }

    function update() {
        if (!player) return;
        const speed = 150;
        player.setVelocity(0);

        // Mobile joystick
        if (isMobile && joystick) {
            const force = joystick.force;
            const angle = joystick.angle;
            if (force > 0) {
                const rad = Phaser.Math.DegToRad(angle);
                player.setVelocityX(Math.cos(rad) * speed * force);
                player.setVelocityY(Math.sin(rad) * speed * force);
                if (angle >= -45 && angle <= 45) player.anims.play("right", true);
                else if (angle >= 135 || angle <= -135) player.anims.play("left", true);
                else if (angle > 45 && angle < 135) player.anims.play("down", true);
                else player.anims.play("up", true);
            } else player.anims.stop();
        } else {
            // PC clavier
            if (cursors.left.isDown) { player.setVelocityX(-speed); player.anims.play("left", true); }
            else if (cursors.right.isDown) { player.setVelocityX(speed); player.anims.play("right", true); }
            else if (cursors.up.isDown) { player.setVelocityY(-speed); player.anims.play("up", true); }
            else if (cursors.down.isDown) { player.setVelocityY(speed); player.anims.play("down", true); }
            else player.anims.stop();
        }

        player.setDepth(player.y);

        // Mini-map flèche
        playerMiniArrow.x = minimapCam.worldView.x + player.x * 0.2;
        playerMiniArrow.y = minimapCam.worldView.y + player.y * 0.2;

        // POI
        currentPOI = null;
        for (let poi of poiData) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, poi.x, poi.y);
            if (dist < 40) { currentPOI = poi; if (!isMobile) showPressE(); break; }
        }
        if (!currentPOI && !isMobile) hidePressE();
        if (!isMobile && currentPOI && Phaser.Input.Keyboard.JustDown(interactionKey)) showInteraction(currentPOI);
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

    function hidePressE() { const e = document.getElementById("pressE"); if (e) e.remove(); }

    function showInteraction(poi) {
        document.body.classList.add("overlay-active");
        let imgPath = poi.image;
        if (imgPath && !imgPath.startsWith("images/")) imgPath = "images/" + imgPath;
        interactionBox.innerHTML = `
            <div class="interaction-content">
                <button id="closeBox">✖</button>
                <h2>${poi.title}</h2>
                <p>${poi.description}</p>
                ${imgPath ? `<img src="${imgPath}" alt="${poi.title}">` : ""}
            </div>`;
        interactionBox.style.display = "flex";
        document.getElementById("closeBox").onclick = () => {
            interactionBox.style.display = "none";
            document.body.classList.remove("overlay-active");
        };
    }
};
