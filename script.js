// --- AUDIO ENGINE ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let countdownBuffer = null;
let finalBuffer = null;
let wakeupBuffer = null; 

// --- LIVE UI SYNC ---

// Update the clock face and round label when settings change
const settingsInputs = ['intervalInput', 'roundsInput'];

settingsInputs.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        // Only update if the timer isn't currently running
        if (!running) {
            const intervalMins = parseInt(document.getElementById('intervalInput').value) || 0;
            const display = document.getElementById('timerDisplay');
            
            // Update Clock Face (e.g., 05:00)
            display.innerText = `${String(intervalMins).padStart(2, '0')}:00`;
            display.style.color = "white";
            
            // Reset state and update the "ROUND 1 / X" label
            currentRound = 1;
            updateRoundLabel();
        }
    });
});

async function initAudio() {
    try {
        // Ensure variables from sounds.js are present
        if (typeof b64Countdown !== 'undefined' && typeof b64Final !== 'undefined' && typeof b64Wakeup !== 'undefined') {
            const [res1, res2, res3] = await Promise.all([
                fetch(b64Countdown), 
                fetch(b64Final), 
                fetch(b64Wakeup)
            ]);
            const [arr1, arr2, arr3] = await Promise.all([
                res1.arrayBuffer(), 
                res2.arrayBuffer(), 
                res3.arrayBuffer()
            ]);
            
            countdownBuffer = await audioCtx.decodeAudioData(arr1);
            finalBuffer = await audioCtx.decodeAudioData(arr2);
            wakeupBuffer = await audioCtx.decodeAudioData(arr3);
            
            console.log("Audio system online: Heartbeat mode enabled.");
        }
    } catch (e) {
        console.error("Audio Load Error:", e);
    }
}
initAudio();

function getSecondsSinceMidnight() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return (now.getTime() - midnight.getTime()) / 1000;
}

function playAt(buffer, time) {
    if (!buffer) return;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(time);
}

// --- TIMER STATE ---
let running = false;
let isInterval = true;
let currentRound = 1;
let audioStartTime = 0; 
let lastDisplayedSec = -1;
let timerLoop;
let scheduledBeeps = new Set(); 

// --- UTILS ---
function toB26(n) {
    if (n <= 0) return "A";
    let res = "";
    while (n > 0) {
        let rem = n % 26;
        res = String.fromCharCode(65 + rem) + res;
        n = Math.floor(n / 26);
    }
    return res;
}
function fromB26(s) {
    let n = 0;
    for (let char of s.toUpperCase()) {
        if (char >= 'A' && char <= 'Z') {
            n = n * 26 + (char.charCodeAt(0) - 65);
        }
    }
    return n;
}

// --- UI HELPERS ---
function toggleMenu() {
    const sidebar = document.getElementById('sidebar');
    const menuBtn = document.getElementById('menuBtn');
    sidebar.classList.toggle('hidden');
    menuBtn.innerText = sidebar.classList.contains('hidden') ? "☰ Einstellungen" : "✕ Schließen";
}

function updateRoundLabel() {
    const total = parseInt(document.getElementById('roundsInput').value);
    document.getElementById('roundLabel').innerText = `Runde ${currentRound}` + (total > 0 ? ` / ${total}` : "");
}

function startNew() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    playAt(wakeupBuffer, audioCtx.currentTime);

    currentRound = 1;
    isInterval = true;
    scheduledBeeps.clear();
    lastDisplayedSec = -1;
    audioStartTime = audioCtx.currentTime;

    const intervalMins = parseInt(document.getElementById('intervalInput').value);
    const startMidnight = getSecondsSinceMidnight(); // Get seconds since 00:00
    
    // Encode: (Seconds * 100) to preserve 2 decimal places in Base26
    const tEncoded = toB26(Math.round((startMidnight + 1) * 100)); // XXX
    const iEncoded = toB26(intervalMins);
    const cEncoded = document.getElementById('changeInput').checked ? "1" : "0";
    const rEncoded = toB26(parseInt(document.getElementById('roundsInput').value));

    document.getElementById('syncLabel').innerText = `${tEncoded}-${iEncoded}-${cEncoded}-${rEncoded}`;
    
    launchUI();
}
function joinSession() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playAt(wakeupBuffer, audioCtx.currentTime);

    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (!code.includes('-')) return;

    try {
        const parts = code.split('-');
        // 1. Decode the precision timestamp
        const startMidnightT = fromB26(parts[0]) / 100.0 - 1; // XXX
        const intervalMins = fromB26(parts[1]);
        const hasChange = parts[2] === "1";
        const totalRounds = fromB26(parts[3]);

        // Update UI fields
        document.getElementById('intervalInput').value = intervalMins;
        document.getElementById('changeInput').checked = hasChange;
        document.getElementById('roundsInput').value = totalRounds;

        // 2. Calculate elapsed time relative to "Now" midnight
        const nowMidnightT = getSecondsSinceMidnight();
        let elapsed = nowMidnightT - startMidnightT;

        // Handle the case where the session started yesterday (rare, but possible)
        if (elapsed < 0) elapsed += 86400; 

        const intervalDur = intervalMins * 60;
        const cycleDur = intervalDur + (hasChange ? 15 : 0);

        // 3. Determine current state
        currentRound = Math.floor(elapsed / cycleDur) + 1;
        const posInCycle = elapsed % cycleDur;

        // 4. Sync Audio Engine
        audioStartTime = audioCtx.currentTime - posInCycle;
        isInterval = (posInCycle < intervalDur);

        scheduledBeeps.clear();
        lastDisplayedSec = -1;
        document.getElementById('syncLabel').innerText = code;
        launchUI();
    } catch (e) { 
        alert("Invalid Code Format"); 
        console.error(e);
    }
}

