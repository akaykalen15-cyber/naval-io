const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(__dirname));

// 👑 ADMIN USERNAME (YOU!)
const ADMIN_NAME = 'RYZZ';

let players = {};
let enemies = [];
let supplyCrates = [];
let enemyIdCounter = 0;
let crateIdCounter = 0;

const MAP_WIDTH = 6000;
const MAP_HEIGHT = 6000;

// 🚏 PETROL STATIONS
const petrolStations = [
    { id: 0, x: 1000, y: 1000, radius: 160, pointsPerSecond: 5 },
    { id: 1, x: 5000, y: 1000, radius: 160, pointsPerSecond: 5 },
    { id: 2, x: 3000, y: 3000, radius: 160, pointsPerSecond: 8 },
    { id: 3, x: 1000, y: 5000, radius: 160, pointsPerSecond: 5 },
    { id: 4, x: 5000, y: 5000, radius: 160, pointsPerSecond: 5 },
    { id: 5, x: 2000, y: 4000, radius: 160, pointsPerSecond: 6 },
    { id: 6, x: 4000, y: 2000, radius: 160, pointsPerSecond: 6 }
];

let playersInStation = {};

// 🚢 SHIP CLASSES (unlock by level)
const ships = {
    rowboat: { name: '🛶 Rowboat', damage: 8, fireRate: 700, speed: 5.0, health: 60, size: 14, color: '#8B6914', level: 0 },
    sloop: { name: '⛵ Sloop', damage: 12, fireRate: 650, speed: 4.5, health: 90, size: 16, color: '#CD853F', level: 1 },
    cutter: { name: '🚤 Cutter', damage: 16, fireRate: 600, speed: 4.2, health: 120, size: 18, color: '#DAA520', level: 2 },
    brig: { name: '⚓ Brig', damage: 22, fireRate: 550, speed: 3.8, health: 180, size: 20, color: '#A0522D', level: 3 },
    schooner: { name: '🏴‍☠️ Schooner', damage: 28, fireRate: 500, speed: 3.5, health: 230, size: 22, color: '#8B0000', level: 4 },
    corsair: { name: '💀 Corsair', damage: 35, fireRate: 480, speed: 3.2, health: 280, size: 24, color: '#6B0000', level: 5 },
    frigate: { name: '⚔️ Frigate', damage: 45, fireRate: 450, speed: 2.8, health: 380, size: 26, color: '#4a0000', level: 6 },
    galleon: { name: '🛡️ Galleon', damage: 55, fireRate: 420, speed: 2.5, health: 480, size: 28, color: '#3a0000', level: 7 },
    manowar: { name: '👑 Man O\' War', damage: 70, fireRate: 380, speed: 2.2, health: 600, size: 30, color: '#2a0000', level: 8 },
    ironclad: { name: '🚢 Ironclad', damage: 90, fireRate: 350, speed: 2.0, health: 800, size: 32, color: '#1a1a2e', level: 9 },
    dreadnought: { name: '🔥 Dreadnought', damage: 110, fireRate: 320, speed: 1.8, health: 1000, size: 34, color: '#ff4400', level: 10 },
    thunderer: { name: '⚡ Thunderer', damage: 140, fireRate: 280, speed: 1.6, health: 1300, size: 36, color: '#ff6600', level: 11 },
    scout: { name: '🛸 Scout Ship', damage: 120, fireRate: 250, speed: 3.5, health: 900, size: 32, color: '#00ccff', level: 12 },
    corvette: { name: '🚀 Corvette', damage: 160, fireRate: 220, speed: 3.2, health: 1200, size: 34, color: '#3399ff', level: 13 },
    star_destroyer: { name: '⭐ Star Destroyer', damage: 200, fireRate: 200, speed: 2.8, health: 1600, size: 38, color: '#3366ff', level: 14 },
    cruiser: { name: '🌟 Cruiser', damage: 260, fireRate: 180, speed: 2.5, health: 2200, size: 42, color: '#6600cc', level: 15 },
    battlecruiser: { name: '💫 Battlecruiser', damage: 340, fireRate: 160, speed: 2.2, health: 3000, size: 46, color: '#9900ff', level: 16 },
    star_battleship: { name: '🔥 Star Battleship', damage: 450, fireRate: 140, speed: 1.8, health: 4200, size: 50, color: '#ff00ff', level: 17 },
    star_dreadnought: { name: '👑 Star Dreadnought', damage: 600, fireRate: 120, speed: 1.5, health: 6000, size: 55, color: '#ff00cc', level: 18 },
    carrier: { name: '🌌 Carrier', damage: 800, fireRate: 100, speed: 1.3, health: 8500, size: 60, color: '#ff0088', level: 19 },
    annihilator: { name: '⚡ Annihilator', damage: 1000, fireRate: 80, speed: 1.2, health: 12000, size: 65, color: '#ff0044', level: 20 }
};

