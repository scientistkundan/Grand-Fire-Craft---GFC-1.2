const STORAGE_KEY_PROFILE = "GFC_PLAYER_PROFILE_V1";
const ONLINE_DB_URL = "https://grand-fire-craft---gfc-default-rtdb.firebaseio.com";

let playerProfile = {
    uid: "0000000001",
    name: "GOJO SATORU",
    level: 0,
    totalKills: 0,
    nextStep: 5,
    nextTarget: 5,
    friends: []
};

let onlineRoomId = "global_squad_1";
let lastOnlineSyncTime = 0;
let micStream = null;
let isMicOn = false;

function format10DigitUid(num) {
    let safeNum = Math.max(1, parseInt(num, 10) || 1);
    return String(safeNum).padStart(10, '0');
}

function saveProfileToBrowser() {
    try {
        localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(playerProfile));
    } catch (e) {}
    syncPlayerToCloud();
}

async function dbGet(path) {
    if (!ONLINE_DB_URL) return null;
    try {
        let res = await fetch(`${ONLINE_DB_URL}${path}.json`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

async function dbPut(path, data) {
    if (!ONLINE_DB_URL) return false;
    try {
        let res = await fetch(`${ONLINE_DB_URL}${path}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function dbPatch(path, data) {
    if (!ONLINE_DB_URL) return false;
    try {
        let res = await fetch(`${ONLINE_DB_URL}${path}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

async function syncPlayerToCloud() {
    if (!ONLINE_DB_URL || !playerProfile.uid) return;
    await dbPatch(`/players/${playerProfile.uid}`, {
        uid: playerProfile.uid,
        name: playerProfile.name,
        level: playerProfile.level,
        totalKills: playerProfile.totalKills,
        online: true,
        roomId: onlineRoomId,
        lastSeen: Date.now()
    });
}

async function pollIncomingFriendRequests() {
    if (!ONLINE_DB_URL || !playerProfile.uid) return;
    let reqs = await dbGet(`/friendRequests/${playerProfile.uid}`);
    if (!reqs || typeof reqs !== "object") return;

    let changed = false;
    for (let fromUid of Object.keys(reqs)) {
        let info = reqs[fromUid];
        if (!info) continue;
        let exists = playerProfile.friends.some(f => f.uid === fromUid);
        if (!exists) {
            playerProfile.friends.push({
                uid: fromUid,
                name: info.fromName || ("PLAYER_" + fromUid.slice(-3)),
                status: "request",
                inSquad: false
            });
            changed = true;
        }
    }
    if (changed) {
        try {
            localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(playerProfile));
        } catch (e) {}
        renderFriendsList();
    }
}

function initPermanentProfile() {
    let saved = null;
    try {
        saved = localStorage.getItem(STORAGE_KEY_PROFILE);
    } catch (e) {}

    if (saved) {
        try {
            playerProfile = JSON.parse(saved);
            if (!Array.isArray(playerProfile.friends)) playerProfile.friends = [];
            document.getElementById('heroNameInput').value = playerProfile.name;
            document.getElementById('displayUidText').innerText = playerProfile.uid;
            document.getElementById('hudUid').innerText = playerProfile.uid;
            renderFriendsList();
            syncPlayerToCloud();
            pollIncomingFriendRequests();
            setInterval(pollIncomingFriendRequests, 4000);
            return;
        } catch (e) {}
    }

    document.getElementById('first-time-modal').style.display = 'flex';
}

window.createPermanentProfile = async function() {
    let rawName = document.getElementById('firstNameInput').value.trim();
    if (!rawName) rawName = "Gojo Satoru";

    let cloudCounter = await dbGet("/meta/nextUid");
    let nextNum = parseInt(cloudCounter || "1", 10);
    if (isNaN(nextNum) || nextNum < 1) {
        nextNum = 1;
    }

    let assignedUid = format10DigitUid(nextNum);
    await dbPut("/meta/nextUid", nextNum + 1);

    playerProfile.uid = assignedUid;
    playerProfile.name = rawName.toUpperCase();
    playerProfile.level = 0;
    playerProfile.totalKills = 0;
    playerProfile.nextStep = 5;
    playerProfile.nextTarget = 5;
    playerProfile.friends = [];

    saveProfileToBrowser();
    pollIncomingFriendRequests();
    setInterval(pollIncomingFriendRequests, 4000);

    document.getElementById('heroNameInput').value = playerProfile.name;
    document.getElementById('displayUidText').innerText = playerProfile.uid;
    document.getElementById('hudUid').innerText = playerProfile.uid;
    document.getElementById('first-time-modal').style.display = 'none';
    renderFriendsList();
};

window.updateSavedName = function(newName) {
    let clean = newName.trim().toUpperCase();
    if (clean) {
        playerProfile.name = clean;
        saveProfileToBrowser();
    }
};

window.copyMyUid = function() {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(playerProfile.uid).catch(() => {});
    }
    alert("Your 10-Digit UID Copied: " + playerProfile.uid);
};

window.sendFriendRequest = async function() {
    let inputEl = document.getElementById('friendUidInput');
    let targetUid = inputEl.value.trim();
    if (!/^\d{10}$/.test(targetUid)) {
        alert("Please enter a valid 10-digit UID (e.g., 0000000002)");
        return;
    }
    if (targetUid === playerProfile.uid) {
        alert("You cannot add your own UID!");
        return;
    }

    let targetPlayer = await dbGet(`/players/${targetUid}`);
    let targetName = (targetPlayer && targetPlayer.name) ? targetPlayer.name : ("PLAYER_" + targetUid.slice(-3));

    await dbPut(`/friendRequests/${targetUid}/${playerProfile.uid}`, {
        fromUid: playerProfile.uid,
        fromName: playerProfile.name,
        sentAt: Date.now()
    });

    let existing = playerProfile.friends.find(f => f.uid === targetUid);
    if (!existing) {
        playerProfile.friends.push({
            uid: targetUid,
            name: targetName,
            status: "friend",
            inSquad: false
        });
    } else {
        existing.status = "friend";
    }

    saveProfileToBrowser();
    inputEl.value = "";
    renderFriendsList();
    alert("Friend request sent to UID: " + targetUid);
};

window.acceptFriend = function(uid) {
    let f = playerProfile.friends.find(x => x.uid === uid);
    if (f) {
        f.status = "friend";
        saveProfileToBrowser();
        renderFriendsList();
    }
};

window.toggleSquadInvite = function(uid) {
    let f = playerProfile.friends.find(x => x.uid === uid);
    if (f) {
        f.inSquad = !f.inSquad;
        let invited = playerProfile.friends.filter(x => x.status === "friend" && x.inSquad);
        if (invited.length > 0) {
            onlineRoomId = "squad_" + [playerProfile.uid, ...invited.map(x => x.uid)].sort().join("_");
        } else {
            onlineRoomId = "global_squad_1";
        }
        saveProfileToBrowser();
        renderFriendsList();
    }
};

function renderFriendsList() {
    let box = document.getElementById('friendsListContainer');
    if (!box) return;
    if (!playerProfile.friends || playerProfile.friends.length === 0) {
        box.innerHTML = `<div style="color:#888; text-align:center; padding:8px;">No friends yet. Add UID!</div>`;
        return;
    }

    box.innerHTML = playerProfile.friends.map(f => {
        if (f.status === "request") {
            return `<div class="friend-row">
                <span><b>${f.name}</b> (${f.uid})</span>
                <button class="mini-btn" onclick="acceptFriend('${f.uid}')">ACCEPT</button>
            </div>`;
        }
        let squadLabel = f.inSquad ? "IN TEAM" : "INVITE";
        return `<div class="friend-row">
            <span><b>${f.name}</b> (${f.uid})</span>
            <button class="mini-btn invite" onclick="toggleSquadInvite('${f.uid}')">${squadLabel}</button>
        </div>`;
    }).join('');
}

window.addEventListener('DOMContentLoaded', initPermanentProfile);

function showMicBanner(text) {
    let el = document.getElementById('mic-status-msg');
    if (!el) return;
    el.innerText = text;
    el.style.display = 'block';
    clearTimeout(window.__micBannerTimer);
    window.__micBannerTimer = setTimeout(() => {
        el.style.display = 'none';
    }, 1800);
}

async function toggleMicChat() {
    let micBtn = document.getElementById('micBtn');
    let micLabel = document.getElementById('micStateLabel');
    if (!micBtn || !micLabel) return;

    if (!isMicOn) {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert("Mic not supported on this browser.");
                return;
            }
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            isMicOn = true;
            micBtn.classList.add('mic-active');
            micLabel.innerText = "ON";
            showMicBanner("MIC ON: Talking with Squad");
            if (ONLINE_DB_URL && playerProfile.uid) {
                dbPatch(`/matches/${onlineRoomId}/players/${playerProfile.uid}`, { micOn: true });
            }
        } catch (err) {
            alert("Microphone permission denied or HTTPS link required.");
        }
    } else {
        if (micStream) {
            micStream.getTracks().forEach(track => track.stop());
            micStream = null;
        }
        isMicOn = false;
        micBtn.classList.remove('mic-active');
        micLabel.innerText = "OFF";
        showMicBanner("MIC OFF");
        if (ONLINE_DB_URL && playerProfile.uid) {
            dbPatch(`/matches/${onlineRoomId}/players/${playerProfile.uid}`, { micOn: false });
        }
    }
}

const weaponsDatabase = {
    "Master Hunter":   { type: "Sniper", damage: 150, fireRate: 35,  scope: "Auto 8X", fov: 22 },
    "Armor Destroyer": { type: "Sniper", damage: 135, fireRate: 30,  scope: "Auto 8X", fov: 22 },
    "Quick Execution": { type: "Sniper", damage: 120, fireRate: 40,  scope: "Auto 6X", fov: 28 },
    "Silent Precision": { type: "Sniper", damage: 115, fireRate: 45,  scope: "Auto 6X", fov: 28 },
    "Life & Death":    { type: "Sniper", damage: 90,  fireRate: 55,  scope: "Auto 4X", fov: 36 },
    "Rapid Marksman":  { type: "Sniper", damage: 85,  fireRate: 80,  scope: "Auto 4X", fov: 36 },

    "Iron Rain":       { type: "MG",      damage: 32,  fireRate: 800, scope: null,      fov: 62 },
    "Heavy Titan":     { type: "MG",      damage: 38,  fireRate: 600, scope: null,      fov: 62 },
    "Armor Crusher":   { type: "MG",      damage: 42,  fireRate: 500, scope: null,      fov: 62 },
    "Bomb Blaster":    { type: "Shotgun", damage: 68,  fireRate: 180, scope: null,      fov: 62 },
    "Katta King":      { type: "Shotgun", damage: 95,  fireRate: 70,  scope: null,      fov: 62 },
    "Power Charge":    { type: "Shotgun", damage: 80,  fireRate: 90,  scope: null,      fov: 62 },
    "Iron Fury":       { type: "Rifle",   damage: 35,  fireRate: 600, scope: null,      fov: 62 },
    "Plasma Nova":     { type: "Rifle",   damage: 38,  fireRate: 500, scope: null,      fov: 62 },
    "Desert Titan":    { type: "Pistol",  damage: 58,  fireRate: 240, scope: null,      fov: 62 },
    "Headshot Demon":  { type: "Pistol",  damage: 125, fireRate: 1000,scope: null,      fov: 62 }
};

let selectedWeaponName = "Master Hunter";
let currentWeaponStats = weaponsDatabase[selectedWeaponName];

window.selectLobbyWeapon = function(name) {
    if (weaponsDatabase[name]) {
        selectedWeaponName = name;
        currentWeaponStats = weaponsDatabase[name];
    }
};

let scene, camera, renderer, player, dirLight;
let active = false, score = 0, hp = 100, medkits = 2;

let playerLevel = 0;
let highestLevelReached = 0;
let totalKills = 0;
let nextLevelStepKills = 5;
let nextLevelTargetKills = 5;

let mx = 0, mz = 0;
let bullets = [], enemyBullets = [], enemies = [], enemyCars = [], squadTeammates = [], remotePlayers = {}, obstacles = [], walkables = [], vehicles = [], medkitDrops = [], airdrops = [], sparks = [];
let drivingVehicle = null;
let vehicleSpeed = 0;

let safeZoneRing = null;
let zoneRadius = 240;
const MIN_ZONE_RADIUS = 45;
let zoneDamageTick = 0;

let selectedOutfit = 0x111111;
let selectedGunGlow = 0x00ffff;
let selectedMapColor = 0x3a6b35;
let finalPlayerName = "Gojo Satoru";

let joystickTouchId = null, cameraTouchId = null;
let lastTouchX = 0, lastTouchY = 0;
let cameraYaw = 0;
let cameraPitch = 0.35;

let isFiring = false, isJumping = false, jumpVelocity = 0, gravity = 0.015;
let audioCtx = null;
const WORLD_LIMIT = 450;

window.setOutfit = function(color, btn) {
    selectedOutfit = color;
    for (let b of btn.parentElement.children) b.classList.remove('active');
    btn.classList.add('active');
};

window.setMap = function(color, btn) {
    selectedMapColor = color;
    for (let b of btn.parentElement.children) b.classList.remove('active');
    btn.classList.add('active');
};

function updateHealthUI() {
    let bar = document.getElementById('health-bar');
    bar.style.width = Math.max(0, hp) + '%';
    bar.style.background = hp > 45 ? '#00ff88' : '#ff0055';
    document.getElementById('medkitCount').innerText = medkits;
    document.getElementById('healBadge').innerText = `(${medkits})`;
}

function lockMonotonicLevel() {
    if (playerLevel > highestLevelReached) {
        highestLevelReached = playerLevel;
    }
    if (highestLevelReached >= 1) {
        playerLevel = Math.max(1, highestLevelReached, playerLevel);
    } else {
        playerLevel = Math.max(0, highestLevelReached, playerLevel);
    }
    playerProfile.level = playerLevel;
    playerProfile.totalKills = totalKills;
    playerProfile.nextStep = nextLevelStepKills;
    playerProfile.nextTarget = nextLevelTargetKills;
    try {
        localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(playerProfile));
    } catch (e) {}
}

function updateLevelUI() {
    lockMonotonicLevel();
    document.getElementById('levelVal').innerText = playerLevel;
    document.getElementById('killsVal').innerText = `${totalKills}/${nextLevelTargetKills}`;
}

function showLevelUpBanner() {
    let banner = document.getElementById('levelup-banner');
    banner.innerText = `LEVEL ${playerLevel} UNLOCKED! +1 MEDKIT & FULL HP`;
    banner.style.display = 'block';
    setTimeout(() => {
        banner.style.display = 'none';
    }, 2200);
}

function registerKill(points = 20) {
    totalKills++;
    score += points;
    document.getElementById('s').innerText = score;

    let leveledUp = false;
    while (totalKills >= nextLevelTargetKills) {
        playerLevel++;
        lockMonotonicLevel();
        medkits++;
        hp = 100;
        nextLevelStepKills *= 2;
        nextLevelTargetKills += nextLevelStepKills;
        leveledUp = true;
    }

    lockMonotonicLevel();
    syncPlayerToCloud();
    if (leveledUp) {
        updateHealthUI();
        showLevelUpBanner();
    }

    updateLevelUI();
    updateAliveUI();
}

function updateAliveUI() {
    let remoteCount = Object.keys(remotePlayers).length;
    let alive = 1 + remoteCount + squadTeammates.length + enemies.length + enemyCars.length;
    document.getElementById('aliveCount').innerText = alive;
}

async function syncMatchState(pos) {
    if (!ONLINE_DB_URL || !active || !playerProfile.uid) return;
    let now = Date.now();
    if (now - lastOnlineSyncTime < 150) return;
    lastOnlineSyncTime = now;

    await dbPut(`/matches/${onlineRoomId}/players/${playerProfile.uid}`, {
        uid: playerProfile.uid,
        name: playerProfile.name,
        x: Number(pos.x.toFixed(2)),
        y: Number(pos.y.toFixed(2)),
        z: Number(pos.z.toFixed(2)),
        yaw: Number(cameraYaw.toFixed(2)),
        hp: hp,
        isFiring: isFiring,
        micOn: isMicOn,
        updatedAt: now
    });

    let matchPlayers = await dbGet(`/matches/${onlineRoomId}/players`);
    if (!matchPlayers || typeof matchPlayers !== "object") return;

    let activeIds = new Set();
    for (let uid of Object.keys(matchPlayers)) {
        if (uid === playerProfile.uid) continue;
        let pData = matchPlayers[uid];
        if (!pData || (now - (pData.updatedAt || 0) > 8000)) continue;
        activeIds.add(uid);

        if (!remotePlayers[uid]) {
            let mesh = createFighter(0x00a8ff, 0x00ffff, 0x111111, 0x00ffff);
            scene.add(mesh);
            remotePlayers[uid] = mesh;
        }
        remotePlayers[uid].position.set(pData.x || 0, pData.y || 0.7, pData.z || 0);
        remotePlayers[uid].rotation.y = pData.yaw || 0;
    }

    for (let uid of Object.keys(remotePlayers)) {
        if (!activeIds.has(uid)) {
            scene.remove(remotePlayers[uid]);
            delete remotePlayers[uid];
        }
    }
    updateAliveUI();
}

function drawMinimap(centerPos) {
    let canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;
    let ctx = canvas.getContext('2d');
    let w = canvas.width;
    let h = canvas.height;
    let cx = w / 2;
    let cy = h / 2;
    let radarRange = 85;
    let scale = (w / 2 - 6) / radarRange;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(0, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, (w / 2 - 6) * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    let zoneMapX = cx + (0 - centerPos.x) * scale;
    let zoneMapY = cy + (0 - centerPos.z) * scale;
    let zoneMapR = zoneRadius * scale;
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(zoneMapX, zoneMapY, zoneMapR, 0, Math.PI * 2);
    ctx.stroke();

    for (let uid of Object.keys(remotePlayers)) {
        let rp = remotePlayers[uid];
        let rx = cx + (rp.position.x - centerPos.x) * scale;
        let ry = cy + (rp.position.z - centerPos.z) * scale;
        if (Math.hypot(rx - cx, ry - cy) <= w / 2 - 5) {
            ctx.fillStyle = '#00a8ff';
            ctx.beginPath();
            ctx.arc(rx, ry, 3.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let mate of squadTeammates) {
        let fx = cx + (mate.position.x - centerPos.x) * scale;
        let fy = cy + (mate.position.z - centerPos.z) * scale;
        if (Math.hypot(fx - cx, fy - cy) <= w / 2 - 5) {
            ctx.fillStyle = '#00ff88';
            ctx.beginPath();
            ctx.arc(fx, fy, 3.6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let drop of airdrops) {
        let dx = cx + (drop.position.x - centerPos.x) * scale;
        let dy = cy + (drop.position.z - centerPos.z) * scale;
        if (Math.hypot(dx - cx, dy - cy) <= w / 2 - 4) {
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath();
            ctx.arc(dx, dy, 3.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    for (let eCar of enemyCars) {
        let ex = cx + (eCar.position.x - centerPos.x) * scale;
        let ey = cy + (eCar.position.z - centerPos.z) * scale;
        let distMap = Math.hypot(ex - cx, ey - cy);
        if (distMap > w / 2 - 6) {
            let ang = Math.atan2(ey - cy, ex - cx);
            ex = cx + Math.cos(ang) * (w / 2 - 6);
            ey = cy + Math.sin(ang) * (w / 2 - 6);
        }
        ctx.fillStyle = '#ff6600';
        ctx.fillRect(ex - 3.5, ey - 3.5, 7, 7);
    }

    for (let en of enemies) {
        let ex = cx + (en.position.x - centerPos.x) * scale;
        let ey = cy + (en.position.z - centerPos.z) * scale;
        let distMap = Math.hypot(ex - cx, ey - cy);
        if (distMap > w / 2 - 6) {
            let ang = Math.atan2(ey - cy, ex - cx);
            ex = cx + Math.cos(ang) * (w / 2 - 6);
            ey = cy + Math.sin(ang) * (w / 2 - 6);
        }
        ctx.fillStyle = '#ff0033';
        ctx.beginPath();
        ctx.arc(ex, ey, 3.6, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-cameraYaw);
    ctx.fillStyle = 'rgba(0, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 18, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function updateAutoScopeVisual() {
    let scopeOverlay = document.getElementById('scope-overlay');
    let scopeBadge = document.getElementById('scope-badge');
    let canUseScope = isFiring && currentWeaponStats.scope && (!drivingVehicle || drivingVehicle.userData.canShoot);

    if (canUseScope) {
        scopeOverlay.style.display = 'block';
        scopeBadge.innerText = currentWeaponStats.scope.toUpperCase();
        if (camera) {
            camera.fov = currentWeaponStats.fov;
            camera.updateProjectionMatrix();
        }
    } else {
        scopeOverlay.style.display = 'none';
        if (camera && camera.fov !== 62) {
            camera.fov = 62;
            camera.updateProjectionMatrix();
        }
    }
}

function playGunSound() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.type = currentWeaponStats.type === "Sniper" ? 'triangle' : 'sawtooth';
        osc.frequency.setValueAtTime(currentWeaponStats.type === "Sniper" ? 820 : 550, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(45, audioCtx.currentTime + 0.14);
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.14);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.14);
    } catch (e) {}
}

function spawnSparks(pos, colorHex, count = 7) {
    for (let i = 0; i < count; i++) {
        let p = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.14, 0.14),
            new THREE.MeshBasicMaterial({ color: colorHex })
        );
        p.position.copy(pos);
        p.userData = {
            vel: new THREE.Vector3(
                (Math.random() - 0.5) * 0.45,
                Math.random() * 0.35 + 0.05,
                (Math.random() - 0.5) * 0.45
            ),
            life: 16
        };
        scene.add(p);
        sparks.push(p);
    }
}

function createGroundTexture(baseColorHex) {
    let canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    let ctx = canvas.getContext('2d');
    let c = new THREE.Color(baseColorHex);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 1800; i++) {
        let x = Math.random() * 256;
        let y = Math.random() * 256;
        let shade = (Math.random() - 0.5) * 35;
        let r = Math.min(255, Math.max(0, Math.floor(c.r * 255 + shade)));
        let g = Math.min(255, Math.max(0, Math.floor(c.g * 255 + shade)));
        let b = Math.min(255, Math.max(0, Math.floor(c.b * 255 + shade)));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 2, 2);
    }

    let tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(80, 80);
    return tex;
}

function createSafeZoneRing() {
    let ringGeo = new THREE.RingGeometry(zoneRadius - 1.5, zoneRadius + 1.5, 64);
    ringGeo.rotateX(-Math.PI / 2);
    let ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
    safeZoneRing = new THREE.Mesh(ringGeo, ringMat);
    safeZoneRing.position.set(0, 0.08, 0);
    scene.add(safeZoneRing);
}

function updateSafeZoneVisual() {
    if (!safeZoneRing) return;
    let scale = zoneRadius / 240;
    safeZoneRing.scale.set(scale, 1, scale);
}

function spawnAirdrop() {
    if (!active || airdrops.length >= 2) return;
    let angle = Math.random() * Math.PI * 2;
    let r = Math.random() * Math.max(20, zoneRadius * 0.65);
    let ax = Math.cos(angle) * r;
    let az = Math.sin(angle) * r;

    let crate = new THREE.Group();
    let box = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 1.4, 1.8),
        new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff5500, emissiveIntensity: 0.7, roughness: 0.3 })
    );
    box.position.y = 0.7;
    box.castShadow = true;
    crate.add(box);

    let beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 22, 8),
        new THREE.MeshBasicMaterial({ color: 0xff0055, transparent: true, opacity: 0.45 })
    );
    beacon.position.y = 11;
    crate.add(beacon);

    crate.position.set(ax, 0, az);
    scene.add(crate);
    airdrops.push(crate);
}

