//
// COMPLETE PRODUCTION-READY server.js
// Includes: Fixed true-velocity, Optimized version, and Caching
//

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3000;

function logRateLimit(response) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const total = 5000; // This is the standard PAT limit
    if (remaining) {
        const remainingNum = parseInt(remaining, 10);
        const percentage = ((remainingNum / total) * 100).toFixed(0);
        console.log(`[Spark-Finder] API Tokens: ${remainingNum.toLocaleString()} / 5,000 (${percentage}%)`);
    }
}

// Simple in-memory cache for velocity calculations
const velocityCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoint 1: The fast search ---
app.get('/api/search', async (req, res) => {
    const { days } = req.query;
    const pat = process.env.GITHUB_PAT;
    if (!pat) return res.status(500).json({ message: 'Server error: GitHub PAT not configured.' });

    function getPastDate(daysAgo) {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return date.toISOString().split('T')[0];
    }

    const createdDate = getPastDate(days);
    const query = `created:>=${createdDate}`;
    const sort = 'stars';
    const order = 'desc';
    const per_page = 50;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${per_page}`;
    
    console.log(`[Spark-Finder] Sending query to GitHub: ${url}`);
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
        const githubResponse = await fetch(url, { headers });
        logRateLimit(githubResponse); // Log the rate limit
        console.log(`[Spark-Finder] GitHub responded with status: ${githubResponse.status}`);
        if (!githubResponse.ok) {
            const errorData = await githubResponse.json();
            return res.status(githubResponse.status).json({ message: errorData.message });
        }
        
        const data = await githubResponse.json();
        console.log(`[Spark-Finder] Found ${data.items.length} items to analyze.`);

        const today = new Date();
        const reposWithVelocity = data.items.map(repo => {
            const createdDate = new Date(repo.created_at);
            const diffTime = Math.abs(today - createdDate);
            const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            const velocityScore = repo.stargazers_count / diffDays;
            return { ...repo, daysOld: diffDays, velocityScore: velocityScore };
        });

        const sortedRepos = reposWithVelocity.sort((a, b) => b.velocityScore - a.velocityScore);
        res.json(sortedRepos.slice(0, 25));

    } catch (err) {
        console.error('[Spark-Finder] Server fetch error:', err);
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 2: OPTIMIZED True Velocity (with caching) ---
// THIS IS THE ONE YOU SHOULD USE IN YOUR FRONTEND
app.get('/api/true-velocity', async (req, res) => {
    const { repo, checkDays } = req.query;
    if (!repo) {
        return res.status(400).json({ message: 'Missing "repo" query parameter.' });
    }

    const daysToScan = parseInt(checkDays) || 7;
    const cacheKey = `${repo}-${daysToScan}`;
    
    // Check cache first
    const cached = velocityCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Cache Hit] Returning cached velocity for ${repo}`);
        return res.json(cached.data);
    }

    const pat = process.env.GITHUB_PAT;
    if (!pat) return res.status(500).json({ message: 'Server error: GitHub PAT not configured.' });

    const dateAgo = new Date();
    dateAgo.setDate(dateAgo.getDate() - daysToScan);
    dateAgo.setUTCHours(0, 0, 0, 0);

    console.log(`[True Velocity] Starting ${daysToScan}-day optimized scan for: ${repo}`);

    try {
        const headers = {
            'Accept': 'application/vnd.github.star+json',
            'Authorization': `token ${pat}`,
            'X-GitHub-Api-Version': '2022-11-28'
        };

        // Get repository info and total star count
        const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${pat}`,
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        
        if (!repoResponse.ok) {
            if (repoResponse.status === 404) {
                return res.status(404).json({ message: 'Repository not found' });
            }
            throw new Error('Error fetching repository data.');
        }
        
        const repoData = await repoResponse.json();
        const totalStars = repoData.stargazers_count;
        
        // Quick optimization: if repo is very new, just count all stars
        const repoAge = Math.floor((Date.now() - new Date(repoData.created_at)) / (1000 * 60 * 60 * 24));
        if (repoAge <= daysToScan) {
            const result = {
                repo: repo,
                starsInPeriod: totalStars,
                daysScanned: daysToScan,
                velocityPerDay: (totalStars / Math.max(1, repoAge)).toFixed(2),
                note: 'Repo is newer than scan period'
            };
            
            // Cache the result
            velocityCache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });
            
            return res.json(result);
        }

        const totalPages = Math.ceil(totalStars / 100);
        console.log(`[True Velocity] Total stars: ${totalStars}, pages: ${totalPages}`);
        
        // Binary search to find the page with our cutoff date
        let leftPage = 1;
        let rightPage = totalPages;
        let cutoffPage = totalPages;
        let apiCallsUsed = 1; // Already made 1 call for repo info
        
        while (leftPage <= rightPage) {
            const midPage = Math.floor((leftPage + rightPage) / 2);
            const url = `https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${midPage}`;
            
            apiCallsUsed++;
            const response = await fetch(url, { headers });
            logRateLimit(response); // Log the rate limit
            
            if (!response.ok) {
                console.error(`Error fetching page ${midPage}: ${response.status}`);
                throw new Error('Error fetching stargazer data.');
            }
            
            const stargazers = await response.json();
            
            if (stargazers.length === 0) {
                rightPage = midPage - 1;
                continue;
            }
            
            const lastStarDate = new Date(stargazers[stargazers.length - 1].starred_at);
            
            if (lastStarDate <= dateAgo) {
                leftPage = midPage + 1;
            } else {
                cutoffPage = midPage;
                const firstStarDate = new Date(stargazers[0].starred_at);
                
                if (firstStarDate > dateAgo) {
                    rightPage = midPage - 1;
                } else {
                    // Found the exact page with the cutoff
                    break;
                }
            }
        }
        
        // Count recent stars from cutoffPage onwards
        let recentStarCount = 0;
        
        for (let page = cutoffPage; page <= totalPages; page++) {
            const url = `https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}`;
            apiCallsUsed++;
            
            const response = await fetch(url, { headers });
            if (!response.ok) throw new Error('Error fetching stargazer data.');
            
            const stargazers = await response.json();
            
            for (const star of stargazers) {
                const starDate = new Date(star.starred_at);
                if (starDate > dateAgo) {
                    recentStarCount++;
                }
            }
            
            if (stargazers.length < 100) break; // Last page
        }
        
        console.log(`[True Velocity] ✓ Found ${recentStarCount} stars using ${apiCallsUsed} API calls`);
        
        const result = {
            repo: repo,
            starsInPeriod: recentStarCount,
            daysScanned: daysToScan,
            velocityPerDay: (recentStarCount / daysToScan).toFixed(2),
            apiCallsUsed: apiCallsUsed
        };
        
        // Cache the result
        velocityCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        res.json(result);

    } catch (err) {
        console.error(`[True Velocity] Error for ${repo}:`, err);
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 3: Social Buzz ---
app.get('/api/social-buzz', async (req, res) => {
    const { repo } = req.query;
    if (!repo) {
        return res.status(400).json({ message: 'Missing "repo" query parameter.' });
    }

    console.log(`[Social Buzz] Checking mentions for: ${repo}`);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const hnTimestamp = Math.floor(thirtyDaysAgo.getTime() / 1000);

    // Helper function for Hacker News
    const fetchHackerNews = async (repoName) => {
        const query = `"${repoName}"`;
        const url = `http://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${hnTimestamp}`;
        
        try {
            const response = await fetch(url, { headers: { 'User-Agent': 'Spark-Finder-App' } });
            if (!response.ok) return [];
            const data = await response.json();
            console.log(`[Social Buzz] Found ${data.hits.length} HN posts.`);
            
            return data.hits.map(hit => ({
                title: hit.title,
                url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
                score: hit.points
            }));

        } catch (err) {
            console.error('[Social Buzz] HN Error:', err.message);
            return [];
        }
    };

    // Helper function for Reddit
    const fetchReddit = async (repoName) => {
        const query = `"${repoName}"`;
        const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&t=month`;
        
        try {
            const response = await fetch(url, { headers: { 'User-Agent': 'Spark-Finder-App' } });
            if (!response.ok) return [];
            const data = await response.json();
            console.log(`[Social Buzz] Found ${data.data.children.length} Reddit posts.`);
            
            return data.data.children.map(child => ({
                title: child.data.title,
                url: `https://www.reddit.com${child.data.permalink}`,
                score: child.data.score
            }));

        } catch (err) {
            console.error('[Social Buzz] Reddit Error:', err.message);
            return [];
        }
    };

    // Run both searches in parallel
    try {
        const [hnPosts, redditPosts] = await Promise.all([
            fetchHackerNews(repo),
            fetchReddit(repo)
        ]);

        res.json({
            repo: repo,
            hackerNewsPosts: hnPosts,
            redditPosts: redditPosts
        });

    } catch (err) {
        console.error(`[Social Buzz] Final error for ${repo}:`, err);
        res.status(500).json({ message: err.message });
    }
});