// AI Enemy ships
const enemyShips = [
    { name: '🛶 Pirate Boat', health: 50, damage: 6, speed: 2.0, points: 25, color: '#5a3a1a', size: 14 },
    { name: '⛵ Pirate Sloop', health: 100, damage: 10, speed: 1.8, points: 45, color: '#8B4513', size: 18 },
    { name: '🚤 Pirate Brig', health: 180, damage: 15, speed: 1.6, points: 70, color: '#A0522D', size: 22 },
    { name: '⚓ Pirate Frigate', health: 300, damage: 22, speed: 1.4, points: 110, color: '#8B0000', size: 26 },
    { name: '🏴‍☠️ Pirate Galleon', health: 500, damage: 30, speed: 1.2, points: 180, color: '#4a0000', size: 32 }
];

// Supply crates
const crateTypes = [
    { name: '📦 Supply Crate', points: 50, color: '#8B4513', icon: '📦', chance: 0.5 },
    { name: '⛽ Fuel Barrel', points: 100, color: '#ff4444', icon: '⛽', chance: 0.25 },
    { name: '💎 Ammo Crate', points: 150, color: '#44ff44', icon: '💎', chance: 0.15 },
    { name: '👑 Golden Crate', points: 300, color: '#ffd700', icon: '👑', chance: 0.07 },
    { name: '⭐ Legendary Crate', points: 600, color: '#ff00ff', icon: '⭐', chance: 0.03 }
];

function getRandomCrate() {
    const rand = Math.random();
    let accumulated = 0;
    for (const crate of crateTypes) {
        accumulated += crate.chance;
        if (rand <= accumulated) return { ...crate };
    }
    return { ...crateTypes[0] };
}

function spawnSupplyCrate() {
    const crate = getRandomCrate();
    supplyCrates.push({
        id: 'crate_' + crateIdCounter++,
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        radius: 16,
        ...crate
    });
    io.emit('cratesUpdate', supplyCrates);
}

function spawnEnemy() {
    const type = enemyShips[Math.floor(Math.random() * enemyShips.length)];
    const side = Math.floor(Math.random() * 4);
    let x, y;
    switch(side) {
        case 0: x = Math.random() * MAP_WIDTH; y = 0; break;
        case 1: x = MAP_WIDTH; y = Math.random() * MAP_HEIGHT; break;
        case 2: x = Math.random() * MAP_WIDTH; y = MAP_HEIGHT; break;
        default: x = 0; y = Math.random() * MAP_HEIGHT;
    }
    
    enemies.push({
        id: 'enemy_' + enemyIdCounter++,
        x: x, y: y,
        health: type.health,
        maxHealth: type.health,
        name: type.name,
        damage: type.damage,
        speed: type.speed,
        points: type.points,
        color: type.color,
        size: type.size
    });
}

function getLevel(score) {
    if (score < 100) return 0;
    if (score < 250) return 1;
    if (score < 450) return 2;
    if (score < 700) return 3;
    if (score < 1000) return 4;
    if (score < 1350) return 5;
    if (score < 1750) return 6;
    if (score < 2200) return 7;
    if (score < 2700) return 8;
    if (score < 3250) return 9;
    if (score < 3850) return 10;
    if (score < 4500) return 11;
    if (score < 5200) return 12;
    if (score < 6000) return 13;
    if (score < 6900) return 14;
    if (score < 7900) return 15;
    if (score < 9000) return 16;
    if (score < 10200) return 17;
    if (score < 11500) return 18;
    if (score < 13000) return 19;
    return 20;
}

