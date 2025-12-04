// --- Imports ---
import { toggleChart } from './chart-logic.js';
import { toggleProfileModal } from './profile-logic.js';
import { initSentry } from './sentry.js';

/* === app.js === */

// --- 1. CONSTANTS ---
const fetchButton = document.getElementById('fetchButton');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const results = document.getElementById('results');
const resultsTitle = document.getElementById('results-title');
const repoList = document.getElementById('repo-list');
const timeframeGroup = document.getElementById('timeframe-group');
const customBtnTrigger = document.getElementById('custom-btn-trigger');
const customDaysInput = document.getElementById('custom-days-input');
let buzzDataCache = {};

// --- Bookmark & Filter Constants ---
const showBookmarksBtn = document.getElementById('showBookmarksBtn');
const bookmarkCountSpan = document.getElementById('bookmark-count'); 
const ownerFilterGroup = document.getElementById('owner-filter-group'); 
const topicFilterGroup = document.getElementById('topic-filter-group'); 
const sortContainer = document.getElementById('sort-container'); 

// --- Laude List Constants ---
const laudeListBtn = document.getElementById('laudeListBtn');
const standardFiltersContainer = document.getElementById('standard-filters-container');
let isLaudeMode = false;

// --- Variables ---
let bookmarks = [];           
let currentRepoList = [];   
let bookmarksViewActive = false; 
let searchCache = {};          
let currentSort = 'velocity';  
let currentOwnerFilter = 'all'; 
let currentTopicFilter = 'all'; 
let currentPage = 1;
let lastSearchedTimeframe = null; 


// --- 2. EVENT LISTENERS ---

// --- NEW: LAUDE LIST TOGGLE (God Mode) ---
if (laudeListBtn) {
    laudeListBtn.addEventListener('click', async () => {
        isLaudeMode = !isLaudeMode; // Toggle State

        if (isLaudeMode) {
            // --- TURN ON LAUDE MODE ---
            laudeListBtn.classList.add('active');
            standardFiltersContainer.classList.add('filters-disabled');
            
            // Hide standard controls
            if (sortContainer) sortContainer.classList.add('hidden');
            loadMoreBtn.classList.add('hidden');
            
            // Update Title
            resultsTitle.innerHTML = `<span class="text-[#e9de97]">✦ Laude List</span> (Active Researchers)`;
            repoList.innerHTML = '';
            showLoading(true);
            results.classList.remove('hidden'); 

            try {
                const res = await fetch('/api/laude-list');
                if (!res.ok) throw new Error("Failed to fetch Laude List");
                
                const vipRepos = await res.json();
                currentRepoList = vipRepos; 
                
                showLoading(false);
                
                if (vipRepos.length === 0) {
                    showError("No new activity from Laude VIPs in the last 14 days.");
                } else {
                    showError(null);
                    displayResults(vipRepos);
                }
            } catch (err) {
                console.error(err);
                showError("System Error: Could not retrieve VIP data.");
                showLoading(false);
            }

        } else {
            // --- TURN OFF LAUDE MODE (Manual Reset) ---
            laudeListBtn.classList.remove('active');
            standardFiltersContainer.classList.remove('filters-disabled');
            
            // Re-enable UI elements but HIDE them until a search happens
            if (sortContainer) sortContainer.classList.remove('hidden');
            loadMoreBtn.classList.add('hidden');
            
            // --- UPDATED LOGIC: Clear screen and wait for user ---
            results.classList.add('hidden');  // Hide results box
            repoList.innerHTML = '';          // Wipe list
            currentRepoList = [];             // Reset memory
            resultsTitle.textContent = "Top Repos"; // Reset title
            
            // NOTE: We do NOT call fetchButton.click() here anymore.
            // The app now waits for the user to select a timeframe.
        }
    });
}