// --- Endpoint 4: Clear cache (useful for testing) ---
app.post('/api/clear-cache', (req, res) => {
    const sizeBefore = velocityCache.size;
    velocityCache.clear();
    console.log(`[Cache] Cleared ${sizeBefore} cached entries`);
    res.json({ message: `Cleared ${sizeBefore} cached entries` });
});

// --- Endpoint 5: View cache status ---
app.get('/api/cache-status', (req, res) => {
    const cacheEntries = [];
    const now = Date.now();
    
    for (const [key, value] of velocityCache.entries()) {
        const age = Math.floor((now - value.timestamp) / 1000);
        cacheEntries.push({
            key: key,
            age: `${age}s`,
            expires: `${Math.floor((CACHE_TTL - (now - value.timestamp)) / 1000)}s`
        });
    }
    
    res.json({
        totalEntries: velocityCache.size,
        ttl: `${CACHE_TTL / 1000}s`,
        entries: cacheEntries
    });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(` Spark-Finder server running at http://localhost:${PORT}`);
        console.log(` Cache enabled with ${CACHE_TTL / 1000}s TTL`);
        console.log(` Using GitHub PAT: ${process.env.GITHUB_PAT ? 'Yes' : 'No (set GITHUB_PAT in .env)'}`);
        
        import('open').then(openModule => {
            openModule.default(`http://localhost:${PORT}`);
        }).catch(() => {
            // Silent fail if 'open' package not installed
        });
    });
}

module.exports = app;

