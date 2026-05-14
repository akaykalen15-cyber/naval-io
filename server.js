const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// FIXED: Serve files from current directory (not public folder)
app.use(express.static(__dirname));

let players = {};
let zombies = {};
let wave = 1;
let zombieIdCounter = 0;

const MAP_WIDTH = 3000;
const MAP_HEIGHT = 3000;

const zombieTypes = {
    regular: { health: 1, speed: 1.5, points: 10, color: '#2d5a27', size: 20 },
    fast: { health: 1, speed: 3.0, points: 15, color: '#6b8c42', size: 18 },
    tank: { health: 5, speed: 0.8, points: 50, color: '#1a3a1a', size: 30 },
    boss: { health: 20, speed: 1.0, points: 500, color: '#8b0000', size: 50 }
};

function getRandomSpawnPosition() {
    const side = Math.floor(Math.random() * 4);
    switch(side) {
        case 0: return { x: Math.random() * MAP_WIDTH, y: 0 };
        case 1: return { x: MAP_WIDTH, y: Math.random() * MAP_HEIGHT };
        case 2: return { x: Math.random() * MAP_WIDTH, y: MAP_HEIGHT };
        default: return { x: 0, y: Math.random() * MAP_HEIGHT };
    }
}

function spawnZombies() {
    let zombieCount = Math.min(5 + Math.floor(wave * 1.5), 50);
    
    for (let i = 0; i < zombieCount; i++) {
        let type = 'regular';
        let roll = Math.random();
        
        if (wave >= 3 && roll < 0.2) type = 'fast';
        else if (wave >= 5 && roll < 0.1) type = 'tank';
        
        const pos = getRandomSpawnPosition();
        const zombieId = 'zombie_' + zombieIdCounter++;
        
        zombies[zombieId] = {
            id: zombieId,
            x: pos.x,
            y: pos.y,
            type: type,
            health: zombieTypes[type].health,
            maxHealth: zombieTypes[type].health,
            ...zombieTypes[type]
        };
    }
    
    io.emit('zombiesUpdate', zombies);
    io.emit('waveUpdate', wave);
}

function checkWaveComplete() {
    if (Object.keys(zombies).length === 0) {
        wave++;
        io.emit('chatMessage', { username: 'System', message: `🎉 WAVE ${wave} COMPLETE! 🎉`, isSystem: true });
        spawnZombies();
    }
}

setInterval(() => {
    for (const id in zombies) {
        const zombie = zombies[id];
        
        let nearestPlayer = null;
        let nearestDist = Infinity;
        for (const pid in players) {
            const player = players[pid];
            const dist = Math.hypot(zombie.x - player.x, zombie.y - player.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestPlayer = player;
            }
        }
        
        if (nearestPlayer) {
            const dx = nearestPlayer.x - zombie.x;
            const dy = nearestPlayer.y - zombie.y;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
                zombie.x += (dx / len) * zombie.speed;
                zombie.y += (dy / len) * zombie.speed;
            }
        }
        
        zombie.x = Math.min(Math.max(zombie.x, 10), MAP_WIDTH - 10);
        zombie.y = Math.min(Math.max(zombie.y, 10), MAP_HEIGHT - 10);
    }
    io.emit('zombiesUpdate', zombies);
}, 50);

