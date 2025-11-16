//
// === public/floating-char.js ===
//

// --- Settings ---
const CHAR_COUNT = 11;
const BASE_SPEED = 0.25; 
const CHAR_SIZE = 64; 
const HIDDEN_SPEED_MULTIPLIER = 10; 

// --- State ---
let characters = [];
let cardElement = null;
let containerElement = null;

// --- NEW: Canvas State ---
let canvas = null;
let ctx = null; // This is the "drawing context"

// This is the main animation loop
function animate() {
    if (!containerElement || !cardElement || !ctx) return; // <-- Added ctx check

    const cardRect = cardElement.getBoundingClientRect();

    // --- Clear the canvas ---
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Character Loop
    for (let i = 0; i < characters.length; i++) {
        const charA = characters[i];
        
        // --- Find closest neighbor and draw line ---
        let minDistance = Infinity;
        let closestNeighbor = null;
        
        const charA_centerX = charA.x + (CHAR_SIZE / 2);
        const charA_centerY = charA.y + (CHAR_SIZE / 2);

        for (let j = 0; j < characters.length; j++) {
            if (i === j) continue; // Don't check against self

            const charB = characters[j];
            
            const charB_centerX = charB.x + (CHAR_SIZE / 2);
            const charB_centerY = charB.y + (CHAR_SIZE / 2);
            
            const dist = Math.sqrt(
                Math.pow(charA_centerX - charB_centerX, 2) +
                Math.pow(charA_centerY - charB_centerY, 2)
            );

            if (dist < minDistance) {
                minDistance = dist;
                closestNeighbor = charB;
            }
        }
        
        // Draw the line to the closest neighbor
        if (closestNeighbor) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // 40% opaque white
            ctx.lineWidth = 1;
            ctx.moveTo(charA_centerX, charA_centerY); // Start at center of charA
            ctx.lineTo(
                closestNeighbor.x + (CHAR_SIZE / 2), // End at center of neighbor
                closestNeighbor.y + (CHAR_SIZE / 2)
            );
            ctx.stroke();
        }
        // --- END OF DRAWING LOGIC ---


        // 1. Check for collisions with *other* characters
        for (let j = i + 1; j < characters.length; j++) {
            const charB = characters[j];

            // Full-box collision check
            const isColliding =
                charA.x < charB.x + CHAR_SIZE &&
                charA.x + CHAR_SIZE > charB.x &&
                charA.y < charB.y + CHAR_SIZE &&
                charA.y + CHAR_SIZE > charB.y;

            if (isColliding) {
                // --- This is the "Stronger Bump" logic ---
                charA.dx *= -1;
                charA.dy *= -1;
                charB.dx *= -1;
                charB.dy *= -1;

                // Nudge them apart
                charA.x += charA.dx * 2; 
                charA.y += charA.dy * 2;
                charB.x += charB.dx * 2; 
                charB.y += charB.dy * 2;
            }
        }
        
        // 2. Check for "fully hidden" behind card
        const charRect = {
            left: charA.x,
            right: charA.x + CHAR_SIZE,
            top: charA.y,
            bottom: charA.y + CHAR_SIZE
        };

        const isFullyHidden =
            charRect.left > cardRect.left &&
            charRect.right < cardRect.right &&
            charRect.top > cardRect.top &&
            charRect.bottom < cardRect.bottom;

        if (isFullyHidden) {
            charA.speed = charA.baseSpeed * HIDDEN_SPEED_MULTIPLIER;
        } else {
            charA.speed = charA.baseSpeed;
        }

        // 3. Update position
        charA.x += charA.dx * charA.speed;
        charA.y += charA.dy * charA.speed;

        // 4. Wall collision + Jitter
        if (charA.x <= 0 || charA.x + CHAR_SIZE >= window.innerWidth) {
            charA.dx *= -1; 
            charA.dy += (Math.random() - 0.5) * 0.1;
        }
        if (charA.y <= 0 || charA.y + CHAR_SIZE >= window.innerHeight) {
            charA.dy *= -1; 
            charA.dx += (Math.random() - 0.5) * 0.1;
        }

        // 5. Apply position
        charA.el.style.left = charA.x + 'px';
        charA.el.style.top = charA.y + 'px';
        
        // 6. Update the coordinates text
        charA.coordsEl.textContent = `X:${Math.round(charA.x)} Y:${Math.round(charA.y)}`;
    }

    requestAnimationFrame(animate);
}

// This function sets up the characters
function init() {
    containerElement = document.getElementById('character-container');
    cardElement = document.getElementById('main-card'); 
    
    // --- Get the canvas ---
    canvas = document.getElementById('line-canvas');
    
    if (!containerElement || !cardElement || !canvas) { 
        console.error("Floating Chars: Missing container, card, or canvas element!");
        return;
    }
    
    // --- Set up canvas ---
    ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // --- Add a resize listener ---
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });


    const gridCols = 4;
    const gridRows = 3;
    const cellWidth = window.innerWidth / gridCols;
    const cellHeight = window.innerHeight / gridRows;
    let cellIndex = 0; 
    const cardRect = cardElement.getBoundingClientRect();

    for (let i = 1; i <= CHAR_COUNT; i++) {
        // --- Create a wrapper for all parts ---
        const charWrapper = document.createElement('div');
        charWrapper.className = 'floating-char-wrapper';

        // 1. The image
        const img = document.createElement('img');
        img.src = `/assets/char${i}.png`;
        img.className = 'char-image';

        // 2. The new border box
        const borderBox = document.createElement('div');
        borderBox.className = 'char-border-box';

        // 3. The new coordinates label
        const coordsLabel = document.createElement('span');
        coordsLabel.className = 'char-coords-label';
        coordsLabel.textContent = 'X:0 Y:0';

        // Put them all inside the wrapper
        charWrapper.appendChild(img);
        charWrapper.appendChild(borderBox);
        charWrapper.appendChild(coordsLabel);
        
        // --- END OF NEW STRUCTURE ---

        let spawnX, spawnY;
        let attempts = 0; 
        do {
            const col = cellIndex % gridCols;
            const row = Math.floor(cellIndex / gridCols);
            spawnX = (col * cellWidth) + (Math.random() * (cellWidth - CHAR_SIZE));
            spawnY = (row * cellHeight) + (Math.random() * (cellHeight - CHAR_SIZE));
            cellIndex++; 
            attempts++;
            const isInsideCard = 
                spawnX < cardRect.right &&
                spawnX + CHAR_SIZE > cardRect.left &&
                spawnY < cardRect.bottom &&
                spawnY + CHAR_SIZE > cardRect.top;
            if (!isInsideCard || attempts > 11) break; 
        } while (true);

        const baseSpeed = BASE_SPEED + Math.random() * 0.5;

        const charData = {
            el: charWrapper,    
            imgEl: img,         
            coordsEl: coordsLabel,
            x: spawnX, 
            y: spawnY, 
            dx: Math.random() > 0.5 ? 1 : -1,
            dy: Math.random() > 0.5 ? 1 : -1,
            speed: baseSpeed,
            baseSpeed: baseSpeed
        };

        characters.push(charData);
        containerElement.appendChild(charWrapper); 

        // Add dblclick listener
        img.addEventListener('dblclick', () => {
            if (!img.classList.contains('spinning')) {
                img.classList.add('spinning');
            }
        });
        img.addEventListener('animationend', () => {
            img.classList.remove('spinning');
        });
    }

    animate();
}

// Wait for the page to load before starting
window.addEventListener('load', init);