// --- public/chart-logic.js ---
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
        button.textContent = "Trajectory";
    } else {
        // If no chart, create one
        if (chartLoaders[targetId]) return;
        chartLoaders[targetId] = true;
        
        button.textContent = "Loading...";

        try {
            // 1. Fetch the PRE-PROCESSED data from your server
            const chartData = await fetchStarHistory(repoName, timeframe, daysOld);
            
            // 2. Show the container
            chartContainer.classList.remove('hidden');

            // 3. Draw the chart (this is now much simpler)
            drawChart(chartData, targetId);
            
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
 * OPTIMIZED API FUNCTION
 * This calls your backend, passing all necessary info for the server to process.
 */
async function fetchStarHistory(repoName, timeframe, daysOld) {
    console.log(`Fetching PROCESSED star history for: ${repoName}`);
    
    // Pass 'timeframe' AND 'daysOld' to the backend
    const response = await fetch(`/api/star-history?repo=${repoName}&days=${timeframe}&daysOld=${daysOld}`);
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch from local API');
    }
    
    const data = await response.json();
    return data; // Returns { labels: [...], data: [...] }
}

/**
 * "DUMB" DRAW CHART FUNCTION
 * This function is now very simple. It just receives the processed
 * labels and data from the server and draws the chart.
 */
function drawChart(chartData, targetId) {
    const ctx = document.getElementById(`chart-${targetId}`).getContext('2d');
    
    // 1. Get the pre-processed data from the server
    const { labels, data } = chartData;
    
    // 2. Destroy old chart and draw new one
    if (chartInstances[targetId]) {
        chartInstances[targetId].destroy();
    }

    const newChart = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: labels, // <-- Use server-provided labels
            datasets: [{
                label: 'New Stars Per Day',
                data: data, // <-- Use server-provided data
                backgroundColor: 'rgba(117, 146, 253, 0.2)', // Area color
                borderColor: '#7592fd',     // Line color
                borderWidth: 2,
                fill: true,     
                tension: 0.4    
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true, 
                    ticks: { 
                        color: '#9ca3af',
                        precision: 0 
                    },
                    grid: { color: '#4b5563' }
                },
                x: {
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#4b5563' }
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