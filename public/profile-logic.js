
export async function toggleProfileModal(button, repoName, targetId) {
    const existingModal = document.getElementById(`profile-modal-${targetId}`);
    
    if (existingModal) {
        existingModal.remove(); 
        button.textContent = 'Show Profile';
    } else {
        
        button.textContent = 'Loading...';
        button.disabled = true;
        
        // 1. Create the modal structure
        const modal = createModalShell(targetId);
        const modalBody = modal.querySelector('.profile-modal-body');
        document.body.appendChild(modal); 

        
        try {
            const data = await fetchProfileData(repoName);
            renderProfileData(modalBody, data);
            button.textContent = 'Hide Profile';
        } catch (err) {
            renderError(modalBody, err.message);
            button.textContent = 'Show Profile';
        } finally {
            button.disabled = false;
        }
    }
}

// Helper: Fetches data from our new backend endpoint
async function fetchProfileData(repoName) {
    // repoName is 'owner/repo', so we can send it directly
    const res = await fetch(`/api/profile?repo=${repoName}`);
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to load profile');
    }
    return res.json();
}

function renderProfileData(modalBody, data) {
    // This implements the "fall back to login" logic
    const title = data.name ? `<strong>${data.name}</strong>` : `<strong>${data.login}</strong>`;

    let contentHtml = `
        <h3 class="text-xl font-bold text-gray-100 mb-3">
            ${title} 
            <span class="text-sm font-normal text-gray-400">(${data.type})</span>
        </h3>
    `;

    
    if (data.readmeContent) {
        
        contentHtml += `<div class="profile-readme-content">${marked.parse(data.readmeContent)}</div>`;
    } else {
        // --- FALLBACK LOGIC: If no README, show bio/company/location ---
        
        if (data.bio) {
            contentHtml += `<p class="text-gray-300 mb-4">${data.bio}</p>`;
        }
        
        let detailsList = '';
        
        // Show Company only if it exists
        if (data.company) {
            detailsList += `
                <li class="text-sm">
                    <span class="text-gray-400">Company:</span>
                    <span class="text-gray-200 ml-2">${data.company}</span>
                </li>
            `;
        }
        
        // Show Location only if it exists
        if (data.location) {
            detailsList += `
                <li class="text-sm">
                    <span class="text-gray-400">Location:</span>
                    <span class="text-gray-200 ml-2">${data.location}</span>
                </li>
            `;
        }
        
        if (detailsList) {
            contentHtml += `<ul class="space-y-1">${detailsList}</ul>`;
        }

        // If no optional fields exist at all, add a fallback message
        if (!data.bio && !data.company && !data.location) {
            contentHtml += `<p class="text-gray-400 text-sm italic">No public bio, company, or location provided.</p>`;
        }
    }

    modalBody.innerHTML = contentHtml;
}

// Helper: Renders an error message
function renderError(modalBody, errorMessage) {
    modalBody.innerHTML = `<p class="text-red-400">${errorMessage}</p>`;
}

// Helper: Creates the modal "frame"
function createModalShell(targetId) {
    const modalId = `profile-modal-${targetId}`;
    
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'profile-modal-backdrop';
    
    // This stops the modal from closing when clicking *inside* the content
    modal.innerHTML = `
        <div class="profile-modal-content">
            <div class="profile-modal-body">
                <p class="text-gray-400">Loading profile...</p>
            </div>
            <button class="profile-modal-close" data-target-id="${targetId}" aria-label="Close profile">
                &times;
            </button>
        </div>
    `;

    // Add click listener to the backdrop to close the modal
    modal.addEventListener('click', (e) => {
        if (e.target.id === modalId) {
            closeModal(targetId);
        }
    });

    // Add click listener to the close button
    modal.querySelector('.profile-modal-close').addEventListener('click', () => {
        closeModal(targetId);
    });

    return modal;
}

// Helper: Closes the modal and resets the button text
function closeModal(targetId) {
    const modal = document.getElementById(`profile-modal-${targetId}`);
    if (modal) {
        modal.remove();
    }
    
    // Reset the button text
    const button = document.querySelector(`button[data-target-id='${targetId}'].show-profile-btn`);
    if (button) {
        button.textContent = 'Profile';
    }
}