function addStreetLamp(x, z, rotY = 0) {
    let lamp = new THREE.Group();
    let pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, 6.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a202c, metalness: 0.7, roughness: 0.3 })
    );
    pole.position.y = 3.1;
    pole.castShadow = true;
    lamp.add(pole);

    let arm = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.14, 0.14),
        new THREE.MeshStandardMaterial({ color: 0x1a202c, metalness: 0.7 })
    );
    arm.position.set(0.6, 6.1, 0);
    lamp.add(arm);

    let isNight = selectedMapColor === 0x12121c;
    let bulb = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.12, 0.28),
        new THREE.MeshStandardMaterial({
            color: 0xfff5cc,
            emissive: isNight ? 0xffdd77 : 0x443300,
            emissiveIntensity: isNight ? 1.8 : 0.3
        })
    );
    bulb.position.set(1.1, 6.0, 0);
    lamp.add(bulb);

    lamp.position.set(x, 0, z);
    lamp.rotation.y = rotY;
    scene.add(lamp);
}

function buildMegaOpenWorld() {
    let groundTex = createGroundTexture(selectedMapColor);
    let ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1000, 1000),
        new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.88 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    let roadMat = new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.72, metalness: 0.15 });
    let curbMat = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.8 });
    let lineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });

    let highwayPositionsX = [0, -140, 140];
    highwayPositionsX.forEach(hx => {
        let road = new THREE.Mesh(new THREE.PlaneGeometry(18, 920), roadMat);
        road.rotation.x = -Math.PI / 2;
        road.position.set(hx, 0.02, 0);
        road.receiveShadow = true;
        scene.add(road);

        let leftCurb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 920), curbMat);
        leftCurb.position.set(hx - 9.2, 0.07, 0);
        scene.add(leftCurb);

        let rightCurb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 920), curbMat);
        rightCurb.position.set(hx + 9.2, 0.07, 0);
        scene.add(rightCurb);

        for (let z = -440; z <= 440; z += 18) {
            let dash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 7), lineMat);
            dash.rotation.x = -Math.PI / 2;
            dash.position.set(hx, 0.03, z);
            scene.add(dash);
        }

        for (let z = -360; z <= 360; z += 65) {
            addStreetLamp(hx - 10.2, z, 0);
            addStreetLamp(hx + 10.2, z, Math.PI);
        }
    });

    let crossPositionsZ = [-35, -180, 120];
    crossPositionsZ.forEach(cz => {
        let road = new THREE.Mesh(new THREE.PlaneGeometry(920, 16), roadMat);
        road.rotation.x = -Math.PI / 2;
        road.position.set(0, 0.025, cz);
        road.receiveShadow = true;
        scene.add(road);
    });

    for (let z = -400; z <= 400; z += 28) {
        if (crossPositionsZ.some(cz => Math.abs(z - cz) < 14)) continue;
        addTree(-12.5, z);
        addTree(12.5, z);
        addTree(-152.5, z);
        addTree(152.5, z);
    }

    let buildingColors = [0x4a5568, 0x5a67d8, 0x2b6cb0, 0x718096, 0x2d3748, 0x744210, 0x234e52, 0x4c51bf];
    let buildingList = [];

    let zSlots = [-260, -120, -75, 10, 65, 180, 260];
    let xSlots = [-30, 30, -110, 110];

    let idx = 0;
    for (let bx of xSlots) {
        for (let bz of zSlots) {
            if (crossPositionsZ.some(cz => Math.abs(bz - cz) < 22)) continue;
            let w = 12 + (idx % 3) * 2;
            let d = 12 + ((idx + 1) % 3) * 2;
            let h = 7 + (idx % 4) * 2.5;
            let col = buildingColors[idx % buildingColors.length];
            buildingList.push({ x: bx, z: bz, w, h, d, color: col });
            idx++;
        }
    }

    let isNight = selectedMapColor === 0x12121c;
    let winMat = new THREE.MeshStandardMaterial({
        color: isNight ? 0xffeaa7 : 0x90cdf4,
        emissive: isNight ? 0xffb142 : 0x000000,
        emissiveIntensity: isNight ? 0.9 : 0,
        roughness: 0.2,
        metalness: 0.8
    });

    buildingList.forEach(b => {
        let mesh = new THREE.Mesh(
            new THREE.BoxGeometry(b.w, b.h, b.d),
            new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.55, metalness: 0.25 })
        );
        mesh.position.set(b.x, b.h / 2, b.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        let floors = Math.max(2, Math.floor(b.h / 3.2));
        for (let f = 1; f < floors; f++) {
            let wy = f * 3.0;
            let winStrip = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.16, 0.55, b.d + 0.16), winMat);
            winStrip.position.set(b.x, wy, b.z);
            scene.add(winStrip);
        }

        let roofFloor = new THREE.Mesh(
            new THREE.BoxGeometry(b.w + 0.5, 0.35, b.d + 0.5),
            new THREE.MeshStandardMaterial({ color: 0x1a202c, roughness: 0.7 })
        );
        roofFloor.position.set(b.x, b.h, b.z);
        roofFloor.receiveShadow = true;
        scene.add(roofFloor);

        walkables.push({
            minX: b.x - b.w / 2,
            maxX: b.x + b.w / 2,
            minZ: b.z - b.d / 2,
            maxZ: b.z + b.d / 2,
            topY: b.h,
            isStairs: false
        });

        obstacles.push({
            minX: b.x - b.w / 2 - 0.5,
            maxX: b.x + b.w / 2 + 0.5,
            minZ: b.z - b.d / 2 - 0.5,
            maxZ: b.z + b.d / 2 + 0.5,
            topY: b.h
        });

        buildStairsForBuilding(b);
        spawnMedkit(b.x, b.h + 0.6, b.z);
    });

    spawnCar(0xff1e27, -4.5, 15, 0, "Sports Car");
    spawnCar(0x00a8ff, 4.5, -20, Math.PI, "Police Interceptor");
    spawnCar(0xf5b041, -4.5, -110, 0, "Muscle Car");
    spawnCar(0x9b59b6, 136, 40, Math.PI, "Turbo GT");

    spawnBike(0x00ff88, -3.5, 32, 0, "Ninja Bike");
    spawnBike(0xff00aa, 3.5, 0, Math.PI, "Cyber Bike");
    spawnBike(0x00ffff, -136, -35, Math.PI / 2, "Street Hawk");

    spawnMedkit(0, 0.6, 5);
    spawnMedkit(0, 0.6, -65);
    spawnMedkit(-140, 0.6, 20);
    spawnMedkit(140, 0.6, -50);

    createSafeZoneRing();
    spawnAirdrop();
}