function getAvailableShips(level) {
    const available = [];
    for (const [id, ship] of Object.entries(ships)) {
        if (ship.level <= level) {
            available.push({ id, ...ship });
        }
    }
    return available;
}

function getShipById(shipId) {
    return ships[shipId] || ships.rowboat;
}

// Keep enemies on map (5-8)
setInterval(() => {
    if (enemies.length < 5) {
        spawnEnemy();
    } else if (enemies.length < 8 && Math.random() < 0.3) {
        spawnEnemy();
    }
}, 8000);

// Spawn crates every 20 seconds
setInterval(() => {
    spawnSupplyCrate();
    console.log(`📦 Crate spawned! Total: ${supplyCrates.length}`);
}, 20000);

// Spawn initial enemies
for (let i = 0; i < 5; i++) {
    spawnEnemy();
}
for (let i = 0; i < 3; i++) {
    spawnSupplyCrate();
}

// Petrol station farming - check entries
setInterval(() => {
    for (const station of petrolStations) {
        for (const id in players) {
            const player = players[id];
            const dist = Math.hypot(station.x - player.x, station.y - player.y);
            const wasInStation = playersInStation[id] === station.id;
            const isInStation = dist < station.radius;
            
            if (isInStation && !wasInStation) {
                playersInStation[id] = station.id;
                io.emit('stationEnter', { playerId: id, stationId: station.id });
                io.emit('chatMessage', { username: 'System', message: `⛽ ${player.username} entered a petrol station! +${station.pointsPerSecond} pts/sec`, isSystem: true });
            } else if (!isInStation && wasInStation) {
                delete playersInStation[id];
                io.emit('stationLeave', { playerId: id, stationId: station.id });
            }
        }
    }
}, 500);

// Petrol station farming - give points
setInterval(() => {
    for (const id in playersInStation) {
        const player = players[id];
        if (!player) {
            delete playersInStation[id];
            continue;
        }
        const stationId = playersInStation[id];
        const station = petrolStations.find(s => s.id === stationId);
        if (station) {
            const dist = Math.hypot(station.x - player.x, station.y - player.y);
            if (dist < station.radius) {
                player.score += station.pointsPerSecond;
                
                const newLevel = getLevel(player.score);
                if (newLevel > player.level) {
                    player.level = newLevel;
                    io.emit('playerUpdate', { id: id, level: newLevel });
                    io.emit('chatMessage', { username: 'System', message: `🎉 ${player.username} reached Level ${newLevel}! New ships available! 🎉`, isSystem: true });
                }
                
                io.emit('scoreUpdate', { id: id, score: player.score, level: player.level });
            } else {
                delete playersInStation[id];
                io.emit('stationLeave', { playerId: id, stationId: station.id });
            }
        }
    }
}, 1000);

// Crate collection
setInterval(() => {
    for (let i = 0; i < supplyCrates.length; i++) {
        const crate = supplyCrates[i];
        for (const id in players) {
            const player = players[id];
            const dist = Math.hypot(crate.x - player.x, crate.y - player.y);
            if (dist < (player.size || 16) + crate.radius) {
                player.score += crate.points;
                
                const newLevel = getLevel(player.score);
                if (newLevel > player.level) {
                    player.level = newLevel;
                    io.emit('playerUpdate', { id: id, level: newLevel });
                    io.emit('chatMessage', { username: 'System', message: `🎉 ${player.username} reached Level ${newLevel}! New ships available! 🎉`, isSystem: true });
                }
                
                io.emit('scoreUpdate', { id: id, score: player.score, level: player.level });
                io.emit('crateCollected', crate.id);
                io.emit('chatMessage', { username: 'System', message: `📦 ${player.username} found ${crate.name}! +${crate.points} points!`, isSystem: true });
                supplyCrates.splice(i, 1);
                i--;
                break;
            }
        }
    }
}, 100);

