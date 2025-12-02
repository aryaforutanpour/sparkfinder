/* === public/sentry.js === */

export function initSentry() {
    const sentryBtn = document.getElementById('blinkingRedTrigger');
    const sentryText = document.getElementById('sentry-text');

    if (!sentryBtn) return; 

    // 1. Check Memory (Persistence)
    if (localStorage.getItem('blinkingRedArmed') === 'true') {
        armSystem(sentryBtn, sentryText);
    }

    // 2. Event Listener
    sentryBtn.addEventListener('click', () => {
        if (sentryBtn.classList.contains('armed')) {
            openUnsubscribeModal(sentryBtn, sentryText);
        } else {
            openSentryModal(sentryBtn, sentryText);
        }
    });
}

// --- Internal Helper Functions ---

function armSystem(btn, textSpan) {
    btn.classList.add('armed');
    if (textSpan) textSpan.textContent = "SENTRY ACTIVE";
    localStorage.setItem('blinkingRedArmed', 'true');
}

function disarmSystem(btn, textSpan) {
    btn.classList.remove('armed');
    if (textSpan) textSpan.textContent = "Enable Sentry";
    localStorage.removeItem('blinkingRedArmed');
    localStorage.removeItem('sentryEmail'); 
}

// --- MODAL 1: SUBSCRIBE (ARM) ---
function openSentryModal(btn, textSpan) {
    const modal = createModalBase();
    const content = modal.querySelector('.profile-modal-content');
    
    content.innerHTML += `
        <div class="flex flex-col items-center mb-4 relative h-6 w-full">
            <div class="absolute top-0 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
            <div class="absolute top-0 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full"></div>
        </div>
        <h2 class="text-xl font-bold text-red-500 mb-2 tracking-widest uppercase">Blinking Red</h2>
        <p class="text-gray-400 text-sm mb-6">
            Initialize automated sentry. Receive a <span class="text-red-400">System Alert</span> when a repo breaches the <span class="font-bold text-white">Traction Threshold</span>.
        </p>
        <input type="email" id="sentry-email" placeholder="Enter secure email..." 
               class="w-full bg-gray-900 border border-gray-700 text-white rounded p-3 mb-4 focus:border-red-500 focus:outline-none text-center placeholder-gray-600">
        <button id="activate-sentry-btn" class="w-full bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900 font-bold py-2 rounded transition-all uppercase tracking-wider">
            Initialize System
        </button>
        <button class="profile-modal-close" style="top: 10px; right: 15px;">&times;</button>
    `;

    setupModalClose(modal);

    const activateBtn = modal.querySelector('#activate-sentry-btn');
    const input = modal.querySelector('#sentry-email');
    
    activateBtn.onclick = async () => {
        const email = input.value;
        if (!email.includes('@')) { alert("Invalid email."); return; }
        
        activateBtn.textContent = "Establishing Link...";
        activateBtn.disabled = true;
        
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();

            if (res.ok) {
                localStorage.setItem('sentryEmail', email);
                setTimeout(() => { modal.remove(); armSystem(btn, textSpan); }, 500);
            } else {
                alert(data.message);
                activateBtn.textContent = "Initialize System";
                activateBtn.disabled = false;
            }
        } catch (e) { console.error(e); alert("Connection Failed"); activateBtn.disabled = false; }
    };
}

// --- MODAL 2: UNSUBSCRIBE (DISARM) ---
function openUnsubscribeModal(btn, textSpan) {
    const modal = createModalBase();
    const content = modal.querySelector('.profile-modal-content');
    
    const savedEmail = localStorage.getItem('sentryEmail') || '';

    content.innerHTML += `
        <div class="flex flex-col items-center mb-4">
            <svg class="w-8 h-8 text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path></svg>
        </div>
        <h2 class="text-xl font-bold text-gray-300 mb-2 tracking-widest uppercase">Disarm Sentry?</h2>
        <p class="text-gray-400 text-sm mb-6">
            Enter your email to confirm deactivation. You will no longer receive alerts.
        </p>
        <input type="email" id="disarm-email" value="${savedEmail}" placeholder="Confirm email..." 
               class="w-full bg-gray-900 border border-gray-700 text-white rounded p-3 mb-4 focus:border-gray-500 focus:outline-none text-center placeholder-gray-600">
        <button id="deactivate-sentry-btn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 font-bold py-2 rounded transition-all uppercase tracking-wider">
            Confirm Deactivation
        </button>
        <button class="profile-modal-close" style="top: 10px; right: 15px;">&times;</button>
    `;

    setupModalClose(modal);

    const deactivateBtn = modal.querySelector('#deactivate-sentry-btn');
    const input = modal.querySelector('#disarm-email');

    deactivateBtn.onclick = async () => {
        const email = input.value;
        if (!email.includes('@')) { alert("Invalid email."); return; }

        deactivateBtn.textContent = "Severing Link...";
        deactivateBtn.disabled = true;

        try {
            const res = await fetch('/api/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            if (res.ok) {
                setTimeout(() => { modal.remove(); disarmSystem(btn, textSpan); }, 500);
            } else {
                alert("Failed to unsubscribe. Email might not match records.");
                deactivateBtn.textContent = "Confirm Deactivation";
                deactivateBtn.disabled = false;
            }
        } catch (e) { console.error(e); alert("Connection Failed"); deactivateBtn.disabled = false; }
    };
}

// --- Shared Modal Utilities ---
function createModalBase() {
    const modal = document.createElement('div');
    modal.className = 'profile-modal-backdrop'; 
    modal.innerHTML = `
        <div class="profile-modal-content text-center" style="border-color: #374151; box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);"></div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function setupModalClose(modal) {
    const closeBtn = modal.querySelector('.profile-modal-close');
    const removeModal = () => modal.remove();
    closeBtn.onclick = removeModal;
    modal.onclick = (e) => { if (e.target === modal) removeModal(); };
}