function buildStairsForBuilding(b) {
    let dir = b.x < 0 ? 1 : -1;
    let stairLen = 14;
    let stairW = 3.8;
    let stepsCount = 18;
    let stepDepth = stairLen / stepsCount;
    let stepHeight = b.h / stepsCount;

    let innerX = b.x + dir * (b.w / 2);
    let outerX = b.x + dir * (b.w / 2 + stairLen);

    let stepMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.55 });

    for (let s = 0; s < stepsCount; s++) {
        let ratio = (s + 0.5) / stepsCount;
        let sx = outerX + (innerX - outerX) * ratio;
        let sh = stepHeight * (s + 1);
        let stepMesh = new THREE.Mesh(
            new THREE.BoxGeometry(stepDepth + 0.1, sh, stairW),
            stepMat
        );
        stepMesh.position.set(sx, sh / 2, b.z);
        stepMesh.castShadow = true;
        stepMesh.receiveShadow = true;
        scene.add(stepMesh);
    }

    walkables.push({
        minX: Math.min(innerX, outerX) - 0.5,
        maxX: Math.max(innerX, outerX) + 0.5,
        minZ: b.z - stairW / 2,
        maxZ: b.z + stairW / 2,
        highX: innerX,
        lowX: outerX,
        topY: b.h,
        isStairs: true
    });
}