// --- HELPER: Check Timeframe (Only for Custom Input & Load) ---
function checkTimeframeChanged() {
    let selectedDays;
    const activeBtn = document.querySelector('#timeframe-group .active-btn');

    if (!customDaysInput.classList.contains('hidden')) {
        selectedDays = parseInt(customDaysInput.value);
    } else {
        const activeValue = activeBtn ? activeBtn.dataset.value : '30';
        selectedDays = (activeValue === 'all') ? 9999 : parseInt(activeValue);
    }

    if (isNaN(selectedDays) || selectedDays < 1) { selectedDays = 30; }

    // Only show the button if the days have changed from the last search
    if (selectedDays === lastSearchedTimeframe) {
        fetchButton.classList.add('hidden');
        fetchButton.classList.remove('btn-pulse-glow');
    } else {
        fetchButton.classList.remove('hidden');
        fetchButton.classList.add('btn-pulse-glow');
    }
}

// --- Timeframe Group Clicks ---
timeframeGroup.addEventListener('click', (e) => {
    if (isLaudeMode) return; // Ignore clicks if disabled

    const clickedButton = e.target.closest('.timeframe-btn');
    if (!clickedButton || clickedButton.id === 'custom-btn-trigger') return;

    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => btn.classList.remove('active-btn'));
    
    customDaysInput.classList.add('hidden');
    customBtnTrigger.classList.remove('hidden');
    customBtnTrigger.classList.remove('active-btn'); 
    clickedButton.classList.add('active-btn');
    
    fetchButton.classList.add('hidden'); 
    fetchButton.classList.remove('btn-pulse-glow');

    let days = clickedButton.dataset.value === 'all' ? 9999 : parseInt(clickedButton.dataset.value);
    currentPage = 1;
    fetchData(days, currentPage, false); 
});

// --- Custom Button Clicks ---
customBtnTrigger.addEventListener('click', () => {
    if (isLaudeMode) return;
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => btn.classList.remove('active-btn'));
    customBtnTrigger.classList.add('hidden');
    customDaysInput.classList.remove('hidden');
    customDaysInput.focus();
    customDaysInput.select();
    checkTimeframeChanged();
});

customDaysInput.addEventListener('input', () => {
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => btn.classList.remove('active-btn'));
    checkTimeframeChanged(); 
});

// --- Main Find Button ---
fetchButton.addEventListener('click', () => {
    if (isLaudeMode) return;
    
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
        if (!customDaysInput.classList.contains('hidden')) customDaysInput.value = "30";
    }
    
    currentPage = 1;
    fetchData(days, currentPage, true); 
});

// --- Load More Button ---
loadMoreBtn.addEventListener('click', () => {
    if (!lastSearchedTimeframe) return;
    loadMoreBtn.textContent = "Loading...";
    loadMoreBtn.disabled = true;
    currentPage++;
    fetchData(lastSearchedTimeframe, currentPage, true);
});

// --- Show Bookmarks Toggle ---
showBookmarksBtn.addEventListener('click', () => {
    bookmarksViewActive = !bookmarksViewActive;
    showBookmarksBtn.classList.toggle('active', bookmarksViewActive);
    
    if (bookmarksViewActive) {
        loadMoreBtn.classList.add('hidden');
        if (sortContainer) sortContainer.classList.add('hidden');
    } else {
        if (currentRepoList.length > 0 && !isLaudeMode) loadMoreBtn.classList.remove('hidden');
        if (sortContainer && !isLaudeMode) sortContainer.classList.remove('hidden');
    }
    
    renderResults();
});

// --- Owner Filter ---
ownerFilterGroup.addEventListener('click', (e) => {
    if (isLaudeMode) return; // Disabled in Laude Mode

    const clickedButton = e.target.closest('.bookmark-toggle');
    if (!clickedButton) return;

    ownerFilterGroup.querySelectorAll('.bookmark-toggle').forEach(btn => btn.classList.remove('active'));
    clickedButton.classList.add('active');
    
    currentOwnerFilter = clickedButton.dataset.filter;
    renderResults();
});

// --- Topic Filter ---
topicFilterGroup.addEventListener('click', (e) => {
    if (isLaudeMode) return;

    const clickedButton = e.target.closest('.topic-toggle');
    if (!clickedButton) return;
    
    const selectedTopic = clickedButton.dataset.topic;
    currentTopicFilter = selectedTopic;
    
    topicFilterGroup.querySelectorAll('.topic-toggle').forEach(btn => btn.classList.remove('active'));
    clickedButton.classList.add('active');
    renderResults();
});

