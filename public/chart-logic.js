// --- public/char-logic.js ---
// This file contains all logic for creating and managing the star trajectory charts.

const chartInstances = {};
const chartLoaders = {};

/**
 * Main exported function.
 * This is called by app.js when a "Show Trajectory" button is clicked.
 */
async function toggleChart(button, repoName, targetId, timeframe, totalStars, daysOld) {
    const chartContainer = document.getElementById(`chart-container-${targetId}`);
    if (!chartContainer) return;

    const existingChart = chartInstances[targetId];

    if (existingChart) {
        // If chart exists, destroy it and hide
        existingChart.destroy();
        delete chartInstances[targetId];
        chartContainer.classList.add('hidden');
        button.textContent = "Show Trajectory";
    } else {
        // If no chart, create one
        if (chartLoaders[targetId]) return;
        chartLoaders[targetId] = true;
        
        button.textContent = "Loading...";

        try {
            // 1. Fetch the REAL data from your server, passing the timeframe
            const { timestamps } = await fetchStarHistory(repoName, timeframe);
            
            // 2. Show the container
            chartContainer.classList.remove('hidden');

            // 3. Draw the chart, passing all data
            drawChart(timestamps, targetId, timeframe, totalStars, daysOld);
            
            button.textContent = "Hide Trajectory";

        } catch (err) {
            console.error('Failed to load chart:', err);
            button.textContent = "Error";
            chartContainer.classList.add('hidden');
        } finally {
            chartLoaders[targetId] = false;
        }
    }
}

/**
 * REAL API FUNCTION
 * This calls your new backend endpoint, passing the timeframe as 'days'.
 */
async function fetchStarHistory(repoName, timeframe) {
    console.log(`Fetching REAL star history for: ${repoName} over ${timeframe} days`);
    
    // Pass 'timeframe' as the 'days' query parameter
    const response = await fetch(`/api/star-history?repo=${repoName}&days=${timeframe}`);
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch from local API');
    }
    
    const data = await response.json();
    return data; // Returns { timestamps: [...] }
}

/**
 * "SMART" DRAW CHART FUNCTION - V4 (The "Trend Curve")
 * This creates a LINE CHART of *new stars per day*
 * to perfectly visualize momentum.
 */
function drawChart(timestamps, targetId, timeframe, totalStars, daysOld) {
    const ctx = document.getElementById(`chart-${targetId}`).getContext('2d');
    
    // --- 1. Process the data ---
    let searchDays = parseInt(timeframe);
    if (isNaN(searchDays) || searchDays > 365) searchDays = 30; // Default to 30 for "All Time" or invalid
    if (searchDays < 1) searchDays = 1;

    // The chart's X-axis should be the SMALLEST of (search timeframe vs. repo age)
    const repoAge = (isNaN(daysOld) || daysOld < 1) ? 1 : daysOld;
    let daysToChart = Math.min(searchDays, repoAge);
    if (daysToChart < 1) daysToChart = 1;

    const labels = [];
    
    // Create date labels for the X-axis
    const today = new Date();
    for (let i = daysToChart - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    }

    // Create a "bucket" for each day. This is the data we will plot!
    let dailyStarCounts = new Array(daysToChart).fill(0);
    
    // Loop through the complete list of timestamps from the server
    timestamps.forEach(ts => {
        const starDate = new Date(ts);
        const now = new Date();
        const diffTime = now.getTime() - starDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        // If the star happened within our chart's timeframe, add it to the bucket
        if (diffDays >= 0 && diffDays < daysToChart) {
            dailyStarCounts[daysToChart - 1 - diffDays]++;
        }
    });

    // --- 2. Destroy old chart and draw new one ---
    if (chartInstances[targetId]) {
        chartInstances[targetId].destroy();
    }

    const newChart = new Chart(ctx, {
        type: 'line', // <--- CHANGED BACK TO 'line'
        data: {
            labels: labels, 
            datasets: [{
                label: 'New Stars Per Day',
                data: dailyStarCounts, // <-- Using the daily counts!
                backgroundColor: 'rgba(117, 146, 253, 0.2)', // Area color
                borderColor: '#7592fd',     // Line color
                borderWidth: 2,
                fill: true,     // <--- ADD THIS to fill under the line
                tension: 0.4    // <--- ADD THIS to make the line curve
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true, // <-- Start Y-axis at 0
                    ticks: { 
                        color: '#9ca3af',
                        precision: 0 // Ensure only whole numbers
                    },
                    grid: { color: '#4b5563' }
                },
                x: {
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#4b5563' } // Re-enabled grid lines
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#e5e7eb' }
                }
            }
        }
    });

    chartInstances[targetId] = newChart;
}

// This "exports" the toggleChart function so app.js can import it
export { toggleChart };