function spawnMedkit(x, y, z) {
    let group = new THREE.Group();
    let box = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.7, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00aa44, emissiveIntensity: 0.7 })
    );
    box.castShadow = true;
    group.add(box);

    let cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    let cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    group.add(cross1, cross2);

    group.position.set(x, y, z);
    scene.add(group);
    medkitDrops.push(group);
}

function addTree(x, z) {
    let tree = new THREE.Group();
    let trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.52, 2.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 })
    );
    trunk.position.y = 1.3;
    trunk.castShadow = true;
    tree.add(trunk);

    let crown1 = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 4.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x1e8449, roughness: 0.78 })
    );
    crown1.position.y = 3.9;
    crown1.castShadow = true;
    tree.add(crown1);

    let crown2 = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 3.0, 8),
        new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.75 })
    );
    crown2.position.y = 5.4;
    crown2.castShadow = true;
    tree.add(crown2);

    tree.position.set(x, 0, z);
    scene.add(tree);

    obstacles.push({
        minX: x - 1.0, maxX: x + 1.0,
        minZ: z - 1.0, maxZ: z + 1.0,
        topY: 6
    });
}

function createCarMesh(colorHex) {
    let car = new THREE.Group();
    let chassis = new THREE.Mesh(
        new THREE.BoxGeometry(2.25, 0.85, 4.45),
        new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.2, metalness: 0.65 })
    );
    chassis.position.y = 0.75;
    chassis.castShadow = true;
    car.add(chassis);

    let cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.82, 0.65, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.12, metalness: 0.85 })
    );
    cabin.position.set(0, 1.45, -0.2);
    cabin.castShadow = true;
    car.add(cabin);

    let headLightMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
    let tailLightMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
    [-0.75, 0.75].forEach(lx => {
        let hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), headLightMat);
        hl.position.set(lx, 0.78, -2.24);
        car.add(hl);

        let tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), tailLightMat);
        tl.position.set(lx, 0.78, 2.24);
        car.add(tl);
    });

    let wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    let wheelMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.6 });
    [[-1.15, 0.45, 1.35], [1.15, 0.45, 1.35], [-1.15, 0.45, -1.35], [1.15, 0.45, -1.35]].forEach(([wx, wy, wz]) => {
        let w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(wx, wy, wz);
        w.castShadow = true;
        car.add(w);
    });
    return car;
}