// --- Sort Filter ---
if (sortContainer) {
    sortContainer.addEventListener('click', (e) => {
        if (isLaudeMode) return;

        const btn = e.target.closest('.sort-btn');
        if (!btn) return;
        currentSort = btn.dataset.sort;
        sortContainer.querySelectorAll('.sort-btn').forEach(b => {
            b.classList.remove('text-[#e9de97]', 'font-bold');
            b.classList.add('text-gray-400', 'font-medium');
        });
        btn.classList.remove('text-gray-400', 'font-medium');
        btn.classList.add('text-[#e9de97]', 'font-bold');
        renderResults();
    });
}

// --- List Item Clicks ---
repoList.addEventListener('click', async (e) => {
    // Bookmark
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
        if (bookmarkCountSpan) bookmarkCountSpan.textContent = bookmarks.length;
        if (bookmarksViewActive || (!isLaudeMode && (currentOwnerFilter !== 'all' || currentTopicFilter !== 'all'))) {
            renderResults();
        }
        return; 
    }

    // Buzz
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
                if (!res.ok) throw new Error("Failed to fetch buzz");
                const data = await res.json();
                buzzDataCache[targetId] = data; 
                const hnCount = data.hackerNewsPosts.length;
                const redditCount = data.redditPosts.length;
                const twitterCount = data.twitterPosts.length;
                const totalMentions = hnCount + redditCount + twitterCount;
                button.textContent = 'Hide';
                button.dataset.buzzState = 'shown';
                let contentHtml = '';
                if (totalMentions > 0) {
                    if (data.summary) {
                        contentHtml += `<div id="ai-summary-${targetId}" class="mb-4 p-3 bg-gray-800/50 border-l-4 border-[#c9587c] rounded-r-md"><div class="flex items-center mb-1"><svg class="w-4 h-4 text-[#c9587c] mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg><span class="text-xs font-bold text-[#c9587c] uppercase tracking-wider">Buzz Summary</span></div><p class="text-sm text-gray-300 italic leading-relaxed">"${data.summary}"</p></div>`;
                    }
                    const createLink = (post, platform) => {
                        const color = platform === 'hn' ? 'text-[#e9de97]' : (platform === 'rd' ? 'text-orange-400' : 'text-blue-400');
                        return `<li class="truncate text-gray-400"><span class="font-bold ${color}">(${post.score})</span> <a href="${post.url}" target="_blank" class="${color} hover:underline">${post.title}</a></li>`;
                    };
                    data.hackerNewsPosts.sort((a, b) => b.score - a.score);
                    data.redditPosts.sort((a, b) => b.score - a.score);
                    data.twitterPosts.sort((a, b) => b.score - a.score);
                    contentHtml += `<div class="mb-4"><h5 class="text-sm font-bold text-gray-200 mb-2">X/Twitter: <span class="text-blue-400">${twitterCount}</span></h5>`;
                    if (twitterCount > 0) {
                        contentHtml += `<ul class="list-disc list-inside space-y-1 text-xs">` + data.twitterPosts.slice(0, 10).map(p => createLink(p, 'tw')).join('') + `<li id="twitter-insertion-point-${targetId}" style="display: none;"></li></ul>`;
                        if (data.twitterPosts.length > 10) { contentHtml += `<button class="show-more-tweets text-xs text-[#c9587c] hover:underline mt-1 ml-2" data-target-id="${targetId}" data-shown="10">Show More (${10} / ${twitterCount})</button>`; }
                    } else { contentHtml += `<p class="text-xs text-gray-500 italic ml-2">No mentions found.</p>`; }
                    contentHtml += `</div><div class="mb-4"><h5 class="text-sm font-bold text-gray-200 mb-2">Reddit: <span class="text-orange-400">${redditCount}</span></h5>`;
                    if (redditCount > 0) {
                        contentHtml += `<ul class="list-disc list-inside space-y-1 text-xs">` + data.redditPosts.map(p => createLink(p, 'rd')).join('') + `</ul>`;
                    } else { contentHtml += `<p class="text-xs text-gray-500 italic ml-2">No mentions found.</p>`; }
                    contentHtml += `</div><div class="mb-2"><h5 class="text-sm font-bold text-gray-200 mb-2">Hacker News: <span class="text-[#e9de97]">${hnCount}</span></h5>`;
                    if (hnCount > 0) {
                        contentHtml += `<ul class="list-disc list-inside space-y-1 text-xs">` + data.hackerNewsPosts.map(p => createLink(p, 'hn')).join('') + `</ul>`;
                    } else { contentHtml += `<p class="text-xs text-gray-500 italic ml-2">No mentions found.</p>`; }
                    contentHtml += `</div>`;
                } else {
                    contentHtml = `<p class="text-sm text-gray-400 italic">No social mentions found in this timeframe.</p>`;
                }
                resultsContainer.innerHTML = contentHtml;
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
            return `<li class="truncate text-gray-400"><span class="font-bold ${color}">(${post.score})</span> <a href="${post.url}" target="_blank" class="${color} hover:underline">${post.title}</a></li>`;
         };
         marker.insertAdjacentHTML('beforebegin', nextTweets.map(p => createLink(p, 'tw')).join(''));
         const newShown = shown + nextTweets.length;
         if (newShown >= totalCount) { button.remove(); } else { button.dataset.shown = newShown; button.textContent = `Show More (${newShown} / ${totalCount})`; }
    }

    if (e.target.classList.contains('show-chart-btn')) {
        const button = e.target;
        toggleChart(button, button.dataset.repo, button.dataset.targetId, button.dataset.timeframe, parseInt(button.dataset.totalStars), parseInt(button.dataset.daysOld));
    }
    
    if (e.target.classList.contains('show-profile-btn')) {
        toggleProfileModal(e.target, e.target.dataset.repo, e.target.dataset.targetId);
    }
});

