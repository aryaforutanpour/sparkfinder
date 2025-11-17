// --- Imports ---
import { toggleChart } from './chart-logic.js';
import { toggleProfileModal } from './profile-logic.js';

/* === app.js === */

// --- 1. CONSTANTS ---
const fetchButton = document.getElementById('fetchButton');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const results = document.getElementById('results');
const resultsTitle = document.getElementById('results-title');
const repoList = document.getElementById('repo-list');
const timeframeGroup = document.getElementById('timeframe-group');
const customBtnTrigger = document.getElementById('custom-btn-trigger');
const customDaysInput = document.getElementById('custom-days-input');
let buzzDataCache = {};

// --- NEW: Bookmark Constants & State ---
const showBookmarksBtn = document.getElementById('showBookmarksBtn');
let bookmarks = [];           // Stores the full repo objects
let currentRepoList = [];   // Stores the complete list from the last fetch
let bookmarksViewActive = false; // Are we currently viewing bookmarks?


// --- 2. EVENT LISTENERS ---

// Handles clicks on 7, 30, 90, All Time
timeframeGroup.addEventListener('click', (e) => {
    const clickedButton = e.target.closest('.timeframe-btn');
    
    if (!clickedButton || clickedButton.id === 'custom-btn-trigger') {
        return;
    }

    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    customDaysInput.classList.add('hidden');
    customBtnTrigger.classList.remove('hidden');
    customBtnTrigger.classList.remove('active-btn'); 
    
    clickedButton.classList.add('active-btn');

    fetchButton.classList.add('btn-pulse-glow');
    fetchButton.classList.remove('hidden');
});

// Handles click on the "Custom" button facade
customBtnTrigger.addEventListener('click', () => {
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    customBtnTrigger.classList.add('hidden');
    customDaysInput.classList.remove('hidden');
    
    customDaysInput.focus();
    customDaysInput.select();
    
    fetchButton.classList.add('btn-pulse-glow');
    fetchButton.classList.remove('hidden');
});

// Handles typing in the custom input box
customDaysInput.addEventListener('input', () => {
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    fetchButton.classList.add('btn-pulse-glow');
    fetchButton.classList.remove('hidden');
});

// Handles click on the main "Find" button
fetchButton.addEventListener('click', () => {
    fetchButton.classList.remove('btn-pulse-glow');
    fetchButton.classList.add('hidden');

    let days;
    const activeBtn = document.querySelector('#timeframe-group .active-btn');

    if (!customDaysInput.classList.contains('hidden')) {
        days = parseInt(customDaysInput.value);
    } else {
        const activeValue = activeBtn ? activeBtn.dataset.value : '30';
        days = (activeValue === 'all') ? 9999 : parseInt(activeValue);
    }

    if (isNaN(days) || days < 1) {
        days = 30;
        if (!customDaysInput.classList.contains('hidden')) {
            customDaysInput.value = "30";
        }
    }
    
    fetchData(days);
});

// --- NEW: Handle click on "Show Bookmarks" button ---
showBookmarksBtn.addEventListener('click', () => {
    // 1. Toggle the view state
    bookmarksViewActive = !bookmarksViewActive;
    
    // 2. Style the button
    showBookmarksBtn.classList.toggle('active', bookmarksViewActive);
    
    // 3. Re-render the list
    renderResults();
});