function spawnCar(colorHex, x, z, rotY, label) {
    let car = createCarMesh(colorHex);
    car.position.set(x, 0, z);
    car.rotation.y = rotY;
    car.userData = { label, type: "car", canShoot: false, maxSpeed: 0.85 };
    scene.add(car);
    vehicles.push(car);
}

function spawnBike(colorHex, x, z, rotY, label) {
    let bike = new THREE.Group();
    let body = new THREE.Mesh(
        new THREE.BoxGeometry(0.65, 0.65, 2.3),
        new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.2, metalness: 0.7 })
    );
    body.position.y = 0.65;
    body.castShadow = true;
    bike.add(body);

    let handle = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.1, 0.12),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8 })
    );
    handle.position.set(0, 1.05, -0.75);
    bike.add(handle);

    let wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.24, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    let wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    let frontWheel = new THREE.Mesh(wheelGeo, wheelMat);
    frontWheel.position.set(0, 0.42, -0.85);
    frontWheel.castShadow = true;
    bike.add(frontWheel);

    let backWheel = new THREE.Mesh(wheelGeo, wheelMat);
    backWheel.position.set(0, 0.42, 0.85);
    backWheel.castShadow = true;
    bike.add(backWheel);

    bike.position.set(x, 0, z);
    bike.rotation.y = rotY;
    bike.userData = { label, type: "bike", canShoot: true, maxSpeed: 0.95 };
    scene.add(bike);
    vehicles.push(bike);
}

function createFighter(outfitColor, glowColor, hairColor, markerColor = null) {
    let group = new THREE.Group();
    let body = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 1.1, 0.5),
        new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.45, metalness: 0.2 })
    );
    body.position.y = 0.55;
    body.castShadow = true;
    group.add(body);

    let head = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.42, 0.42),
        new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.6 })
    );
    head.position.y = 1.32;
    head.castShadow = true;
    group.add(head);

    let hair = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.25, 0.5),
        new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.5 })
    );
    hair.position.y = 1.62;
    hair.castShadow = true;
    group.add(hair);

    if (markerColor !== null) {
        let marker = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.1, 0.1),
            new THREE.MeshBasicMaterial({ color: markerColor })
        );
        marker.position.y = 1.95;
        group.add(marker);
    }

    let armGeo = new THREE.BoxGeometry(0.22, 0.78, 0.22);
    let armMat = new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.45 });

    let leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.54, 0.68, -0.25);
    leftArm.rotation.x = Math.PI / 3;
    leftArm.castShadow = true;
    group.add(leftArm);

    let rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.54, 0.68, -0.25);
    rightArm.rotation.x = Math.PI / 3;
    rightArm.castShadow = true;
    group.add(rightArm);

    let gunGroup = new THREE.Group();
    let stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.5), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6 }));
    stock.position.set(0, 0, 0.2);
    gunGroup.add(stock);

    let barrel = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.15, 1.0),
        new THREE.MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.9 })
    );
    barrel.position.set(0, 0.03, -0.45);
    gunGroup.add(barrel);

    gunGroup.position.set(0.45, 0.65, -0.45);
    group.add(gunGroup);

    let legGeo = new THREE.BoxGeometry(0.28, 0.8, 0.28);
    let legMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.7 });
    let lLeg = new THREE.Mesh(legGeo, legMat); lLeg.position.set(-0.22, -0.4, 0); lLeg.name = "leftLeg"; lLeg.castShadow = true;
    let rLeg = new THREE.Mesh(legGeo, legMat); rLeg.position.set(0.22, -0.4, 0); rLeg.name = "rightLeg"; rLeg.castShadow = true;
    group.add(lLeg, rLeg);

    return group;
}

window.enterGame = function() {
    let nameInput = document.getElementById('heroNameInput').value.trim();
    if (nameInput !== "") {
        finalPlayerName = nameInput.toUpperCase();
        playerProfile.name = finalPlayerName;
        saveProfileToBrowser();
    }

    let scopeInfo = currentWeaponStats.scope ? ` | ${currentWeaponStats.scope}` : "";
    document.getElementById('displayGunName').innerText = "GUN: " + selectedWeaponName + scopeInfo;
    document.getElementById('hudUid').innerText = playerProfile.uid;

    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
    }

    let lobbyEl = document.getElementById('lobby');
    lobbyEl.style.display = 'none';
    lobbyEl.style.zIndex = '-1';

    document.getElementById('ui').style.display = 'flex';
    document.getElementById('minimap-box').style.display = 'block';
    document.getElementById('controls').style.display = 'flex';
    active = true;

    highestLevelReached = playerProfile.level || 0;
    playerLevel = highestLevelReached;
    totalKills = playerProfile.totalKills || 0;
    nextLevelStepKills = playerProfile.nextStep || 5;
    nextLevelTargetKills = playerProfile.nextTarget || 5;
    lockMonotonicLevel();

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    let isNight = selectedMapColor === 0x12121c;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(isNight ? 0x070b19 : 0x7ec8e3);
    scene.fog = new THREE.FogExp2(scene.background.getHex(), 0.0026);

    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isNight ? 1.15 : 1.05;
    document.getElementById('webgl-container').appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(isNight ? 0x3b4d7a : 0xffffff, isNight ? 0x111122 : 0x4a5568, isNight ? 0.55 : 0.75));

    dirLight = new THREE.DirectionalLight(isNight ? 0x8ab4f8 : 0xfff7e6, isNight ? 0.8 : 1.25);
    dirLight.position.set(45, 75, 35);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 220;
    let d = 75;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);
    scene.add(dirLight.target);

    buildMegaOpenWorld();

    player = createFighter(selectedOutfit, selectedGunGlow, 0xffffff, null);
    player.position.set(0, 0.7, 36);
    scene.add(player);

    let squadFriends = playerProfile.friends.filter(f => f.status === "friend" && f.inSquad);
    squadFriends.forEach((sf, i) => {
        let mate = createFighter(0x0055ff, 0x00ff88, 0x00ffff, 0x00ff88);
        mate.position.set((i + 1) * 2.5, 0.7, 36);
        mate.userData = { name: sf.name, uid: sf.uid, fireTimer: 0 };
        scene.add(mate);
        squadTeammates.push(mate);
    });

    updateHealthUI();
    updateLevelUI();
    updateAliveUI();

    for (let k = 0; k < 4; k++) spawnEnemy();
    setInterval(spawnEnemy, 3500);
    setInterval(spawnEnemyChaseCar, 9500);
    setInterval(spawnAirdrop, 14000);
    loop();
};