// Enemy movement
setInterval(() => {
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        let nearestPlayer = null;
        let nearestDist = Infinity;
        for (const id in players) {
            const player = players[id];
            const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestPlayer = player;
            }
        }
        if (nearestPlayer) {
            const dx = nearestPlayer.x - enemy.x;
            const dy = nearestPlayer.y - enemy.y;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
                enemy.x += (dx / len) * enemy.speed;
                enemy.y += (dy / len) * enemy.speed;
            }
        }
        enemy.x = Math.min(Math.max(enemy.x, 10), MAP_WIDTH - 10);
        enemy.y = Math.min(Math.max(enemy.y, 10), MAP_HEIGHT - 10);
    }
    io.emit('enemiesUpdate', enemies);
    io.emit('stationsUpdate', petrolStations);
}, 50);

// Enemy vs Player collisions
setInterval(() => {
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        for (const id in players) {
            const player = players[id];
            const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
            if (dist < enemy.size + (player.size || 16)) {
                player.health = Math.max(0, player.health - enemy.damage);
                io.emit('playerUpdate', { id: id, health: player.health });
                if (player.health <= 0) {
                    player.score = Math.max(0, player.score - Math.floor(player.score * 0.1));
                    player.health = player.maxHealth || 100;
                    player.x = MAP_WIDTH / 2;
                    player.y = MAP_HEIGHT / 2;
                    io.emit('scoreUpdate', { id: id, score: player.score });
                    io.emit('playerMoved', { id: id, x: player.x, y: player.y });
                    io.emit('chatMessage', { username: 'System', message: `💀 ${player.username} was sunk!`, isSystem: true });
                }
                break;
            }
        }
    }
}, 100);