setInterval(() => {
    for (const zombieId in zombies) {
        const zombie = zombies[zombieId];
        for (const playerId in players) {
            const player = players[playerId];
            const dist = Math.hypot(zombie.x - player.x, zombie.y - player.y);
            if (dist < zombie.size + player.radius) {
                player.health = Math.max(0, player.health - 10);
                io.emit('playerUpdate', { id: playerId, health: player.health });
                
                if (player.health <= 0) {
                    player.health = 100;
                    player.score = Math.max(0, player.score - Math.floor(player.score * 0.2));
                    player.x = MAP_WIDTH / 2;
                    player.y = MAP_HEIGHT / 2;
                    io.emit('playerUpdate', { id: playerId, health: player.health, score: player.score, x: player.x, y: player.y });
                    io.emit('chatMessage', { username: 'System', message: `${player.username} was eaten!`, isSystem: true });
                }
                break;
            }
        }
    }
}, 100);

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('joinGame', (data) => {
        const username = data.username;
        const skin = data.skin || 'classic';
        
        players[socket.id] = {
            id: socket.id,
            username: username,
            x: MAP_WIDTH / 2,
            y: MAP_HEIGHT / 2,
            radius: 15,
            health: 100,
            maxHealth: 100,
            score: 0,
            damage: 1,
            fireRate: 300,
            speed: 3,
            lastShot: 0,
            skin: skin
        };
        
        socket.emit('currentPlayers', players);
        socket.emit('currentZombies', zombies);
        socket.emit('waveUpdate', wave);
        socket.broadcast.emit('newPlayer', players[socket.id]);
        
        console.log(`${username} joined Zombie.io`);
    });
    
    socket.on('playerMovement', (data) => {
        const player = players[socket.id];
        if (player) {
            player.x = data.x;
            player.y = data.y;
            socket.broadcast.emit('playerMoved', { id: socket.id, x: player.x, y: player.y });
        }
    });
    
    socket.on('playerShoot', (data) => {
        const player = players[socket.id];
        if (!player) return;
        
        const now = Date.now();
        if (now - player.lastShot < player.fireRate) return;
        player.lastShot = now;
        
        const angle = data.angle;
        const bullet = {
            id: Math.random().toString(36).substr(2, 8),
            x: player.x,
            y: player.y,
            angle: angle,
            ownerId: socket.id,
            damage: player.damage,
            range: 500,
            traveled: 0
        };
        
        io.emit('bulletShot', bullet);
        
        setTimeout(() => {
            for (const zombieId in zombies) {
                const zombie = zombies[zombieId];
                const dx = bullet.x - zombie.x;
                const dy = bullet.y - zombie.y;
                if (Math.hypot(dx, dy) < zombie.size) {
                    zombie.health -= bullet.damage;
                    if (zombie.health <= 0) {
                        player.score += zombie.points;
                        delete zombies[zombieId];
                        io.emit('zombieKilled', zombieId);
                        io.emit('scoreUpdate', { id: socket.id, score: player.score });
                        io.emit('chatMessage', { username: 'System', message: `${player.username} killed a ${zombie.type} zombie! +${zombie.points} points`, isSystem: true });
                        checkWaveComplete();
                    } else {
                        io.emit('zombieDamaged', { id: zombieId, health: zombie.health });
                    }
                    break;
                }
            }
        }, 50);
    });
    
    socket.on('upgrade', (type) => {
        const player = players[socket.id];
        if (!player) return;
        
        const cost = 100;
        if (player.score < cost) return;
        
        player.score -= cost;
        
        switch(type) {
            case 'damage':
                player.damage++;
                break;
            case 'fireRate':
                player.fireRate = Math.max(100, player.fireRate - 20);
                break;
            case 'speed':
                player.speed = Math.min(8, player.speed + 0.5);
                break;
            case 'health':
                player.maxHealth += 20;
                player.health = player.maxHealth;
                break;
        }
        
        io.emit('scoreUpdate', { id: socket.id, score: player.score });
        io.emit('playerUpdate', { id: socket.id, health: player.health, maxHealth: player.maxHealth, damage: player.damage, fireRate: player.fireRate, speed: player.speed });
        socket.emit('chatMessage', { username: 'System', message: `Upgraded ${type}!`, isSystem: true });
    });
    
    socket.on('chatMessage', (data) => {
        const player = players[socket.id];
        if (!player) return;
        io.emit('chatMessage', { username: player.username, message: data.message, isAdmin: false });
    });
    
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            io.emit('playerDisconnected', socket.id);
            delete players[socket.id];
        }
    });
});

spawnZombies();

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Zombie.io server running on port ${PORT}`);
    console.log(`🧟 Wave 1 started!`);
});