window.addEventListener('resize', () => {
    if (!renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function spawnEnemy() {
    if (!active || enemies.length >= 8) return;
    let role = Math.random() < 0.55 ? "strafer" : "rusher";
    let enemy = createFighter(role === "rusher" ? 0x2b1118 : 0xdddddd, 0xff0033, 0x880033, 0xff0033);

    let angle = Math.random() * Math.PI * 2;
    let dist = 25 + Math.random() * Math.min(40, zoneRadius * 0.4);
    let ex = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, player.position.x + Math.cos(angle) * dist));
    let ez = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, player.position.z + Math.sin(angle) * dist));
    enemy.position.set(ex, 0.7, ez);

    enemy.userData = {
        role: role,
        hp: role === "rusher" ? 75 : 60,
        speed: role === "rusher" ? 0.135 : 0.095,
        strafeDir: Math.random() < 0.5 ? 1 : -1,
        strafeTimer: 40 + Math.floor(Math.random() * 50),
        walkCycle: Math.random() * 10,
        fireTimer: Math.floor(Math.random() * 40),
        fireCooldown: role === "rusher" ? 65 : 85
    };
    scene.add(enemy);
    enemies.push(enemy);
    updateAliveUI();
}

function spawnEnemyChaseCar() {
    if (!active || enemyCars.length >= 2) return;
    let eCar = createCarMesh(0x111111);
    let roofLight = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.2, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xff0033 })
    );
    roofLight.position.set(0, 1.85, -0.2);
    eCar.add(roofLight);

    let angle = Math.random() * Math.PI * 2;
    let ex = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, player.position.x + Math.cos(angle) * 55));
    let ez = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, player.position.z + Math.sin(angle) * 55));
    eCar.position.set(ex, 0, ez);
    eCar.userData = { hp: 120, weaveOffset: Math.random() * 6 };
    scene.add(eCar);
    enemyCars.push(eCar);
    updateAliveUI();
}

function enemyShoot(enemy, targetPos, spread = 0) {
    let eb = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff0033 })
    );
    eb.position.set(enemy.position.x, enemy.position.y + 0.65, enemy.position.z);

    let dir = new THREE.Vector3(targetPos.x - enemy.position.x + spread, 0, targetPos.z - enemy.position.z).normalize();
    eb.userData = { velocity: dir.multiplyScalar(0.58) };
    scene.add(eb);
    enemyBullets.push(eb);
}

function getNearbyVehicle() {
    for (let v of vehicles) {
        if (player.position.distanceTo(v.position) < 4.5) return v;
    }
    return null;
}

function updateFireButtonState() {
    let fireBtn = document.getElementById('fireBtn');
    if (drivingVehicle && !drivingVehicle.userData.canShoot) {
        fireBtn.classList.add('disabled');
        isFiring = false;
    } else {
        fireBtn.classList.remove('disabled');
    }
    updateAutoScopeVisual();
}

document.getElementById('micBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    toggleMicChat();
});

document.getElementById('healBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (medkits > 0 && hp < 100) {
        medkits--;
        hp = Math.min(100, hp + 50);
        updateHealthUI();
        let msg = document.getElementById('heal-msg');
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 1800);
    }
});

document.getElementById('carBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (drivingVehicle) {
        player.visible = true;
        player.position.set(drivingVehicle.position.x + 2.4, 0.7, drivingVehicle.position.z);
        drivingVehicle = null;
        vehicleSpeed = 0;
        document.getElementById('modeLabel').innerText = "ON FOOT";
    } else {
        let near = getNearbyVehicle();
        if (near) {
            drivingVehicle = near;
            vehicleSpeed = 0;
            player.visible = (near.userData.type === "bike");
            document.getElementById('modeLabel').innerText = near.userData.label.toUpperCase();
        }
    }
    updateFireButtonState();
});

let stick = document.getElementById('stick'), knob = document.getElementById('knob');
let center = { x: 0, y: 0 };

stick.addEventListener('touchstart', e => {
    if (joystickTouchId === null) {
        let touch = e.changedTouches[0];
        joystickTouchId = touch.identifier;
        let r = stick.getBoundingClientRect();
        center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
});

window.addEventListener('touchstart', e => {
    for (let touch of e.changedTouches) {
        if (touch.clientX > window.innerWidth / 2 && cameraTouchId === null && !['jumpBtn', 'fireBtn', 'carBtn', 'healBtn', 'micBtn'].includes(touch.target.id)) {
            cameraTouchId = touch.identifier;
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
        }
    }
});

window.addEventListener('touchmove', e => {
    for (let touch of e.touches) {
        if (touch.identifier === joystickTouchId) {
            let dx = touch.clientX - center.x, dy = touch.clientY - center.y;
            let dist = Math.hypot(dx, dy), max = 35;
            if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            mx = dx / max;
            mz = -dy / max;
        }
        if (touch.identifier === cameraTouchId) {
            let deltaX = touch.clientX - lastTouchX;
            let deltaY = touch.clientY - lastTouchY;
            let sens = isFiring && currentWeaponStats.scope ? 0.0035 : 0.007;
            cameraYaw -= deltaX * sens;
            cameraPitch = Math.max(0.08, Math.min(1.15, cameraPitch - deltaY * (sens * 0.7)));
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
        }
    }
});

window.addEventListener('touchend', e => {
    for (let touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) {
            joystickTouchId = null; mx = 0; mz = 0;
            knob.style.transform = `translate(0px, 0px)`;
        }
        if (touch.identifier === cameraTouchId) cameraTouchId = null;
    }
});

document.getElementById('jumpBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!drivingVehicle && !isJumping) {
        isJumping = true;
        jumpVelocity = 0.32;
    }
});

let fireBtn = document.getElementById('fireBtn');
fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (drivingVehicle && !drivingVehicle.userData.canShoot) return;
    isFiring = true;
    updateAutoScopeVisual();
});
fireBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    isFiring = false;
    updateAutoScopeVisual();
});

