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

// --- Bookmark & Filter Constants & State ---
const showBookmarksBtn = document.getElementById('showBookmarksBtn');
const ownerFilterGroup = document.getElementById('owner-filter-group'); 
let bookmarks = [];           
let currentRepoList = [];   
let bookmarksViewActive = false; 
let currentOwnerFilter = 'all'; 

// --- Timeframe State ---
let lastSearchedTimeframe = null; 


// --- 2. EVENT LISTENERS ---

// --- HELPER FUNCTION ---
function checkTimeframeChanged() {
    let selectedDays;
    const activeBtn = document.querySelector('#timeframe-group .active-btn');

    if (!customDaysInput.classList.contains('hidden')) {
        selectedDays = parseInt(customDaysInput.value);
    } else {
        const activeValue = activeBtn ? activeBtn.dataset.value : '30';
        selectedDays = (activeValue === 'all') ? 9999 : parseInt(activeValue);
    }

    if (isNaN(selectedDays) || selectedDays < 1) {
        selectedDays = 30; 
    }

    if (selectedDays === lastSearchedTimeframe) {
        fetchButton.classList.add('hidden');
        fetchButton.classList.remove('btn-pulse-glow');
    } else {
        fetchButton.classList.remove('hidden');
        fetchButton.classList.add('btn-pulse-glow');
    }
}

// --- Handles clicks on 7, 30, 90, All Time ---
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

    checkTimeframeChanged();
});

// --- Handles click on the "Custom" button facade ---
customBtnTrigger.addEventListener('click', () => {
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    customBtnTrigger.classList.add('hidden');
    customDaysInput.classList.remove('hidden');
    
    customDaysInput.focus();
    customDaysInput.select();
    
    checkTimeframeChanged();
});

// --- Handles typing in the custom input box ---
customDaysInput.addEventListener('input', () => {
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    checkTimeframeChanged();
});

