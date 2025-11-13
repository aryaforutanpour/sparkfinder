
        const fetchButton = document.getElementById('fetchButton');
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        const results = document.getElementById('results');
        const resultsTitle = document.getElementById('results-title');
        const repoList = document.getElementById('repo-list');
        const timeframeGroup = document.getElementById('timeframe-group');
        // Add this with your other const definitions
        const customBtnTrigger = document.getElementById('custom-btn-trigger');
        const customDaysInput = document.getElementById('custom-days-input');

// --- 1. TIMEFRAME CLICK LOGIC (UPDATED) ---
timeframeGroup.addEventListener('click', (e) => {
    const clickedButton = e.target.closest('.timeframe-btn');
    
    // If we didn't click a button, or we clicked the "Custom" trigger, do nothing here.
    if (!clickedButton || clickedButton.id === 'custom-btn-trigger') {
        return;
    }

    // --- This code now only runs for 7, 30, 90, All Time ---
    
    // 1. Reset all button styles
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    // 2. Hide the input and show the "Custom" text
    customDaysInput.classList.add('hidden');
    customBtnTrigger.classList.remove('hidden');
    customBtnTrigger.classList.remove('active-btn'); // Make sure custom isn't active
    
    // 3. Activate the button that was clicked (e.g., "7 Days")
    clickedButton.classList.add('active-btn');

    // 4. Show the "Find" button
    fetchButton.classList.add('btn-pulse-glow');
    fetchButton.classList.remove('hidden');
});

// --- NEW: LISTENER FOR THE "CUSTOM" BUTTON FACADE ---
customBtnTrigger.addEventListener('click', () => {
    // 1. Deactivate all other buttons
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    // 2. Hide the "Custom" text and show the input box
    customBtnTrigger.classList.add('hidden');
    customDaysInput.classList.remove('hidden');
    
    // 3. Auto-focus and select the text
    customDaysInput.focus();
    customDaysInput.select();
    
    // 4. Show the "Find" button
    fetchButton.classList.add('btn-pulse-glow');
    fetchButton.classList.remove('hidden');
});

// --- NEW: AUTO-SELECT CUSTOM ON INPUT ---
customDaysInput.addEventListener('input', () => {
    // 1. Deactivate all other buttons
    timeframeGroup.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active-btn');
    });
    
    // 2. Make the "Find" button glow
    fetchButton.classList.add('btn-pulse-glow');
    fetchButton.classList.remove('hidden');
});