function shootBullet() {
    if (!active) return;
    if (drivingVehicle && !drivingVehicle.userData.canShoot) return;

    playGunSound();
    let isSniper = currentWeaponStats.type === "Sniper";
    let bSize = isSniper ? 0.28 : 0.22;
    let bSpeed = isSniper ? 1.85 : 1.2;

    let origin = drivingVehicle ? drivingVehicle.position : player.position;
    let spawnPos = new THREE.Vector3(origin.x, origin.y + 0.7, origin.z);
    spawnSparks(spawnPos, isSniper ? 0xffaa00 : selectedGunGlow, 4);

    let b = new THREE.Mesh(
        new THREE.SphereGeometry(bSize, 8, 8),
        new THREE.MeshBasicMaterial({ color: isSniper ? 0xffaa00 : selectedGunGlow })
    );
    b.position.copy(spawnPos);

    let forwardX = -Math.sin(cameraYaw);
    let forwardZ = -Math.cos(cameraYaw);
    let dir = new THREE.Vector3(forwardX, 0, forwardZ).normalize();

    b.userData = { velocity: dir.multiplyScalar(bSpeed), damage: currentWeaponStats.damage };
    scene.add(b);
    bullets.push(b);
}

function getFloorHeight(x, z, currentFootY) {
    let floorY = 0;
    for (let w of walkables) {
        if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) {
            if (w.isStairs) {
                let ratio = (x - w.lowX) / (w.highX - w.lowX);
                ratio = Math.max(0, Math.min(1, ratio));
                let stairY = ratio * w.topY;
                if (currentFootY >= stairY - 1.2) {
                    floorY = Math.max(floorY, stairY);
                }
            } else if (currentFootY >= w.topY - 0.9) {
                floorY = Math.max(floorY, w.topY);
            }
        }
    }
    return floorY;
}

function hitsObstacle(x, z, radius, footY) {
    for (let obs of obstacles) {
        if (footY >= obs.topY - 0.6) continue;
        if (x + radius > obs.minX && x - radius < obs.maxX && z + radius > obs.minZ && z - radius < obs.maxZ) {
            return true;
        }
    }
    return false;
}

let fireTimer = 0;
let clock = new THREE.Clock();

