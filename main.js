const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: 'arcade',
        arcade: {
            debug: false,
            gravity: { y: 0 }
        }
    },
    scene: { preload, create, update }
};

let player, cursors, joystick, interactButton;
let map, minimap, minimapCamera;
let lampBaseLayer, lampHighLayer;

const game = new Phaser.Game(config);

function preload() {
    this.load.image('tiles', 'images/tileset.png');
    this.load.tilemapTiledJSON('map', 'images/map.json');

    // --- SPRITE DU JOUEUR ---
    this.load.spritesheet('player', 'images/characters/player.png', {
        frameWidth: 144,
        frameHeight: 144
    });

    // Mobile joystick
    this.load.plugin('rexvirtualjoystickplugin', 
        'https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexvirtualjoystickplugin.min.js',
        true
    );
}

function create() {
    // --- MAP ---
    map = this.make.tilemap({ key: 'map' });
    const tileset = map.addTilesetImage('tileset', 'tiles');

    const groundLayer = map.createLayer('ground', tileset, 0, 0);
    const objLayer = map.createLayer('lampadaire + bancs + panneaux', tileset, 0, 0);
    lampBaseLayer = map.createLayer('lampadaire_base', tileset, 0, 0);
    lampHighLayer = map.createLayer('lampadaire_haut', tileset, 0, 0);

    // --- PLAYER ---
    player = this.physics.add.sprite(300, 300, 'player', 1);
    player.setScale(0.6);       // joueur réaliste
    player.setOrigin(0.5, 1);   // pied bien aligné
    player.setCollideWorldBounds(true);

    // --- COLLISIONS ---
    ;[objLayer, lampBaseLayer].forEach(layer => {
        if (layer && Array.isArray(layer.collideIndexes) && layer.collideIndexes.length > 0) {
            this.physics.add.collider(player, layer);
        }
    });

    // --- ANIMATIONS ---
    this.anims.create({
        key: 'down',
        frames: this.anims.generateFrameNumbers('player', { start: 0, end: 2 }),
        frameRate: 8,
        repeat: -1
    });
    this.anims.create({
        key: 'left',
        frames: this.anims.generateFrameNumbers('player', { start: 3, end: 5 }),
        frameRate: 8,
        repeat: -1
    });
    this.anims.create({
        key: 'right',
        frames: this.anims.generateFrameNumbers('player', { start: 6, end: 8 }),
        frameRate: 8,
        repeat: -1
    });
    this.anims.create({
        key: 'up',
        frames: this.anims.generateFrameNumbers('player', { start: 9, end: 11 }),
        frameRate: 8,
        repeat: -1
    });

    cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // --- CAMERA ---
    this.cameras.main.startFollow(player);
    this.cameras.main.setZoom(3);

    // --- MINIMAP ---
    minimapCamera = this.cameras.add(600, 20, 180, 180).setZoom(0.2).setName('mini');
    minimapCamera.startFollow(player);
    minimapCamera.setBackgroundColor(0x002244);

    // Bordure minimap
    const border = this.add.graphics();
    border.lineStyle(4, 0xffffff, 1);
    border.strokeRect(600, 20, 180, 180);

    // --- MOBILE CONTROLS ---
    if (!this.sys.game.device.os.desktop) {
        joystick = this.plugins.get('rexvirtualjoystickplugin').add(this, {
            x: 100,
            y: 500,
            radius: 50,
            base: this.add.circle(0, 0, 50, 0x888888),
            thumb: this.add.circle(0, 0, 25, 0xcccccc),
        }).on('update', () => {});

        interactButton = this.add.text(700, 500, 'E', {
            fontSize: '32px',
            backgroundColor: '#444',
            color: '#fff',
            padding: { x: 10, y: 5 }
        }).setInteractive();

        interactButton.on('pointerdown', () => {
            console.log("Interaction mobile !");
        });
    }

    // --- DEPTH ---
    lampHighLayer.setDepth(1000); // lampadaire haut toujours au-dessus
}

function update() {
    let speed = 150;
    let vx = 0, vy = 0;

    if (cursors.left.isDown) {
        vx = -speed;
        player.anims.play('left', true);
    } else if (cursors.right.isDown) {
        vx = speed;
        player.anims.play('right', true);
    } else if (cursors.up.isDown) {
        vy = -speed;
        player.anims.play('up', true);
    } else if (cursors.down.isDown) {
        vy = speed;
        player.anims.play('down', true);
    } else if (joystick) {
        let force = joystick.force;
        let angle = joystick.angle;
        if (force > 0) {
            vx = Math.cos(angle) * speed;
            vy = Math.sin(angle) * speed;
            if (Math.abs(vx) > Math.abs(vy)) {
                player.anims.play(vx > 0 ? 'right' : 'left', true);
            } else {
                player.anims.play(vy > 0 ? 'down' : 'up', true);
            }
        } else {
            player.anims.stop();
        }
    } else {
        player.anims.stop();
    }

    player.setVelocity(vx, vy);

    // Depth dynamique pour bien gérer les bancs / panneaux
    player.setDepth(player.y);
}