// --- 3. TYPEWRITER EFFECT ---
const textToType = "// SPARK-FINDER"; 
let typeWriterElement; 
let charIndex = 0;
function typeWriter() {
    if (charIndex < textToType.length) {
        if (typeWriterElement) { typeWriterElement.textContent += textToType.charAt(charIndex); }
        charIndex++;
        setTimeout(typeWriter, 120);
    } else {
        const intro = document.getElementById('intro-content');
        if (intro) { intro.classList.remove('opacity-0'); intro.classList.add('opacity-100'); }
    }
}
window.addEventListener('load', () => {
    typeWriterElement = document.getElementById('typewriter-text');
    if (typeWriterElement) { typeWriterElement.textContent = ""; setTimeout(typeWriter, 300); }
    checkTimeframeChanged();
    
    // --- Initialize the Sentry System ---
    initSentry(); 
});


// --- 4. CORE FUNCTIONS ---

async function fetchData(days, page = 1, forceRefresh = false) {
    lastSearchedTimeframe = days;
    const cacheKey = `${days}-${page}`;

    if (!forceRefresh && searchCache[cacheKey]) {
        console.log(`[Frontend] Cache hit for ${cacheKey}`);
        const cachedRepos = searchCache[cacheKey];
        if (page === 1) { currentRepoList = cachedRepos; } 
        else { currentRepoList = [...currentRepoList, ...cachedRepos]; }
        handleDataSuccess(cachedRepos, page);
        return; 
    }
    
    if (page === 1) {
        fetchButton.classList.add('hidden');
        fetchButton.classList.remove('btn-pulse-glow');
        results.classList.add('hidden');
        repoList.innerHTML = '';
        loadMoreBtn.classList.add('hidden'); 
        showLoading(true);
    } 

    showError(null);
    bookmarksViewActive = false;
    showBookmarksBtn.classList.remove('active');

    try {
        const res = await fetch(`/api/search?days=${days}&page=${page}`);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(`API Search error: ${errorData.message}`);
        }
        
        const newRepos = await res.json(); 
        searchCache[cacheKey] = newRepos;
        
        if (page === 1) {
            currentRepoList = newRepos;
        } else {
            currentRepoList = [...currentRepoList, ...newRepos];
        }
        
        handleDataSuccess(newRepos, page);

    } catch (err) {
        console.error('Fetch Error:', err);
        showError(err.message);
    } finally {
        showLoading(false);
        if (page > 1) {
            loadMoreBtn.textContent = "Load Next Page";
            loadMoreBtn.disabled = false;
        }
    }
}