function loop() {
    if (!active) return;
    requestAnimationFrame(loop);
    let time = clock.getElapsedTime();

    if (zoneRadius > MIN_ZONE_RADIUS) {
        zoneRadius -= 0.045;
        updateSafeZoneVisual();
    }

    let promptEl = document.getElementById('car-prompt');
    if (!drivingVehicle && getNearbyVehicle()) {
        promptEl.style.display = 'block';
    } else {
        promptEl.style.display = 'none';
    }

    let isPlayerOnSafeRoof = (!drivingVehicle && player.position.y > 4.5);

    if (drivingVehicle) {
        let targetSpeed = mz * drivingVehicle.userData.maxSpeed;
        vehicleSpeed += (targetSpeed - vehicleSpeed) * 0.08;

        if (Math.abs(vehicleSpeed) > 0.015) {
            let turnSign = vehicleSpeed >= 0 ? 1 : -1;
            drivingVehicle.rotation.y -= mx * 0.038 * turnSign;
        }

        let nextX = drivingVehicle.position.x - Math.sin(drivingVehicle.rotation.y) * vehicleSpeed;
        let nextZ = drivingVehicle.position.z - Math.cos(drivingVehicle.rotation.y) * vehicleSpeed;

        if (!hitsObstacle(nextX, nextZ, 1.5, 0)) {
            drivingVehicle.position.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextX));
            drivingVehicle.position.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextZ));
        } else {
            vehicleSpeed = 0;
        }

        if (drivingVehicle.userData.type === "bike") {
            player.position.set(drivingVehicle.position.x, drivingVehicle.position.y + 1.05, drivingVehicle.position.z);
            player.rotation.y = drivingVehicle.rotation.y;
        } else {
            player.position.copy(drivingVehicle.position);
        }
        cameraYaw = drivingVehicle.rotation.y;
    } else {
        let forwardX = -Math.sin(cameraYaw);
        let forwardZ = -Math.cos(cameraYaw);
        let rightX = Math.cos(cameraYaw);
        let rightZ = -Math.sin(cameraYaw);

        let moveX = forwardX * mz + rightX * mx;
        let moveZ = forwardZ * mz + rightZ * mx;

        let footY = player.position.y - 0.7;
        let nextX = player.position.x + moveX * 0.24;
        let nextZ = player.position.z + moveZ * 0.24;

        if (!hitsObstacle(nextX, nextZ, 0.65, footY)) {
            player.position.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextX));
            player.position.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, nextZ));
        }
        player.rotation.y = cameraYaw;

        let lLeg = player.getObjectByName("leftLeg");
        let rLeg = player.getObjectByName("rightLeg");
        if (mx !== 0 || mz !== 0) {
            lLeg.rotation.x = Math.sin(time * 18) * 0.7;
            rLeg.rotation.x = -Math.sin(time * 18) * 0.7;
        } else {
            lLeg.rotation.x = 0; rLeg.rotation.x = 0;
        }

        let floorY = getFloorHeight(player.position.x, player.position.z, footY);
        let targetStandY = floorY + 0.7;

        if (isJumping) {
            player.position.y += jumpVelocity;
            jumpVelocity -= gravity;
            if (player.position.y <= targetStandY && jumpVelocity <= 0) {
                player.position.y = targetStandY;
                isJumping = false;
            }
        } else {
            if (player.position.y > targetStandY + 0.1) {
                player.position.y -= 0.22;
                if (player.position.y < targetStandY) player.position.y = targetStandY;
            } else {
                player.position.y = targetStandY;
            }
        }

        document.getElementById('modeLabel').innerText = isPlayerOnSafeRoof ? "SAFE ROOF" : "ON FOOT";
    }

    let targetPos = drivingVehicle ? drivingVehicle.position : player.position;
    syncMatchState(targetPos);
    drawMinimap(targetPos);

    squadTeammates.forEach((mate, idx) => {
        let offsetAngle = cameraYaw + (idx + 1) * 1.1;
        let desiredX = targetPos.x + Math.sin(offsetAngle) * 3.5;
        let desiredZ = targetPos.z + Math.cos(offsetAngle) * 3.5;
        mate.position.x += (desiredX - mate.position.x) * 0.08;
        mate.position.z += (desiredZ - mate.position.z) * 0.08;
        mate.position.y = targetPos.y;
        mate.rotation.y = cameraYaw;

        mate.userData.fireTimer++;
        if (enemies.length > 0 && mate.userData.fireTimer % 55 === 0) {
            let nearest = enemies[0];
            if (mate.position.distanceTo(nearest.position) < 42) {
                let sb = new THREE.Mesh(
                    new THREE.SphereGeometry(0.2, 8, 8),
                    new THREE.MeshBasicMaterial({ color: 0x00ff88 })
                );
                sb.position.set(mate.position.x, mate.position.y + 0.7, mate.position.z);
                let dir = new THREE.Vector3(nearest.position.x - mate.position.x, 0, nearest.position.z - mate.position.z).normalize();
                sb.userData = { velocity: dir.multiplyScalar(1.1), damage: 25 };
                scene.add(sb);
                bullets.push(sb);
            }
        }
    });

    if (dirLight) {
        dirLight.position.set(targetPos.x + 45, targetPos.y + 75, targetPos.z + 35);
        dirLight.target.position.copy(targetPos);
        dirLight.target.updateMatrixWorld();
    }

    for (let s = sparks.length - 1; s >= 0; s--) {
        let sp = sparks[s];
        sp.position.add(sp.userData.vel);
        sp.userData.vel.y -= 0.015;
        sp.userData.life--;
        if (sp.userData.life <= 0) {
            scene.remove(sp);
            sparks.splice(s, 1);
        }
    }

    let distFromCenter = Math.hypot(targetPos.x, targetPos.z);
    let zoneEl = document.getElementById('zoneStatus');
    if (distFromCenter > zoneRadius) {
        zoneEl.innerText = "OUTSIDE!";
        zoneEl.style.color = "#ff0055";
        zoneDamageTick++;
        if (zoneDamageTick % 45 === 0) {
            hp -= 3;
            updateHealthUI();
            if (hp <= 0) {
                alert('Eliminated by Battle Zone!');
                location.reload();
            }
        }
    } else {
        zoneEl.innerText = "SAFE";
        zoneEl.style.color = "#00ff88";
    }

    for (let m = medkitDrops.length - 1; m >= 0; m--) {
        let mk = medkitDrops[m];
        mk.rotation.y += 0.04;
        if (targetPos.distanceTo(mk.position) < 2.3) {
            medkits++;
            updateHealthUI();
            scene.remove(mk);
            medkitDrops.splice(m, 1);
        }
    }

    for (let a = airdrops.length - 1; a >= 0; a--) {
        let drop = airdrops[a];
        drop.rotation.y += 0.02;
        if (targetPos.distanceTo(drop.position) < 3.0) {
            medkits++;
            score += 40;
            document.getElementById('s').innerText = score;
            updateHealthUI();
            scene.remove(drop);
            airdrops.splice(a, 1);

            let dMsg = document.getElementById('drop-msg');
            dMsg.style.display = 'block';
            setTimeout(() => { dMsg.style.display = 'none'; }, 2000);
        }
    }

    let camDist = drivingVehicle ? 12 : 10;
    let horizDist = Math.cos(cameraPitch) * camDist;
    let vertHeight = Math.sin(cameraPitch) * camDist + 2.2;

    camera.position.set(
        targetPos.x + Math.sin(cameraYaw) * horizDist,
        targetPos.y + vertHeight,
        targetPos.z + Math.cos(cameraYaw) * horizDist
    );
    camera.lookAt(targetPos.x, targetPos.y + 1.2, targetPos.z);

    if (isFiring) {
        fireTimer++;
        let fireDelay = Math.max(4, Math.floor(600 / currentWeaponStats.fireRate * 8));
        if (fireTimer % fireDelay === 0) shootBullet();
    } else {
        fireTimer = 0;
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
        let bl = bullets[i];
        bl.position.add(bl.userData.velocity);
        if (bl.position.distanceTo(targetPos) > 135) { scene.remove(bl); bullets.splice(i, 1); }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        let eb = enemyBullets[i];
        eb.position.add(eb.userData.velocity);

        if (!isPlayerOnSafeRoof && eb.position.distanceTo(targetPos) < 1.3 && Math.abs(eb.position.y - targetPos.y) < 2.2) {
            spawnSparks(eb.position, 0xff0033, 6);
            scene.remove(eb);
            enemyBullets.splice(i, 1);
            hp -= 8;
            updateHealthUI();
            if (hp <= 0) {
                alert('Wasted! Smart AI defeated you.');
                location.reload();
            }
            continue;
        }
        if (eb.position.distanceTo(targetPos) > 95) {
            scene.remove(eb);
            enemyBullets.splice(i, 1);
        }
    }

    for (let c = enemyCars.length - 1; c >= 0; c--) {
        let eCar = enemyCars[c];
        let toPlayer = new THREE.Vector3(targetPos.x - eCar.position.x, 0, targetPos.z - eCar.position.z);
        let dist = toPlayer.length();

        if (dist > 4.5 && !isPlayerOnSafeRoof) {
            toPlayer.normalize();
            let perpX = -toPlayer.z * Math.sin(time * 2.2 + eCar.userData.weaveOffset) * 0.25;
            let perpZ = toPlayer.x * Math.sin(time * 2.2 + eCar.userData.weaveOffset) * 0.25;

            let nextCX = eCar.position.x + (toPlayer.x * 0.44 + perpX);
            let nextCZ = eCar.position.z + (toPlayer.z * 0.44 + perpZ);

            if (!hitsObstacle(nextCX, nextCZ, 1.6, 0)) {
                eCar.position.x = nextCX;
                eCar.position.z = nextCZ;
            }
            eCar.rotation.y = Math.atan2(-(toPlayer.x + perpX), -(toPlayer.z + perpZ));
        }

        for (let j = bullets.length - 1; j >= 0; j--) {
            if (eCar.position.distanceTo(bullets[j].position) < 2.4) {
                spawnSparks(bullets[j].position, 0xffaa00, 7);
                eCar.userData.hp -= bullets[j].userData.damage;
                scene.remove(bullets[j]);
                bullets.splice(j, 1);
                if (eCar.userData.hp <= 0) {
                    spawnSparks(eCar.position, 0xff5500, 14);
                    scene.remove(eCar);
                    enemyCars.splice(c, 1);
                    registerKill(50);
                }
                break;
            }
        }
    }

    for (let i = enemies.length - 1; i >= 0; i--) {
        let en = enemies[i];
        let data = en.userData;

        let dx = targetPos.x - en.position.x;
        let dz = targetPos.z - en.position.z;
        let dist = Math.hypot(dx, dz);

        if (dist > 0.01 && !isPlayerOnSafeRoof) {
            let fwdX = dx / dist;
            let fwdZ = dz / dist;

            data.strafeTimer--;
            if (data.strafeTimer <= 0) {
                data.strafeDir *= -1;
                data.strafeTimer = 35 + Math.floor(Math.random() * 55);
            }

            let rightVecX = -fwdZ * data.strafeDir;
            let rightVecZ = fwdX * data.strafeDir;

            let desiredX = 0, desiredZ = 0;
            if (data.role === "rusher") {
                let approach = dist > 3.5 ? 1.0 : 0.2;
                desiredX = fwdX * approach + rightVecX * 0.45;
                desiredZ = fwdZ * approach + rightVecZ * 0.45;
            } else {
                let approach = dist > 14 ? 0.85 : (dist < 7 ? -0.4 : 0.15);
                desiredX = fwdX * approach + rightVecX * 0.85;
                desiredZ = fwdZ * approach + rightVecZ * 0.85;
            }

            let len = Math.hypot(desiredX, desiredZ) || 1;
            desiredX /= len;
            desiredZ /= len;

            let nextEX = en.position.x + desiredX * data.speed;
            let nextEZ = en.position.z + desiredZ * data.speed;

            if (!hitsObstacle(nextEX, nextEZ, 0.65, 0)) {
                en.position.x = nextEX;
                en.position.z = nextEZ;
            } else {
                let altX = en.position.x + rightVecX * data.speed * 1.2;
                let altZ = en.position.z + rightVecZ * data.speed * 1.2;
                if (!hitsObstacle(altX, altZ, 0.65, 0)) {
                    en.position.x = altX;
                    en.position.z = altZ;
                } else {
                    data.strafeDir *= -1;
                }
            }
        }

        en.rotation.y = Math.atan2(en.position.x - targetPos.x, en.position.z - targetPos.z);

        data.walkCycle += 0.28;
        data.fireTimer++;

        if (!isPlayerOnSafeRoof && dist < 44 && data.fireTimer % data.fireCooldown === 0) {
            let spread = (Math.random() - 0.5) * 1.6;
            enemyShoot(en, targetPos, spread);
        }

        let eLLeg = en.getObjectByName("leftLeg");
        let eRLeg = en.getObjectByName("rightLeg");
        if (eLLeg && eRLeg) {
            eLLeg.rotation.x = Math.sin(data.walkCycle) * 0.75;
            eRLeg.rotation.x = -Math.sin(data.walkCycle) * 0.75;
        }

        if (drivingVehicle && Math.abs(vehicleSpeed) > 0.15 && en.position.distanceTo(drivingVehicle.position) < 2.6) {
            spawnSparks(en.position, 0xff0033, 10);
            scene.remove(en);
            enemies.splice(i, 1);
            registerKill(25);
            continue;
        }

        for (let j = bullets.length - 1; j >= 0; j--) {
            if (en.position.distanceTo(bullets[j].position) < 1.5) {
                spawnSparks(bullets[j].position, 0xff0033, 7);
                data.hp -= bullets[j].userData.damage;
                scene.remove(bullets[j]);
                bullets.splice(j, 1);
                if (data.hp <= 0) {
                    spawnSparks(en.position, 0xff0055, 12);
                    scene.remove(en);
                    enemies.splice(i, 1);
                    registerKill(data.role === "rusher" ? 30 : 20);
                }
                break;
            }
        }
    }

    renderer.render(scene, camera);
}