// Handles clicks inside the results list (Buzz, Velocity, Chart, AND BOOKMARKS)
repoList.addEventListener('click', async (e) => {

    // --- NEW: Handle "Bookmark" clicks (MUST BE FIRST) ---
    const bookmarkBtn = e.target.closest('.bookmark-btn');
    if (bookmarkBtn) {
        const repoId = parseInt(bookmarkBtn.dataset.repoId);
        
        // Find the index of this repo in the bookmarks array
        const bookmarkIndex = bookmarks.findIndex(repo => repo.id === repoId);
        
        if (bookmarkIndex > -1) {
            // It's already bookmarked, so remove it
            bookmarks.splice(bookmarkIndex, 1);
            bookmarkBtn.classList.remove('bookmarked');
        } else {
            // It's not bookmarked, so add it
            // Find the full repo object from *either* list
            const repoToAdd = currentRepoList.find(repo => repo.id === repoId) || bookmarks.find(repo => repo.id === repoId);
            if (repoToAdd) {
                bookmarks.push(repoToAdd);
                bookmarkBtn.classList.add('bookmarked');
            }
        }
        
        // Update the button count
        showBookmarksBtn.textContent = `Show Bookmarks (${bookmarks.length})`;
        
        // If we're in bookmark view, re-render the list to show the removal
        if (bookmarksViewActive) {
            renderResults();
        }
        
        // Return early so we don't trigger other event listeners
        return; 
    }

    // --- Handle "Check Velocity" clicks ---
    if (e.target.classList.contains('calculate-true-velocity-btn')) {
        const button = e.target;
        const repoName = button.dataset.repo;
        const targetId = button.dataset.targetId;
        const deepDiveDays = button.dataset.deepDiveDays;
        
        const container = document.getElementById(`true-velocity-container-${targetId}`);
        container.innerHTML = `<span class="text-sm text-gray-400">Calculating...</span>`;

        try {
            const res = await fetch(`/api/true-velocity?repo=${repoName}&checkDays=${deepDiveDays}`);
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || "Failed to fetch");
            }
            const data = await res.json();
            const dayText = data.daysScanned === 1 ? 'day' : 'days';
            container.innerHTML = `
                <div class="text-right">
                    <div class="text-xs font-bold text-[#7592fd]">${data.starsInPeriod}</div>
                    <div class="text-xs text-gray-400">stars in last ${data.daysScanned} ${dayText}</div>
                </div>
            `;
        } catch (err) {
            console.error('True velocity fetch error:', err);
            container.innerHTML = `<span class="text-sm text-red-400">Error</span>`;
        }
    }

    // --- Handle "Check Buzz" clicks ---
    if (e.target.classList.contains('calculate-buzz-btn')) {
        const button = e.target;
        const repoName = button.dataset.repo;
        const targetId = button.dataset.targetId;
        const timeframe = button.dataset.timeframe;
        const resultsContainer = document.getElementById(`buzz-results-container-${targetId}`);
        
        if (button.dataset.buzzState === 'hidden') {
            button.textContent = 'Checking...';
            button.disabled = true;
            button.dataset.buzzState = 'loading';

            try {
                const res = await fetch(`/api/social-buzz?repo=${repoName}&days=${timeframe}`);
                if (!res.ok) { throw new Error("Failed to fetch buzz"); }
                
                const data = await res.json();
                
                buzzDataCache[targetId] = data; 
                
                const hnCount = data.hackerNewsPosts.length;
                const redditCount = data.redditPosts.length;
                const twitterCount = data.twitterPosts.length;
                const totalMentions = hnCount + redditCount + twitterCount;

                button.textContent = 'Hide';
                button.dataset.buzzState = 'shown';

                if (totalMentions > 0) {
                    
                    let countsTitle = `
                        <h4 class="text-sm font-semibold mb-3 text-gray-100 flex justify-between items-center">
                            <span class="text-gray-100">X/Twitter: <span class="font-bold text-blue-400">${twitterCount}</span></span>
                            <span class="text-gray-100">Reddit: <span class="font-bold text-orange-400">${redditCount}</span></span>
                            <span class="text-gray-100">Hacker News: <span class="font-bold text-[#e9de97]">${hnCount}</span></span>
                        </h4>
                    `;

                    let linksHtml = countsTitle + `<ul class="list-disc list-inside space-y-1 text-xs" id="buzz-links-${targetId}">`;
                    
                    const createLink = (post, platform) => {
                        const color = platform === 'hn' ? 'text-[#e9de97]' : (platform === 'rd' ? 'text-orange-400' : 'text-blue-400');
                        return `
                            <li class="truncate text-gray-400">
                                <span class="font-bold ${color}">(${post.score})</span>
                                <a href="${post.url}" target="_blank" class="${color} hover:underline">
                                    ${post.title}
                                </a>
                            </li>
                        `;
                    };
                    
                    data.hackerNewsPosts.sort((a, b) => b.score - a.score);
                    data.redditPosts.sort((a, b) => b.score - a.score);
                    data.twitterPosts.sort((a, b) => b.score - a.score);
                    
                    linksHtml += data.twitterPosts.slice(0, 10).map(p => createLink(p, 'tw')).join('');
                    
                    linksHtml += `<li id="twitter-insertion-point-${targetId}" style="display: none;"></li>`;
                    
                    linksHtml += data.redditPosts.map(p => createLink(p, 'rd')).join('');
                    linksHtml += data.hackerNewsPosts.map(p => createLink(p, 'hn')).join('');
                    
                    linksHtml += '</ul>';
                    
                    if (data.twitterPosts.length > 10) {
                        linksHtml += `
                            <button 
                                class="show-more-tweets text-xs text-[#c9587c] hover:underline mt-2"
                                data-target-id="${targetId}"
                                data-shown="10">
                                Show More (${10} / ${twitterCount})
                            </button>
                        `;
                    }
                    
                    resultsContainer.innerHTML = linksHtml;

                } else {
                    resultsContainer.innerHTML = `<p class="text-sm text-gray-400 italic">No social mentions found in this timeframe.</p>`;
                }

                resultsContainer.classList.remove('hidden');

            } catch (err) {
                console.error('Social buzz fetch error:', err);
                resultsContainer.innerHTML = `<span class="text-sm text-red-400">Error loading buzz.</span>`;
                resultsContainer.classList.remove('hidden');
                button.textContent = 'Buzz';
                button.dataset.buzzState = 'hidden';
            } finally {
                button.disabled = false;
            }

        } else if (button.dataset.buzzState === 'shown') {
            button.textContent = 'Buzz';
            button.dataset.buzzState = 'hidden';
            resultsContainer.classList.add('hidden');
            resultsContainer.innerHTML = ''; 
            
            delete buzzDataCache[targetId];
        }
    }

    // --- Handle "Show More Tweets" clicks ---
    if (e.target.classList.contains('show-more-tweets')) {
        const button = e.target;
        const targetId = button.dataset.targetId;
        
        const marker = document.getElementById(`twitter-insertion-point-${targetId}`);
        if (!marker) return; 
        
        const data = buzzDataCache[targetId];
        if (!data) return; 

        const shown = parseInt(button.dataset.shown);
        const totalCount = data.twitterPosts.length;
        
        const nextTweets = data.twitterPosts.slice(shown, shown + 10);

        const createLink = (post, platform) => {
            const color = platform === 'hn' ? 'text-[#e9de97]' : (platform === 'rd' ? 'text-orange-400' : 'text-blue-400');
            return `
                <li class="truncate text-gray-400">
                    <span classD="font-bold ${color}">(${post.score})</span>
                    <a href="${post.url}" target="_blank" class="${color} hover:underline">
                        ${post.title}
                    </a>
                </li>
            `;
        };
        
        marker.insertAdjacentHTML('beforebegin', nextTweets.map(p => createLink(p, 'tw')).join(''));
        
        const newShown = shown + nextTweets.length;
        
        if (newShown >= totalCount) {
            button.remove();
        } else {
            button.dataset.shown = newShown;
            button.textContent = `Show More (${newShown} / ${totalCount})`;
        }
    }

    // --- Handle "Show Trajectory" clicks ---
    if (e.target.classList.contains('show-chart-btn')) {
        const button = e.target;
        const repoName = button.dataset.repo;
        const targetId = button.dataset.targetId;
        const timeframe = button.dataset.timeframe;
        const totalStars = parseInt(button.dataset.totalStars);
        const daysOld = parseInt(button.dataset.daysOld);

        toggleChart(button, repoName, targetId, timeframe, totalStars, daysOld);
    }
    
    // --- Handle "Show Profile" clicks ---
    if (e.target.classList.contains('show-profile-btn')) {
        const button = e.target;
        const repoName = button.dataset.repo;
        const targetId = button.dataset.targetId;
        
        toggleProfileModal(button, repoName, targetId);
    }
});