// Player vs Player collisions
setInterval(() => {
    const playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
            const p1 = players[playerIds[i]];
            const p2 = players[playerIds[j]];
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            if (dist < (p1.size || 16) + (p2.size || 16)) {
                p1.health = Math.max(0, p1.health - 5);
                p2.health = Math.max(0, p2.health - 5);
                io.emit('playerUpdate', { id: playerIds[i], health: p1.health });
                io.emit('playerUpdate', { id: playerIds[j], health: p2.health });
                
                const angle = Math.atan2(p1.y - p2.y, p1.x - p2.x);
                p1.x += Math.cos(angle) * 15;
                p1.y += Math.sin(angle) * 15;
                p2.x -= Math.cos(angle) * 15;
                p2.y -= Math.sin(angle) * 15;
                io.emit('playerMoved', { id: playerIds[i], x: p1.x, y: p1.y });
                io.emit('playerMoved', { id: playerIds[j], x: p2.x, y: p2.y });
            }
        }
    }
}, 100);

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('joinGame', (data) => {
        const username = data.username;
        const shipId = data.shipId || 'rowboat';
        const ship = getShipById(shipId);
        const level = 0;
        
        players[socket.id] = {
            id: socket.id,
            username: username,
            x: MAP_WIDTH / 2 + (Math.random() - 0.5) * 300,
            y: MAP_HEIGHT / 2 + (Math.random() - 0.5) * 300,
            size: ship.size,
            health: ship.health,
            maxHealth: ship.health,
            score: 0,
            level: level,
            damage: ship.damage,
            fireRate: ship.fireRate,
            speed: ship.speed,
            lastShot: 0,
            shipId: shipId,
            shipName: ship.name,
            shipColor: ship.color,
            kills: 0,
            isAdmin: username === ADMIN_NAME
        };
        
        socket.emit('currentPlayers', players);
        socket.emit('currentEnemies', enemies);
        socket.emit('currentCrates', supplyCrates);
        socket.emit('stationsUpdate', petrolStations);
        socket.emit('availableShips', getAvailableShips(0));
        socket.broadcast.emit('newPlayer', players[socket.id]);
        
        console.log(`${username} joined with ${ship.name}`);
    });
    
    socket.on('changeShip', (data) => {
        const player = players[socket.id];
        if (!player) return;
        
        const ship = getShipById(data.shipId);
        if (ship.level > player.level) return;
        
        player.shipId = data.shipId;
        player.damage = ship.damage;
        player.fireRate = ship.fireRate;
        player.speed = ship.speed;
        player.maxHealth = ship.health;
        player.health = ship.health;
        player.size = ship.size;
        player.shipName = ship.name;
        player.shipColor = ship.color;
        
        io.emit('playerUpdate', {
            id: socket.id,
            damage: player.damage,
            fireRate: player.fireRate,
            speed: player.speed,
            maxHealth: player.maxHealth,
            health: player.health,
            size: player.size,
            color: player.shipColor
        });
        socket.emit('chatMessage', { username: 'System', message: `Changed to ${ship.name}!`, isSystem: true });
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
        const range = 800;
        const endX = player.x + Math.cos(angle) * range;
        const endY = player.y + Math.sin(angle) * range;
        
        const projectile = {
            id: Math.random().toString(36).substr(2, 8),
            startX: player.x,
            startY: player.y,
            endX: endX,
            endY: endY,
            ownerId: socket.id,
            damage: player.damage
        };
        
        io.emit('projectileShot', projectile);
        
        setTimeout(() => {
            // Hit enemies
            for (let i = 0; i < enemies.length; i++) {
                const enemy = enemies[i];
                const dx = projectile.endX - enemy.x;
                const dy = projectile.endY - enemy.y;
                if (Math.hypot(dx, dy) < enemy.size) {
                    enemy.health -= projectile.damage;
                    if (enemy.health <= 0) {
                        player.score += enemy.points;
                        player.kills++;
                        
                        const newLevel = getLevel(player.score);
                        if (newLevel > player.level) {
                            player.level = newLevel;
                            io.emit('playerUpdate', { id: socket.id, level: newLevel });
                            io.emit('chatMessage', { username: 'System', message: `🎉 ${player.username} reached Level ${newLevel}! New ships available! 🎉`, isSystem: true });
                            socket.emit('availableShips', getAvailableShips(newLevel));
                        }
                        
                        io.emit('scoreUpdate', { id: socket.id, score: player.score, kills: player.kills, level: player.level });
                        io.emit('enemyDestroyed', enemy.id);
                        enemies.splice(i, 1);
                        i--;
                        io.emit('chatMessage', { username: 'System', message: `💥 ${player.username} sank a ${enemy.name}! +${enemy.points} points!`, isSystem: true });
                    } else {
                        io.emit('enemyDamaged', { id: enemy.id, health: enemy.health });
                    }
                    break;
                }
            }
            
            // Hit other players (PvP)
            for (const id in players) {
                if (id === socket.id) continue;
                const target = players[id];
                const dx = projectile.endX - target.x;
                const dy = projectile.endY - target.y;
                if (Math.hypot(dx, dy) < (target.size || 16)) {
                    target.health = Math.max(0, target.health - projectile.damage);
                    io.emit('playerUpdate', { id: id, health: target.health });
                    if (target.health <= 0) {
                        const gain = Math.floor(target.score * 0.1) + 50;
                        player.score += gain;
                        player.kills++;
                        target.score = Math.max(0, target.score - Math.floor(target.score * 0.1));
                        target.health = target.maxHealth;
                        target.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 300;
                        target.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 300;
                        
                        const newLevel = getLevel(player.score);
                        if (newLevel > player.level) {
                            player.level = newLevel;
                            io.emit('playerUpdate', { id: socket.id, level: newLevel });
                            socket.emit('availableShips', getAvailableShips(newLevel));
                        }
                        
                        io.emit('scoreUpdate', { id: socket.id, score: player.score, kills: player.kills, level: player.level });
                        io.emit('scoreUpdate', { id: id, score: target.score });
                        io.emit('playerMoved', { id: id, x: target.x, y: target.y });
                        io.emit('chatMessage', { username: 'System', message: `💀 ${player.username} sank ${target.username}! +${gain} points!`, isSystem: true });
                    }
                    break;
                }
            }
        }, 50);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n⚓ NAVAL.IO SERVER RUNNING!`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🗺️ Map: ${MAP_WIDTH}x${MAP_HEIGHT}`);
    console.log(`🚢 Ships: 21 classes (Level 0-20)`);
    console.log(`⛽ Petrol stations: 7 locations`);
    console.log(`📦 Supply crates: Spawn every 20 seconds`);
    console.log(`👑 Admin: ${ADMIN_NAME}\n`);
});
