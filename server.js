const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(__dirname));

let players = {};
let zombies = {};
let wave = 1;
let zombieIdCounter = 0;

const MAP_WIDTH = 4000;
const MAP_HEIGHT = 4000;

// Zombie types with realistic stats
const zombieTypes = {
    regular: { health: 3, damage: 10, speed: 1.2, points: 100, color: '#2d5a27', size: 25, headshotBonus: 50 },
    fast: { health: 2, damage: 8, speed: 2.5, points: 150, color: '#6b8c42', size: 22, headshotBonus: 75 },
    tank: { health: 10, damage: 20, speed: 0.6, points: 300, color: '#1a3a1a', size: 35, headshotBonus: 150 },
    boss: { health: 30, damage: 35, speed: 0.8, points: 1000, color: '#8b0000', size: 50, headshotBonus: 500 }
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
    let zombieCount = Math.min(3 + Math.floor(wave * 0.8), 25);
    
    for (let i = 0; i < zombieCount; i++) {
        let type = 'regular';
        let roll = Math.random();
        
        if (wave >= 5 && roll < 0.15) type = 'fast';
        else if (wave >= 8 && roll < 0.1) type = 'tank';
        else if (wave >= 12 && roll < 0.05) type = 'boss';
        
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
    io.emit('chatMessage', { username: 'System', message: `🧟 WAVE ${wave} - ${zombieCount} zombies approaching!`, isSystem: true });
}

function checkWaveComplete() {
    if (Object.keys(zombies).length === 0) {
        wave++;
        // Bonus points for completing wave
        for (const id in players) {
            players[id].score += wave * 50;
            io.emit('scoreUpdate', { id: id, score: players[id].score });
        }
        io.emit('chatMessage', { username: 'System', message: `🎉 WAVE ${wave} COMPLETE! +${wave * 50} bonus points! 🎉`, isSystem: true });
        spawnZombies();
    }
}

// Zombie movement
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

// Zombie attack cooldown tracking
let zombieAttackCooldown = {};

// Zombie attacks and player collisions
setInterval(() => {
    for (const zombieId in zombies) {
        const zombie = zombies[zombieId];
        for (const playerId in players) {
            const player = players[playerId];
            const dist = Math.hypot(zombie.x - player.x, zombie.y - player.y);
            if (dist < zombie.size + player.radius) {
                // Attack cooldown (1 second)
                const now = Date.now();
                if (!zombieAttackCooldown[zombieId] || now - zombieAttackCooldown[zombieId] > 1000) {
                    zombieAttackCooldown[zombieId] = now;
                    player.health = Math.max(0, player.health - zombie.damage);
                    io.emit('playerUpdate', { id: playerId, health: player.health });
                    io.emit('chatMessage', { username: 'System', message: `💥 ${player.username} took ${zombie.damage} damage from a ${zombie.type} zombie!`, isSystem: true });
                    
                    if (player.health <= 0) {
                        player.score = Math.max(0, player.score - Math.floor(player.score * 0.15));
                        player.health = 100;
                        player.x = MAP_WIDTH / 2;
                        player.y = MAP_HEIGHT / 2;
                        io.emit('playerUpdate', { id: playerId, health: player.health, score: player.score, x: player.x, y: player.y });
                        io.emit('scoreUpdate', { id: playerId, score: player.score });
                        io.emit('chatMessage', { username: 'System', message: `💀 ${player.username} was eaten!`, isSystem: true });
                    }
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
        
        players[socket.id] = {
            id: socket.id,
            username: username,
            x: MAP_WIDTH / 2,
            y: MAP_HEIGHT / 2,
            radius: 18,
            health: 100,
            maxHealth: 100,
            score: 0,
            damage: 25,
            fireRate: 300,
            speed: 4,
            lastShot: 0,
            kills: 0
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
    
    // REALISTIC SHOOTING WITH BULLET TRAVEL
    socket.on('playerShoot', (data) => {
        const player = players[socket.id];
        if (!player) return;
        
        const now = Date.now();
        if (now - player.lastShot < player.fireRate) return;
        player.lastShot = now;
        
        const angle = data.angle;
        const isHeadshot = data.isHeadshot || false;
        
        // Calculate bullet end position (raycast)
        const range = 800;
        const endX = player.x + Math.cos(angle) * range;
        const endY = player.y + Math.sin(angle) * range;
        
        const bullet = {
            id: Math.random().toString(36).substr(2, 8),
            startX: player.x,
            startY: player.y,
            endX: endX,
            endY: endY,
            ownerId: socket.id,
            damage: player.damage,
            isHeadshot: isHeadshot
        };
        
        io.emit('bulletShot', bullet);
        
        // Hit detection - check all zombies along bullet path
        let hit = false;
        for (const zombieId in zombies) {
            const zombie = zombies[zombieId];
            
            // Line-circle collision detection
            const dx = endX - player.x;
            const dy = endY - player.y;
            const len = Math.hypot(dx, dy);
            const dirX = dx / len;
            const dirY = dy / len;
            
            const toZombieX = zombie.x - player.x;
            const toZombieY = zombie.y - player.y;
            const projection = toZombieX * dirX + toZombieY * dirY;
            
            if (projection >= 0 && projection <= len) {
                const closestX = player.x + dirX * projection;
                const closestY = player.y + dirY * projection;
                const distToZombie = Math.hypot(closestX - zombie.x, closestY - zombie.y);
                
                if (distToZombie < zombie.size) {
                    // HIT!
                    let damage = bullet.damage;
                    let headshotBonus = 0;
                    
                    if (bullet.isHeadshot) {
                        damage *= 2;
                        headshotBonus = zombie.headshotBonus;
                        player.score += headshotBonus;
                        io.emit('chatMessage', { username: 'System', message: `🎯 HEADSHOT! +${headshotBonus} bonus!`, isSystem: true });
                    }
                    
                    zombie.health -= damage;
                    
                    // Knockback effect
                    const knockAngle = Math.atan2(zombie.y - player.y, zombie.x - player.x);
                    zombie.x += Math.cos(knockAngle) * 25;
                    zombie.y += Math.sin(knockAngle) * 25;
                    
                    io.emit('zombieDamaged', { id: zombieId, health: zombie.health, knockX: zombie.x, knockY: zombie.y });
                    
                    if (zombie.health <= 0) {
                        const pointsGained = zombie.points;
                        player.score += pointsGained;
                        player.kills++;
                        
                        io.emit('zombieKilled', zombieId);
                        io.emit('scoreUpdate', { id: socket.id, score: player.score, kills: player.kills });
                        io.emit('chatMessage', { username: 'System', message: `${player.username} killed a ${zombie.type} zombie! +${pointsGained} points`, isSystem: true });
                        
                        delete zombies[zombieId];
                        checkWaveComplete();
                    }
                    
                    hit = true;
                    break;
                }
            }
        }
        
        if (!hit) {
            // Missed - show impact effect at end point
            io.emit('bulletMiss', { x: endX, y: endY });
        }
    });
    
    socket.on('chatMessage', (data) => {
        const player = players[socket.id];
        if (!player) return;
        io.emit('chatMessage', { username: player.username, message: data.message });
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
    console.log(`✅ Zombie.io FIXED server running on port ${PORT}`);
    console.log(`🧟 Zombies now take multiple hits to kill!`);
    console.log(`🎯 Headshots deal double damage!`);
    console.log(`💥 Knockback effect added!`);
    console.log(`🌊 Wave 1 started!`);
});