function handleDataSuccess(newRepos, page) {
    if (currentRepoList.length === 0) {
        showError("No repositories found matching these criteria.");
        return;
    }
    if (newRepos.length > 0) {
         loadMoreBtn.classList.remove('hidden');
         loadMoreBtn.textContent = "Load Next Page";
         loadMoreBtn.disabled = false;
    } else {
         loadMoreBtn.classList.add('hidden');
    }
    renderResults(); 
}

function applySort(list) {
    // In Laude Mode, backend sorts by Recent or Stars, so frontend sort might be redundant but okay
    const sorted = [...list]; 
    if (currentSort === 'velocity') return sorted.sort((a, b) => b.velocityScore - a.velocityScore);
    if (currentSort === 'forks') return sorted.sort((a, b) => b.forks_count - a.forks_count);
    if (currentSort === 'stars') return sorted.sort((a, b) => b.stargazers_count - a.stargazers_count);
    return sorted;
}

function renderResults() {
    const sourceList = bookmarksViewActive ? bookmarks : currentRepoList;
    let filteredList = sourceList.filter(repo => {
        // If in Laude Mode, ignore standard filters unless it's bookmarks view
        if (isLaudeMode && !bookmarksViewActive) return true;

        const matchesOwner = (currentOwnerFilter === 'all') || (repo.owner.type === currentOwnerFilter);
        const matchesTopic = (currentTopicFilter === 'all') || (repo.category === currentTopicFilter);
        return matchesOwner && matchesTopic;
    });

    if (!isLaudeMode) filteredList = applySort(filteredList);

    if (bookmarksViewActive) {
        resultsTitle.textContent = `Bookmarked Repos (${filteredList.length})`;
        loadMoreBtn.classList.add('hidden');
        if (sortContainer) sortContainer.classList.add('hidden');
    } else {
        if (!isLaudeMode) resultsTitle.textContent = `Top Repos`;
        
        if (sortContainer && !isLaudeMode) sortContainer.classList.remove('hidden');
        if (currentRepoList.length > 0 && !isLaudeMode) {
             loadMoreBtn.classList.remove('hidden');
        } else {
            loadMoreBtn.classList.add('hidden');
        }
    }

    if (filteredList.length === 0) {
        repoList.innerHTML = ''; 
        if (bookmarksViewActive) {
             if (bookmarks.length === 0) { showError("You haven't bookmarked any repos yet."); }
             else { showError(`No bookmarks found matching these filters.`); }
        } else {
             if (currentRepoList.length === 0) {
                 showError(null);
                 results.classList.add('hidden');
             } else {
                 showError("No repositories found matching these filters.");
                 results.classList.remove('hidden');
             }
        }
    } else {
        showError(null); 
        displayResults(filteredList); 
        results.classList.remove('hidden');
    }
}