// --- 2. FETCH BUTTON LOGIC (UPDATED) ---
fetchButton.addEventListener('click', () => {
    fetchButton.classList.remove('btn-pulse-glow');
    fetchButton.classList.add('hidden');

    let days;
    const activeBtn = document.querySelector('#timeframe-group .active-btn');

    // NEW LOGIC: Check if the input is visible. If so, use its value.
    if (!customDaysInput.classList.contains('hidden')) {
        days = customDaysInput.value;
    } else {
        // Otherwise, find the active button
        const activeValue = activeBtn ? activeBtn.dataset.value : '30';
        days = (activeValue === 'all') ? '9999' : activeValue;
    }
    
    fetchData(days);
});

        async function fetchData(days) {
            showLoading(true);
            showError(null);
            results.classList.add('hidden');
            repoList.innerHTML = '';

            try {
                const res = await fetch(`/api/search?days=${days}`);
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(`API Search error: ${errorData.message}`);
                }
                const repos = await res.json(); 
                if (!repos || repos.length === 0) {
                    showError("No repositories found matching these criteria.");
                    return;
                }
                displayResults(repos); 

            } catch (err) {
                console.error('Fetch Error:', err);
                showError(err.message);
            } finally {
                showLoading(false);
            }
        }

        function displayResults(repos) {
            let selectedTimeframe;
    let deepDiveDays;
    let deepDiveText;

    const activeBtn = document.querySelector('#timeframe-group .active-btn');
    const isCustom = !customDaysInput.classList.contains('hidden');

    if (isCustom) {
        // --- Custom Input Logic ---
        selectedTimeframe = parseInt(customDaysInput.value) || 1; // Get custom days as a number

        if (selectedTimeframe === 1) {
            // Special Case: 1 day -> 12 hours
            deepDiveDays = 0.5; // We'll pass 0.5 to the API
            deepDiveText = "12-Hour";
        } else {
            // General Rule: 1/4 of custom days, rounded
            deepDiveDays = Math.round(selectedTimeframe / 4);
            // Handle 0-day rounding for inputs < 2
            if (deepDiveDays < 1) { deepDiveDays = 1; } 
            
            deepDiveText = `${deepDiveDays}-Day`;
        }
    } else {
        // --- Standard Button Logic (Original) ---
        const activeValue = activeBtn ? activeBtn.dataset.value : '30';
        selectedTimeframe = (activeValue === 'all') ? '9999' : activeValue;

        if (selectedTimeframe === '7') {
            deepDiveDays = 1;
            deepDiveText = "24-Hour";
        } else {
            // Default for 30, 90, and All Time
            deepDiveDays = 7;
            deepDiveText = "7-Day";
        }
    }

            if (selectedTimeframe === '7') {
                deepDiveDays = 1;
                deepDiveText = "24-Hour";
            }
            
            repos.forEach(repo => {
                const li = document.createElement('li');
                li.className = 'p-4 border border-gray-700 rounded-lg';
                
                const velocity = repo.velocityScore.toFixed(1);
                
                li.innerHTML = `
                    <div class="flex justify-between items-center">
                        <a href="${repo.html_url}" target="_blank" class="text-xl font-bold text-blue-400 hover:underline">${repo.full_name}</a>
                        
                        <div class="text-right">
                            <div class="text-xl font-bold text-indigo-400">${velocity}</div>
                            <div class="text-sm text-gray-400">avg. stars / day</div>
                        </div>
                    </div>
                    
                    <p class="text-sm text-gray-300 mt-2">${repo.description || 'No description provided.'}</p>
                    
                    <div class="flex items-center justify-between mt-3">
                        <div class="flex items-center space-x-4 text-sm text-gray-200">
                            <div class="flex items-center">
                                <svg class="w-4 h-4 text-yellow-400 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.54-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z"></path>
                                </svg>
                                <span class="font-medium">${repo.stargazers_count.toLocaleString()}</span>
                                <span class="text-gray-400 ml-1">total stars</span>
                            </div>
                            <span class="text-gray-600">|</span>
                            <div class="flex items-center">
                                <svg class="w-4 h-4 text-gray-400 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span class="text-gray-400">${repo.daysOld} ${repo.daysOld === 1 ? 'day' : 'days'} old</span>
                            </div>
                        </div>

                        <div class="flex items-center space-x-2">
                            <div id="social-buzz-container-${repo.id}">
                                <button 
                                    data-repo="${repo.full_name}" 
                                    data-target-id="${repo.id}"
                                    class="calculate-buzz-btn text-sm text-gray-400 hover:text-blue-400 font-medium py-1 px-3 rounded-lg hover:bg-gray-700">
                                    Check Buzz
                                </button>
                            </div>
                            <div id="true-velocity-container-${repo.id}">
                                <button 
                                    data-repo="${repo.full_name}" 
                                    data-target-id="${repo.id}"
                                    data-deep-dive-days="${deepDiveDays}"
                                    class="calculate-true-velocity-btn text-sm text-blue-400 hover:text-blue-400 font-medium py-1 px-3 rounded-lg hover:bg-gray-700">
                                    Check ${deepDiveText} Velocity
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="buzz-results-container-${repo.id}" class="mt-3 pt-3 border-t border-gray-700 hidden">
                        </div>
                `;
                repoList.appendChild(li);
            });

            results.classList.remove('hidden');
        }

        repoList.addEventListener('click', async (e) => {
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
                            <div class="text-lg font-bold text-green-400">${data.starsInPeriod}</div>
                            <div class="text-sm text-gray-400">stars in last ${data.daysScanned} ${dayText}</div>
                        </div>
                    `;
                } catch (err) {
                    console.error('True velocity fetch error:', err);
                    container.innerHTML = `<span class="text-sm text-red-400">Error</span>`;
                }
            }

            if (e.target.classList.contains('calculate-buzz-btn')) {
                const button = e.target;
                const repoName = button.dataset.repo;
                const targetId = button.dataset.targetId;
                const buttonContainer = document.getElementById(`social-buzz-container-${targetId}`);
                const resultsContainer = document.getElementById(`buzz-results-container-${targetId}`);
                
                buttonContainer.innerHTML = `<span class="text-sm text-gray-400">Checking...</span>`;

                try {
                    const res = await fetch(`/api/social-buzz?repo=${repoName}`);
                    if (!res.ok) { throw new Error("Failed to fetch buzz"); }
                    const data = await res.json();
                    
                    const hnCount = data.hackerNewsPosts.length;
                    const redditCount = data.redditPosts.length;
                    const totalMentions = hnCount + redditCount;

                    buttonContainer.innerHTML = `
                        <div class="flex items-center space-x-2 text-sm">
                            <span class="text-gray-400" title="Hacker News">HN:</span>
                            <span class="font-bold text-orange-400">${hnCount}</span>
                            <span class="text-gray-400" title="Reddit">R:</span>
                            <span class="font-bold text-red-400">${redditCount}</span>
                        </div>
                    `;

                    if (totalMentions > 0) {
                        let linksHtml = '<h4 class="text-sm font-semibold mb-2 text-gray-100">Social Mentions (Last 30 Days):</h4><ul class="list-disc list-inside space-y-1 text-xs">';
                        const createLink = (post, platform) => {
                            const color = platform === 'hn' ? 'text-orange-400' : 'text-red-400';
                            return `
                                <li class="truncate">
                                    <span class="font-bold ${color}">(${post.score})</span>
                                    <a href="${post.url}" target="_blank" class="text-blue-400 hover:underline">
                                        ${post.title}
                                    </a>
                                </li>
                            `;
                        };

                        data.hackerNewsPosts.sort((a, b) => b.score - a.score);
                        data.redditPosts.sort((a, b) => b.score - a.score);

                        linksHtml += data.hackerNewsPosts.map(p => createLink(p, 'hn')).join('');
                        linksHtml += data.redditPosts.map(p => createLink(p, 'rd')).join('');
                        linksHtml += '</ul>';
                        resultsContainer.innerHTML = linksHtml;
                        resultsContainer.classList.remove('hidden');
                    }
                } catch (err) {
                    console.error('Social buzz fetch error:', err);
                    buttonContainer.innerHTML = `<span class="text-sm text-red-400">Error</span>`;
                }
            }
        });

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
// --- TYPEWRITER EFFECT LOGIC ---
const textToType = "// SPARK-FINDER"; 
const typeWriterElement = document.getElementById('typewriter-text');
let charIndex = 0;

function typeWriter() {
    if (charIndex < textToType.length) {
        typeWriterElement.textContent += textToType.charAt(charIndex);
        charIndex++;
        setTimeout(typeWriter, 120); // Typing speed
    }
}

// Start the effect when the window loads
window.addEventListener('load', () => {
    // 1. Clear any existing text immediately so it starts empty
    typeWriterElement.textContent = ""; 

    // 2. Wait 1000 milliseconds (1 second) before starting the typing function
    setTimeout(typeWriter, 300); 
});
// --- END TYPEWRITER LOGIC ---
