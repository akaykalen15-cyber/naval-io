const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(__dirname));

let players = {};
let zombies = {};
let wave = 1;
let zombieIdCounter = 0;
let allTimeTop10 = [];

// LARGER MAP - 5000x5000
const MAP_WIDTH = 5000;
const MAP_HEIGHT = 5000;

const LEADERBOARD_FILE = path.join(__dirname, 'zombie_leaderboard.json');

if (fs.existsSync(LEADERBOARD_FILE)) {
    try {
        allTimeTop10 = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    } catch(e) { allTimeTop10 = []; }
}

function saveLeaderboard() {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(allTimeTop10, null, 2));
}

function updateLeaderboard(username, score) {
    const existing = allTimeTop10.find(p => p.username === username);
    if (existing) {
        if (score > existing.score) existing.score = score;
    } else {
        allTimeTop10.push({ username: username, score: score });
    }
    allTimeTop10.sort((a, b) => b.score - a.score);
    allTimeTop10 = allTimeTop10.slice(0, 10);
    saveLeaderboard();
    io.emit('leaderboardUpdate', allTimeTop10);
}

const zombieTypes = {
    regular: { health: 1, speed: 1.5, points: 10, color: '#2d5a27', size: 20, headshotBonus: 5 },
    fast: { health: 1, speed: 3.0, points: 15, color: '#6b8c42', size: 18, headshotBonus: 8 },
    tank: { health: 5, speed: 0.8, points: 50, color: '#1a3a1a', size: 30, headshotBonus: 25 },
    boss: { health: 20, speed: 1.0, points: 500, color: '#8b0000', size: 50, headshotBonus: 250 }
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
    let zombieCount = Math.min(5 + Math.floor(wave * 1.5), 60);
    
    for (let i = 0; i < zombieCount; i++) {
        let type = 'regular';
        let roll = Math.random();
        
        if (wave >= 3 && roll < 0.2) type = 'fast';
        else if (wave >= 5 && roll < 0.1) type = 'tank';
        else if (wave >= 10 && roll < 0.05) type = 'boss';
        
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
        for (const id in players) {
            players[id].score += wave * 10;
            io.emit('scoreUpdate', { id: id, score: players[id].score });
        }
        io.emit('chatMessage', { username: 'System', message: `🎉 WAVE ${wave} COMPLETE! +${wave * 10} bonus points! 🎉`, isSystem: true });
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
                    player.streak = 0;
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
    socket.emit('leaderboardUpdate', allTimeTop10);

    socket.on('joinGame', (data) => {
        const username = data.username;
        const skin = data.skin || 'classic';
        
        players[socket.id] = {
            id: socket.id,
            username: username,
            x: MAP_WIDTH / 2,
            y: MAP_HEIGHT / 2,
            radius: 18,
            health: 100,
            maxHealth: 100,
            score: 0,
            coins: 0,
            damage: 1,
            fireRate: 300,
            speed: 3,
            streak: 0,
            lastShot: 0,
            skin: skin,
            kills: 0,
            headshots: 0,
            skins: ['classic']
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
        const isHeadshot = data.isHeadshot || false;
        
        const bullet = {
            id: Math.random().toString(36).substr(2, 8),
            x: player.x,
            y: player.y,
            angle: angle,
            ownerId: socket.id,
            damage: player.damage,
            isHeadshot: isHeadshot
        };
        
        io.emit('bulletShot', bullet);
        
        setTimeout(() => {
            for (const zombieId in zombies) {
                const zombie = zombies[zombieId];
                const dx = bullet.x - zombie.x;
                const dy = bullet.y - zombie.y;
                if (Math.hypot(dx, dy) < zombie.size) {
                    let damage = bullet.damage;
                    let headshotBonus = 0;
                    
                    if (bullet.isHeadshot) {
                        damage *= 2;
                        headshotBonus = zombie.headshotBonus;
                        player.headshots++;
                        io.emit('chatMessage', { username: 'System', message: `🎯 HEADSHOT! +${headshotBonus} bonus!`, isSystem: true });
                    }
                    
                    zombie.health -= damage;
                    if (zombie.health <= 0) {
                        const totalPoints = zombie.points + headshotBonus;
                        player.score += totalPoints;
                        player.coins += Math.floor(totalPoints / 10);
                        player.kills++;
                        player.streak++;
                        
                        if (player.streak === 5) {
                            player.coins += 50;
                            io.emit('chatMessage', { username: 'System', message: `🔥 ${player.username} is on a 5 KILL STREAK! +50 coins!`, isSystem: true });
                        } else if (player.streak === 10) {
                            player.coins += 100;
                            io.emit('chatMessage', { username: 'System', message: `⚡ ${player.username} is UNSTOPPABLE! +100 coins!`, isSystem: true });
                        } else if (player.streak === 20) {
                            player.coins += 500;
                            io.emit('chatMessage', { username: 'System', message: `👑 ${player.username} is GODLIKE! +500 coins!`, isSystem: true });
                        }
                        
                        delete zombies[zombieId];
                        io.emit('zombieKilled', zombieId);
                        io.emit('scoreUpdate', { id: socket.id, score: player.score, coins: player.coins, kills: player.kills, headshots: player.headshots, streak: player.streak });
                        io.emit('chatMessage', { username: 'System', message: `${player.username} killed a ${zombie.type} zombie! +${totalPoints} points`, isSystem: true });
                        updateLeaderboard(player.username, player.score);
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
        if (player.coins < cost) return;
        
        player.coins -= cost;
        
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
        
        io.emit('scoreUpdate', { id: socket.id, score: player.score, coins: player.coins });
        io.emit('playerUpdate', { id: socket.id, health: player.health, maxHealth: player.maxHealth, damage: player.damage, fireRate: player.fireRate, speed: player.speed });
        socket.emit('chatMessage', { username: 'System', message: `Upgraded ${type}!`, isSystem: true });
    });
    
    socket.on('buySkin', (skinId) => {
        const player = players[socket.id];
        if (!player) return;
        
        const skinPrices = {
            classic: 0, military: 500, ninja: 1000, zombie: 2000, angel: 5000, demon: 10000
        };
        
        const price = skinPrices[skinId];
        if (!price) return;
        if (player.coins < price) return;
        
        player.coins -= price;
        player.skin = skinId;
        if (!player.skins) player.skins = [];
        if (!player.skins.includes(skinId)) player.skins.push(skinId);
        io.emit('scoreUpdate', { id: socket.id, coins: player.coins });
        socket.emit('skinUnlocked', skinId);
        socket.emit('chatMessage', { username: 'System', message: `Purchased ${skinId} skin!`, isSystem: true });
    });
    
    socket.on('dailyReward', () => {
        const player = players[socket.id];
        if (!player) return;
        
        const today = new Date().toDateString();
        if (player.lastDaily === today) {
            socket.emit('chatMessage', { username: 'System', message: 'Already claimed today! Come back tomorrow.', isSystem: true });
            return;
        }
        
        player.lastDaily = today;
        player.coins += 500;
        io.emit('scoreUpdate', { id: socket.id, coins: player.coins });
        socket.emit('chatMessage', { username: 'System', message: '🎁 Daily reward: 500 coins!', isSystem: true });
    });
    
    socket.on('chatMessage', (data) => {
        const player = players[socket.id];
        if (!player) return;
        
        let message = data.message;
        message = message.replace(/:\)/g, '😊').replace(/:\(/g, '😢').replace(/:D/g, '😁').replace(/:P/g, '😛');
        message = message.replace(/zombie/gi, '🧟').replace(/gun/gi, '🔫').replace(/boss/gi, '👑');
        
        io.emit('chatMessage', { username: player.username, message: message, isAdmin: false });
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
    console.log(`✅ Zombie.io COMPLETE server running on port ${PORT}`);
    console.log(`🗺️ Map size: ${MAP_WIDTH}x${MAP_HEIGHT}`);
    console.log(`🧟 Wave 1 started!`);
    console.log(`🎯 Headshots enabled!`);
    console.log(`💰 Coin system active!`);
});
