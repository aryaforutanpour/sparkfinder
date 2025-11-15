//
// === public/floating-char.js ===
//

// --- Settings ---
const CHAR_COUNT = 11;
const BASE_SPEED = 0.2; 
const CHAR_SIZE = 64; 
const HIDDEN_SPEED_MULTIPLIER = 10; 

// --- THIS IS THE FIX ---
// We'll pretend the 64px box is 16px smaller on each side
// This makes the "real" hitbox 32x32px in the center.
const HITBOX_PADDING = 16; 
// --- END OF FIX ---

// --- State ---
let characters = [];
let cardElement = null;
let containerElement = null;

// This is the main animation loop
function animate() {
    if (!containerElement || !cardElement) return;

    const cardRect = cardElement.getBoundingClientRect();

    // Character Collision Loop
    for (let i = 0; i < characters.length; i++) {
        const charA = characters[i];

        // 1. Check for collisions with *other* characters
        for (let j = i + 1; j < characters.length; j++) {
            const charB = characters[j];

            // --- THIS IS THE FIX ---
            // Define the "tighter" hitboxes using the padding
            const charA_left = charA.x + HITBOX_PADDING;
            const charA_right = charA.x + CHAR_SIZE - HITBOX_PADDING;
            const charA_top = charA.y + HITBOX_PADDING;
            const charA_bottom = charA.y + CHAR_SIZE - HITBOX_PADDING;

            const charB_left = charB.x + HITBOX_PADDING;
            const charB_right = charB.x + CHAR_SIZE - HITBOX_PADDING;
            const charB_top = charB.y + HITBOX_PADDING;
            const charB_bottom = charB.y + CHAR_SIZE - HITBOX_PADDING;

            // Check collision on the *tighter* boxes
            const isColliding =
                charA_left < charB_right &&
                charA_right > charB_left &&
                charA_top < charB_bottom &&
                charA_bottom > charB_top;
            // --- END OF FIX ---

            if (isColliding) {
                // Swap X velocities
                const tempDx = charA.dx;
                charA.dx = charB.dx;
                charB.dx = tempDx;

                // Swap Y velocities
                const tempDy = charA.dy;
                charA.dy = charB.dy;
                charB.dy = tempDy;
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
            charA.speed = charA.baseSpeed * HIDDEN_SPEED_MULTIPLIER; // Speed up
        } else {
            charA.speed = charA.baseSpeed; // Slow down
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
    }

    requestAnimationFrame(animate);
}

// This function sets up the characters
function init() {
    containerElement = document.getElementById('character-container');
    cardElement = document.getElementById('main-card'); 

    if (!containerElement || !cardElement) {
        console.error("Floating Chars: Missing container or card element!");
        return;
    }

    const gridCols = 4;
    const gridRows = 3;
    const cellWidth = window.innerWidth / gridCols;
    const cellHeight = window.innerHeight / gridRows;
    let cellIndex = 0; 
    const cardRect = cardElement.getBoundingClientRect();

    for (let i = 1; i <= CHAR_COUNT; i++) {
        const img = document.createElement('img');
        img.src = `/assets/char${i}.png`; // Path to your assets
        img.className = 'floating-char';

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
            el: img,
            x: spawnX, 
            y: spawnY, 
            dx: Math.random() > 0.5 ? 1 : -1,
            dy: Math.random() > 0.5 ? 1 : -1,
            speed: baseSpeed,
            baseSpeed: baseSpeed
        };

        characters.push(charData);
        containerElement.appendChild(img);

        // Add dblclick listener
        img.addEventListener('dblclick', () => {
            if (!img.classList.contains('spinning')) {
                img.classList.add('spinning');
            }
        });

        // Add listener to remove the class when animation finishes
        img.addEventListener('animationend', () => {
            img.classList.remove('spinning');
        });

        // Prevent double-click from selecting text
        img.addEventListener('mousedown', (e) => e.preventDefault());
    }

    animate();
}

// Wait for the page to load before starting
window.addEventListener('load', init);