function launchUI() {
    running = true;
    if (!document.getElementById('sidebar').classList.contains('hidden')) toggleMenu();
    document.getElementById('menuBtn').style.display = 'none';
    document.getElementById('startBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.remove('hidden');
    updateRoundLabel();
    updateLoop();
}

function stopTimer() {
    running = false;
    clearTimeout(timerLoop);
    scheduledBeeps.clear();
    
    document.getElementById('menuBtn').style.display = 'block';
    document.getElementById('stopBtn').classList.add('hidden');
    document.getElementById('startBtn').classList.remove('hidden');
    
    // Calculate the start value based on user input
    const intervalMins = parseInt(document.getElementById('intervalInput').value) || 0;
    const display = document.getElementById('timerDisplay');
    
    // Set face to Start Value (e.g., 04:00) instead of 00:00
    display.innerText = `${String(intervalMins).padStart(2, '0')}:00`;
    display.style.color = "white";
}

function updateLoop() {
    if (!running) return;

    const audioNow = audioCtx.currentTime;
    const elapsed = audioNow - audioStartTime;
    const intervalMins = parseInt(document.getElementById('intervalInput').value);
    const roundDuration = isInterval ? (intervalMins * 60) : 15;
    const remaining = roundDuration - elapsed;

    // --- HEARTBEAT SCHEDULER ---
    // This plays the wakeupBuffer every single second to keep the thread "hot"
    const currentSecInt = Math.floor(remaining);
    
    // We use a unique key for the heartbeat to avoid conflicts with actual beeps
    const heartbeatKey = "hb_" + currentSecInt;
    if (!scheduledBeeps.has(heartbeatKey) && currentSecInt >= 6) {
        const targetTime = audioStartTime + (roundDuration - currentSecInt);
        
        // Play the silent heartbeat EVERY second
        playAt(wakeupBuffer, targetTime);
        scheduledBeeps.add(heartbeatKey);
    }

    // --- ACTUAL BEEP SCHEDULER ---
    [60, 5, 4, 3, 2, 1, 0].forEach(s => {
        if (s === 60 && intervalMins <= 1) return;
        const targetTime = audioStartTime + (roundDuration - s);
        
        if (targetTime > audioNow && targetTime < audioNow + 0.5) {
            if (!scheduledBeeps.has(s)) {
                if (s === 0) {
                    playAt(finalBuffer, targetTime);
                } else {
                    playAt(countdownBuffer, targetTime);
                }
                scheduledBeeps.add(s);
            }
        }
    });

    // --- TRANSITION LOGIC ---
    if (remaining <= 0) {
        const hasChange = document.getElementById('changeInput').checked;
        const totalRounds = parseInt(document.getElementById('roundsInput').value);

        if (isInterval && hasChange) {
            isInterval = false;
        } else {
            if (totalRounds !== 0 && currentRound >= totalRounds) return stopTimer();
            currentRound++;
            isInterval = true;
            updateRoundLabel();
        }
        audioStartTime += roundDuration;
        scheduledBeeps.clear();
    }

    // --- UI RENDERING ---
     const displaySec = Math.ceil(Math.max(0, remaining));
    if (displaySec !== lastDisplayedSec) {
        const m = Math.floor(displaySec / 60);
        const s = displaySec % 60;
        if (lastDisplayedSec !== 0){
            const display = document.getElementById('timerDisplay');
            display.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            if (displaySec === 0) {
                // If we are at 0, use the OPPOSITE color of the new state.
                // If isInterval is now FALSE, it means we JUST finished Bouldering (Red).
                // If isInterval is now TRUE, it means we JUST finished Change (Orange).
                display.style.color = isInterval ? "orange" : "red";
            } else {
                // Normal ticking colors
                display.style.color = !isInterval ? "orange" : (displaySec <= 5 ? "red" : "white");
            }
        }
        lastDisplayedSec = displaySec;
    }  



    timerLoop = setTimeout(updateLoop, 20);
}