function displayResults(repos) {
    repoList.innerHTML = '';
    let selectedTimeframe;
    const activeBtn = document.querySelector('#timeframe-group .active-btn');
    const isCustom = !customDaysInput.classList.contains('hidden');
    
    if (isCustom) { selectedTimeframe = parseInt(customDaysInput.value) || 1; } 
    else { 
        const activeValue = activeBtn ? activeBtn.dataset.value : '30'; 
        selectedTimeframe = (activeValue === 'all') ? 9999 : parseInt(activeValue); 
    }
    
    repos.forEach(repo => {
        const li = document.createElement('li');
        li.className = 'p-4 border border-gray-700 rounded-lg';
        const velocity = repo.velocityScore.toFixed(1);
        const isBookmarked = bookmarks.some(b => b.id === repo.id);
        const ownerTypeBadge = repo.owner.type === 'Organization' ? `<span class="text-xs font-semibold bg-blue-900 text-blue-300 px-2 py-0.5 rounded ml-2">Org</span>` : '';
        let topicBadge = '';
        if (repo.category === 'ai') topicBadge = `<span class="text-xs font-semibold bg-[#c9587c] text-white px-2 py-0.5 rounded ml-2">AI</span>`;
        if (repo.category === 'agents') topicBadge = `<span class="text-xs font-semibold bg-[#c9587c] text-white px-2 py-0.5 rounded ml-2">Agent</span>`;
        if (repo.category === 'web') topicBadge = `<span class="text-xs font-semibold bg-[#c9587c] text-white px-2 py-0.5 rounded ml-2">Web</span>`;
        if (repo.category === 'tools') topicBadge = `<span class="text-xs font-semibold bg-[#c9587c] text-white px-2 py-0.5 rounded ml-2">Tool</span>`;

        // Highlight Laude Items
        if (repo.isLaude) {
            li.classList.add('border-[#e9de97]', 'border-opacity-50');
        }

        li.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex items-center space-x-2">
                    <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" data-repo-id="${repo.id}">
                        <svg class="icon-empty w-5 h-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 11.186 0Z" /></svg>
                        <svg class="icon-filled w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M6.32 2.577a48.255 48.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21L12 17.25 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clip-rule="evenodd" /></svg>
                    </button>
                    <a href="${repo.html_url}" target="_blank" class="text-xl font-bold text-[#e9de97] hover:text-[#d9ce8a] hover:underline">${repo.full_name}</a>
                    ${ownerTypeBadge}
                    ${topicBadge}
                </div>
                <div class="text-right">
                    <div class="text-xl font-bold text-[#7592fd]">${velocity}</div>
                    <div class="text-xs text-gray-400">avg. stars / day</div>
                </div>
            </div>
            <p class="text-sm text-gray-300 mt-2">${repo.description || 'No description provided.'}</p>
            <div class="flex items-center justify-between mt-3">
                <div class="flex items-center space-x-4 text-xs text-gray-200">
                    <div class="flex items-center"><svg class="w-4 h-4 text-[#e9de97] mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.54-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z"></path></svg><span class="font-medium">${repo.stargazers_count.toLocaleString()}</span><span class="text-gray-400 ml-1">stars</span></div>
                    <span class="text-gray-600">|</span>
                    <div class="flex items-center"><img src="/assets/git-fork.svg" alt="Fork icon" class="w-4 h-4 mr-1"><span class="font-medium">${repo.forks_count.toLocaleString()}</span><span class="text-gray-400 ml-1">forks</span></div>
                    <span class="text-gray-600">|</span>
                    <div class="flex items-center"><svg class="w-4 h-4 text-gray-400 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span class="text-gray-400">${repo.daysOld} ${repo.daysOld === 1 ? 'day' : 'days'}</span></div>
                </div>
                <div class="flex items-center space-x-2">
                    <div id="social-buzz-container-${repo.id}"><button data-repo="${repo.full_name}" data-timeframe="${selectedTimeframe}" data-target-id="${repo.id}" data-buzz-state="hidden" class="calculate-buzz-btn text-xs text-[#c9587c] hover:text-[#e39ab0] font-medium py-1 px-2 rounded-lg hover:bg-gray-700">Buzz</button></div>
                    <div id="profile-btn-container-${repo.id}" class="min-w-[100px] flex justify-center"><button data-repo="${repo.full_name}" data-target-id="${repo.id}" class="show-profile-btn text-xs text-[#c9587c] hover:text-[#e39ab0] font-medium py-1 px-2 rounded-lg hover:bg-gray-700">Profile</button></div>
                    <div id="chart-btn-container-${repo.id}" class="min-w-[100px] flex justify-center"><button data-repo="${repo.full_name}" data-target-id="${repo.id}" data-timeframe="${selectedTimeframe}" data-total-stars="${repo.stargazers_count}" data-days-old="${repo.daysOld}" class="show-chart-btn text-xs text-[#c9587c] hover:text-[#e39ab0] font-medium py-1 px-2 rounded-lg hover:bg-gray-700">Trajectory</button></div>
                </div>
            </div>
            <div id="buzz-results-container-${repo.id}" class="mt-3 pt-3 border-t border-gray-700 hidden"></div>
            <div id="chart-container-${repo.id}" class="hidden mt-3 pt-3 border-t border-gray-700"><canvas id="chart-${repo.id}"></canvas></div>
        `;
        repoList.appendChild(li);
    });
}

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