// --- Handles click on the main "Find" button ---
fetchButton.addEventListener('click', () => {
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

// --- Handle click on "Show Bookmarks" button ---
showBookmarksBtn.addEventListener('click', () => {
    bookmarksViewActive = !bookmarksViewActive;
    showBookmarksBtn.classList.toggle('active', bookmarksViewActive);
    renderResults();
});

// --- Handle click on "Owner Filter" group ---
ownerFilterGroup.addEventListener('click', (e) => {
    const clickedButton = e.target.closest('.bookmark-toggle');
    if (!clickedButton) return;

    currentOwnerFilter = clickedButton.dataset.filter;

    ownerFilterGroup.querySelectorAll('.bookmark-toggle').forEach(btn => {
        btn.classList.remove('active');
    });
    clickedButton.classList.add('active');
    
    renderResults();
});

// --- Handles clicks inside the results list ---
repoList.addEventListener('click', async (e) => {

    // --- Handle "Bookmark" clicks (MUST BE FIRST) ---
    const bookmarkBtn = e.target.closest('.bookmark-btn');
    if (bookmarkBtn) {
        const repoId = parseInt(bookmarkBtn.dataset.repoId);
        const bookmarkIndex = bookmarks.findIndex(repo => repo.id === repoId);
        
        if (bookmarkIndex > -1) {
            bookmarks.splice(bookmarkIndex, 1);
            bookmarkBtn.classList.remove('bookmarked');
        } else {
            const repoToAdd = currentRepoList.find(repo => repo.id === repoId) || bookmarks.find(repo => repo.id === repoId);
            if (repoToAdd) {
                bookmarks.push(repoToAdd);
                bookmarkBtn.classList.add('bookmarked');
            }
        }
        
        showBookmarksBtn.textContent = `Show Bookmarks (${bookmarks.length})`;
        
        if (bookmarksViewActive || currentOwnerFilter !== 'all') {
            renderResults();
        }
        return; 
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
    
    checkTimeframeChanged();
});

// --- 4. CORE FUNCTIONS ---

async function fetchData(days) {
    lastSearchedTimeframe = days;
    fetchButton.classList.add('hidden');
    fetchButton.classList.remove('btn-pulse-glow');

    showLoading(true);
    showError(null);
    results.classList.add('hidden');
    repoList.innerHTML = '';
    
    bookmarksViewActive = false;
    showBookmarksBtn.classList.remove('active');

    try {
        const res = await fetch(`/api/search?days=${days}`);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(`API Search error: ${errorData.message}`);
        }
        
        currentRepoList = await res.json(); 
        
        if (!currentRepoList || currentRepoList.length === 0) {
            showError("No repositories found matching these criteria.");
            return;
        }
        
        renderResults(); 

    } catch (err) {
        console.error('Fetch Error:', err);
        showError(err.message);
    } finally {
        showLoading(false);
    }
}


function renderResults() {
    // 1. Determine the source list
    const sourceList = bookmarksViewActive ? bookmarks : currentRepoList;
    
    // 2. Apply the owner filter
    let filteredList;
    if (currentOwnerFilter === 'all') {
        filteredList = sourceList;
    } else {
        filteredList = sourceList.filter(repo => repo.owner.type === currentOwnerFilter);
    }

    // 3. Update titles and render
    if (bookmarksViewActive) {
        const filterText = currentOwnerFilter === 'all' ? '' : ` (${currentOwnerFilter}s)`;
        resultsTitle.textContent = `Bookmarked Repos${filterText} (${filteredList.length} / ${bookmarks.length})`;
    } else {
        const filterText = currentOwnerFilter === 'all' ? '' : ` (${currentOwnerFilter}s)`;
        resultsTitle.textContent = `Top Repos${filterText} (Sorted by Avg. Velocity)`;
    }

    // 4. Handle empty states
    if (filteredList.length === 0) {
        repoList.innerHTML = ''; 
        
        if (bookmarksViewActive) {
            if (bookmarks.length === 0) {
                showError("You haven't bookmarked any repos yet.");
            } else {
                showError(`No bookmarks found matching the "${currentOwnerFilter}" filter.`);
            }
        } else {
            if (currentRepoList.length === 0) {
                showError(null); 
            } else {
                showError(`No repos found matching the "${currentOwnerFilter}" filter.`);
            }
        }
        
    } else {
        showError(null); 
        displayResults(filteredList); 
    }
    
    // 5. Manage visibility
    if (filteredList.length > 0) {
        results.classList.remove('hidden');
    } else {
        if (showError.textContent) { 
             results.classList.add('hidden');
        }
    }
}


//
// =================================================================
// === THIS IS THE ONLY FUNCTION THAT HAS CHANGED                ===
// =================================================================
//
function displayResults(repos) {
    repoList.innerHTML = '';

    let selectedTimeframe;
    const activeBtn = document.querySelector('#timeframe-group .active-btn');
    const isCustom = !customDaysInput.classList.contains('hidden');

    if (isCustom) {
        selectedTimeframe = parseInt(customDaysInput.value) || 1;
    } else {
        const activeValue = activeBtn ? activeBtn.dataset.value : '30';
        selectedTimeframe = (activeValue === 'all') ? 9999 : parseInt(activeValue);
    }
    
    repos.forEach(repo => {
        const li = document.createElement('li');
        li.className = 'p-4 border border-gray-700 rounded-lg';
        const velocity = repo.velocityScore.toFixed(1);
        
        const isBookmarked = bookmarks.some(b => b.id === repo.id);
        
        const ownerTypeBadge = repo.owner.type === 'Organization' 
            ? `<span class="text-xs font-semibold bg-blue-900 text-blue-300 px-2 py-0.5 rounded ml-2">Org</span>`
            : '';
        
        // --- THIS IS THE MODIFIED HTML ---
        li.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex items-center space-x-2">
                    <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" data-repo-id="${repo.id}">
                        <svg class="icon-empty w-5 h-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 11.186 0Z" />
                        </svg>
                        <svg class="icon-filled w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                          <path fill-rule="evenodd" d="M6.32 2.577a48.255 48.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21L12 17.25 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clip-rule="evenodd" />
                        </svg>
                    </button>
                    
                    <a href="${repo.html_url}" target="_blank" class="text-xl font-bold text-[#e9de97] hover:text-[#d9ce8a] hover:underline">${repo.full_name}</a>
                    ${ownerTypeBadge}
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
    <img src="/assets/git-fork.svg" alt="Fork icon" class="w-4 h-4 mr-1">
    <span class="font-medium">${repo.forks_count.toLocaleString()}</span>
    <span class="text-gray-400 ml-1">forks</span>
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