// --- 3. TYPEWRITER EFFECT ---
const textToType = "// SPARK FINDER"; 
let typeWriterElement; 
let charIndex = 0;

function typeWriter() {
    if (charIndex < textToType.length) {
        if (typeWriterElement) {
            typeWriterElement.textContent += textToType.charAt(charIndex);
        }
        charIndex++;
        setTimeout(typeWriter, 120); // Typing speed
    } else {
        const intro = document.getElementById('intro-content');
        if (intro) {
            intro.classList.remove('opacity-0');
            intro.classList.add('opacity-100');
        }
    }
}

window.addEventListener('load', () => {
    typeWriterElement = document.getElementById('typewriter-text');
    
    if (typeWriterElement) {
        typeWriterElement.textContent = ""; 
        setTimeout(typeWriter, 300); // 300ms initial delay
    } else {
        console.error("Spark-Finder: Typewriter element not found!");
    }
});

// --- 4. CORE FUNCTIONS ---

async function fetchData(days) {
    showLoading(true);
    showError(null);
    results.classList.add('hidden');
    repoList.innerHTML = '';
    
    // --- NEW: Reset bookmark view on new fetch ---
    bookmarksViewActive = false;
    showBookmarksBtn.classList.remove('active');
    // ---

    try {
        const res = await fetch(`/api/search?days=${days}`);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(`API Search error: ${errorData.message}`);
        }
        
        // --- UPDATED: Save to global list ---
        currentRepoList = await res.json(); 
        
        if (!currentRepoList || currentRepoList.length === 0) {
            showError("No repositories found matching these criteria.");
            return;
        }
        
        // --- UPDATED: Call new render function ---
        renderResults(); 

    } catch (err) {
        console.error('Fetch Error:', err);
        showError(err.message);
    } finally {
        showLoading(false);
    }
}

// --- NEW: This function decides WHAT to display ---
function renderResults() {
    if (bookmarksViewActive) {
        resultsTitle.textContent = `Bookmarked Repos (${bookmarks.length})`;
        if (bookmarks.length === 0) {
            showError("You haven't bookmarked any repos yet.");
            repoList.innerHTML = ''; // Clear list
        } else {
            showError(null); // Clear error
            displayResults(bookmarks);
        }
    } else {
        resultsTitle.textContent = `Top Repos (Sorted by Avg. Velocity)`;
        showError(null); // Clear error
        displayResults(currentRepoList);
    }
    
    // Make sure the results section is visible
    if ((bookmarksViewActive && bookmarks.length > 0) || (!bookmarksViewActive && currentRepoList.length > 0)) {
        results.classList.remove('hidden');
    } else {
        // This handles showing the "no bookmarks" error
        results.classList.add('hidden');
    }
}


// --- UPDATED: This function just renders ANY list it's given ---
function displayResults(repos) {
    // --- UPDATED: Removed resultsTitle.textContent from here ---
    repoList.innerHTML = ''; // Clear the list first

    let selectedTimeframe;
    let deepDiveDays;
    let deepDiveText;
    const activeBtn = document.querySelector('#timeframe-group .active-btn');
    const isCustom = !customDaysInput.classList.contains('hidden');

    if (isCustom) {
        selectedTimeframe = parseInt(customDaysInput.value) || 1;
        if (selectedTimeframe === 1) {
            deepDiveDays = 0.5;
            deepDiveText = "12-Hour";
        } else {
            deepDiveDays = Math.round(selectedTimeframe / 4);
            if (deepDiveDays < 1) { deepDiveDays = 1; } 
            deepDiveText = `${deepDiveDays}-Day`;
        }
    } else {
        const activeValue = activeBtn ? activeBtn.dataset.value : '30';
        selectedTimeframe = (activeValue === 'all') ? 9999 : parseInt(activeValue);
        if (selectedTimeframe === 7) {
            deepDiveDays = 1;
            deepDiveText = "24-Hour";
        } else {
            deepDiveDays = 7;
            deepDiveText = "7-Day";
        }
    }
    
    repos.forEach(repo => {
        const li = document.createElement('li');
        li.className = 'p-4 border border-gray-700 rounded-lg';
        const velocity = repo.velocityScore.toFixed(1);
        
        // --- NEW: Check if this repo is bookmarked ---
        const isBookmarked = bookmarks.some(b => b.id === repo.id);
        
        li.innerHTML = `
            <!-- --- UPDATED: Added items-start --- -->
            <div class="flex justify-between items-start">
                <!-- --- UPDATED: Added wrapper div --- -->
                <div class="flex items-center space-x-2">
                    <!-- --- NEW: Bookmark Button --- -->
                    <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" data-repo-id="${repo.id}">
                        <!-- Empty Icon -->
                        <svg class="icon-empty w-5 h-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 11.186 0Z" />
                        </svg>
                        <!-- Filled Icon -->
                        <svg class="icon-filled w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                          <path fill-rule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21L12 17.25 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clip-rule="evenodd" />
                        </svg>
                    </button>
                    
                    <a href="${repo.html_url}" target="_blank" class="text-xl font-bold text-[#e9de97] hover:text-[#d9ce8a] hover:underline">${repo.full_name}</a>
                </div>
                <div class="text-right">
                    <div class="text-xl font-bold text-[#7592fd]">${velocity}</div>
                    <div class="text-xs text-gray-400">avg. stars / day</div>
                </div>
            </div>
            <p class="text-sm text-gray-300 mt-2">${repo.description || 'No description provided.'}</p>
            
            <div class="flex items-center justify-between mt-3">
                
                <div class="flex items-center space-x-4 text-xs text-gray-200">
                    <div class="flex items-center">
                        <svg class="w-4 h-4 text-[#e9de97] mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.54-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z"></path></svg>
                        <span class="font-medium">${repo.stargazers_count.toLocaleString()}</span>
                        <span class="text-gray-400 ml-1">stars</span>
                    </div>
                    <span class="text-gray-600">|</span>
                    <div class="flex items-center">
                        <svg class="w-4 h-4 text-gray-400 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span class="text-gray-400">${repo.daysOld} ${repo.daysOld === 1 ? 'day' : 'days'}</span>
                    </div>
                </div>

                <div class="flex items-center space-x-2">
                    <div id="social-buzz-container-${repo.id}">
                        <button 
                            data-repo="${repo.full_name}" 
                            data-timeframe="${selectedTimeframe}"
                            data-target-id="${repo.id}"
                            data-buzz-state="hidden" 
                            class="calculate-buzz-btn text-xs text-[#c9587c] hover:text-[#e39ab0] font-medium py-1 px-2 rounded-lg hover:bg-gray-700">
                            Buzz
                        </button>
                    </div>
                    
                    <div id="profile-btn-container-${repo.id}" class="min-w-[100px] flex justify-center">
                        <button 
                            data-repo="${repo.full_name}" 
                            data-target-id="${repo.id}"
                            class="show-profile-btn text-xs text-[#c9587c] hover:text-[#e39ab0] font-medium py-1 px-2 rounded-lg hover:bg-gray-700">
                            Profile
                        </button>
                    </div>

                    <div id="chart-btn-container-${repo.id}" class="min-w-[100px] flex justify-center">
                        <button 
                            data-repo="${repo.full_name}" 
                            data-target-id="${repo.id}"
                            data-timeframe="${selectedTimeframe}"
                            data-total-stars="${repo.stargazers_count}"
                            data-days-old="${repo.daysOld}"
                            class="show-chart-btn text-xs text-[#c9587c] hover:text-[#e39ab0] font-medium py-1 px-2 rounded-lg hover:bg-gray-700">
                            Trajectory
                        </button>
                    </div>

                    <div id="true-velocity-container-${repo.id}" class="min-w-[100px] flex justify-center">
                        <button 
                            data-repo="${repo.full_name}" 
                            data-target-id="${repo.id}"
                            data-deep-dive-days="${deepDiveDays}"
                            class="calculate-true-velocity-btn text-xs text-[#c9587c] hover:text-[#e39ab0] font-medium py-1 px-2 rounded-lg hover:bg-gray-700">
                            ${deepDiveText} Velocity
                        </button>
                    </div>
                </div>
            </div>
            
            <div id="buzz-results-container-${repo.id}" class="mt-3 pt-3 border-t border-gray-700 hidden">
                </div>

            <div id="chart-container-${repo.id}" class="hidden mt-3 pt-3 border-t border-gray-700">
                <canvas id="chart-${repo.id}"></canvas>
            </div>
        `;
        repoList.appendChild(li);
    });

    // results.classList.remove('hidden'); // <-- This is handled by renderResults()
}

// --- 5. HELPER FUNCTIONS ---

function showLoading(isLoading) {
    loading.classList.toggle('hidden', !isLoading);
}

function showError(message) {
    if (message) {
        error.textContent = message;
        error.classList.remove('hidden');
    } else {
        error.classList.add('hidden');
    }
}