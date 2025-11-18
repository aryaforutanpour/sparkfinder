require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { fetchAllBuzz } = require('./api_logic/buzz-logic.js');

const app = express();

function logRateLimit(response) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const total = 5000; // This is the standard PAT limit
    if (remaining) {
        const remainingNum = parseInt(remaining, 10);
        const percentage = ((remainingNum / total) * 100).toFixed(0);
        console.log(`[Spark-Finder] API Tokens: ${remainingNum.toLocaleString()} / 5,000 (${percentage}%)`);
    }
}

app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoint 1: The fast search (Now with Auto-Tagging) ---
app.get('/api/search', async (req, res) => {
    const { days, page } = req.query; 
    const pageNum = page || 1;

    const pat = process.env.GITHUB_PAT;
    if (!pat) return res.status(500).json({ message: 'Server error: GitHub PAT not configured.' });

    function getPastDate(daysAgo) {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return date.toISOString().split('T')[0];
    }

    // --- NEW: Auto-Tagging Logic ---
    function detectCategory(repo) {
        // Combine name, description, and topics into one big lowercase string to search
        const text = (
            (repo.name || '') + ' ' + 
            (repo.description || '') + ' ' + 
            (repo.topics || []).join(' ')
        ).toLowerCase();

        // 1. AI/ML Keywords
        if (text.match(/ai|gpt|llm|machine learning|neural|diffusion|transformer|rag|openai|llama|anthropic|deep learning|computer vision|nlp/)) {
            return 'ai';
        }
        // 2. Web Keywords
        if (text.match(/react|nextjs|vue|svelte|tailwind|css|html|web|frontend|backend|api|http|server|browser|wasm/)) {
            return 'web';
        }
        // 3. Tools Keywords
        if (text.match(/cli|tool|library|sdk|compiler|parser|utility|automation|devops|docker|kubernetes|terminal/)) {
            return 'tools';
        }
        
        return 'other';
    }

    const createdDate = getPastDate(days);
    const query = `created:>=${createdDate}`;
    const sort = 'stars';
    const order = 'desc';
    const per_page = 50;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${per_page}&page=${pageNum}`;
    
    console.log(`[Spark-Finder] Fetching Page ${pageNum} from GitHub...`);
    
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
        const githubResponse = await fetch(url, { headers });
        logRateLimit(githubResponse);
        
        if (!githubResponse.ok) {
            const errorData = await githubResponse.json();
            return res.status(githubResponse.status).json({ message: errorData.message });
        }
        
        const data = await githubResponse.json();
        console.log(`[Spark-Finder] Page ${pageNum} returned ${data.items.length} items.`);

        const today = new Date();
        const reposWithVelocity = data.items.map(repo => {
            const createdDate = new Date(repo.created_at);
            const diffTime = Math.abs(today - createdDate);
            const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            const velocityScore = repo.stargazers_count / diffDays;
            
            // --- HERE WE ADD THE CATEGORY ---
            const category = detectCategory(repo);
            
            return { 
                ...repo, 
                daysOld: diffDays, 
                velocityScore: velocityScore,
                category: category // <--- Sending this to frontend
            };
        });

        const sortedRepos = reposWithVelocity.sort((a, b) => b.velocityScore - a.velocityScore);
        res.json(sortedRepos.slice(0, 25));

    } catch (err) {
        console.error('[Spark-Finder] Server fetch error:', err);
        res.status(500).json({ message: err.message });
    }
});


// --- Endpoint 2: Social Buzz ---
app.get('/api/social-buzz', async (req, res) => {
    const { repo, days } = req.query;
    if (!repo) {
        return res.status(400).json({ message: 'Missing "repo" query parameter.' });
    }
    const daysAgo = parseInt(days) || 30;
    console.log(`[Social Buzz] Checking mentions for: ${repo} (Last ${daysAgo} days)`);
    try {
        const buzzData = await fetchAllBuzz(repo, daysAgo);
        res.json({ repo: repo, ...buzzData });
    } catch (err) {
        console.error(`[Social Buzz] Final error for ${repo}:`, err);
        res.status(500).json({ message: err.message });
    }
});

// 
// --- Endpoint 3: High-Performance Star History ---
// 
app.get('/api/star-history', async (req, res) => {
    const { repo, days, daysOld } = req.query;
    const pat = process.env.GITHUB_PAT;

    if (!repo || !days || !daysOld) {
        return res.status(400).json({ message: 'Repo, days, and daysOld are required.' });
    }
    if (!pat) {
        return res.status(500).json({ message: 'Server error: GitHub PAT not configured.' });
    }

    const headers = {
        'Accept': 'application/vnd.github.v3.star+json',
        'Authorization': `token ${pat}`,
        'User-Agent': 'Spark-Finder-App'
    };

    const repoAge = parseInt(daysOld, 10);
    let searchDays = parseInt(days, 10);
    
    if (isNaN(searchDays) || searchDays > 365) searchDays = 30;
    if (searchDays < 1) searchDays = 1;

    let daysToChart = Math.min(searchDays, repoAge);
    if (daysToChart < 1) daysToChart = 1;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToChart);

    console.log(`[Spark-Finder] Processing star history for ${repo} (Charting last ${daysToChart} days)`);

    const labels = [];
    const today = new Date();
    for (let i = daysToChart - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    }
    
    let dailyStarCounts = new Array(daysToChart).fill(0);
    const now = new Date();

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
        logRateLimit(repoRes);
        if (!repoRes.ok) {
            throw new Error(`Failed to fetch repo data: ${repoRes.status}`);
        }
        const repoData = await repoRes.json();
        const totalStars = repoData.stargazers_count;
        const totalPages = Math.ceil(totalStars / 100);

        if (totalPages === 0) {
            return res.json({ labels: labels, data: dailyStarCounts }); 
        }

        const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
        const BATCH_SIZE = 10; 
        let allStars = [];
        
        console.log(`[Spark-Finder] Total pages to fetch: ${totalPages}. Starting parallel batches...`);

        for (let i = 0; i < totalPages; i += BATCH_SIZE) {
            const batchPageNumbers = pageNumbers.slice(i, i + BATCH_SIZE);
            
            const fetchPromises = batchPageNumbers.map(page => {
                const url = `https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}&direction=desc`;
                return fetch(url, { headers });
            });

            const responses = await Promise.all(fetchPromises);

            for (const response of responses) {
                logRateLimit(response);
                if (!response.ok) {
                    throw new Error(`GitHub API error in batch: ${response.statusText}`);
                }
            }
            
            const dataPromises = responses.map(res => res.json());
            const dataArray = await Promise.all(dataPromises);
            
            allStars.push(...dataArray.flat());
        } 

        console.log(`[Spark-Finder] All ${totalPages} pages fetched. Total stars processed: ${allStars.length}`);

        for (const star of allStars) {
            const starDate = new Date(star.starred_at);
            if (starDate >= startDate) {
                const diffTime = now.getTime() - starDate.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays >= 0 && diffDays < daysToChart) {
                    dailyStarCounts[daysToChart - 1 - diffDays]++;
                }
            } else {
                break;
            }
        }

        res.json({
            labels: labels,
            data: dailyStarCounts
        });

    } catch (err) {
        console.error(`[Spark-Finder] Error fetching paginated star history:`, err.message);
        res.status(500).json({ message: err.message });
    }
});


// --- Endpoint 4: Get Profile Info ---
app.get('/api/profile', async (req, res) => {
    const { repo } = req.query; 
    const pat = process.env.GITHUB_PAT;

    if (!repo) {
        return res.status(400).json({ message: 'Repo parameter is required.' });
    }
    if (!pat) {
        return res.status(500).json({ message: 'Server error: GitHub PAT not configured.' });
    }

    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
        return res.status(400).json({ message: 'Invalid repo format. Must be "owner/repo".' });
    }

    const headers = {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
    };

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers });
        logRateLimit(repoRes);
        
        if (!repoRes.ok) {
            throw new Error(`Failed to fetch repo data: ${repoRes.status}`);
        }

        const repoData = await repoRes.json();
        const ownerLogin = repoData.owner.login;
        const ownerType = repoData.owner.type;

        const userRes = await fetch(`https://api.github.com/users/${ownerLogin}`, { headers });
        logRateLimit(userRes);

        if (!userRes.ok) {
            throw new Error(`Failed to fetch user data: ${userRes.status}`);
        }

        const userData = await userRes.json();

        let readmeContent = null;
        try {
            const readmeRes = await fetch(`https://api.github.com/repos/${ownerLogin}/${ownerLogin}/readme`, { headers });
            logRateLimit(readmeRes); 

            if (readmeRes.ok) {
                const readmeData = await readmeRes.json();
                readmeContent = Buffer.from(readmeData.content, 'base64').toString('utf8');
            }
            
        } catch (readmeErr) {
            console.log(`[Spark-Finder] No profile README found for ${ownerLogin}. This is normal.`);
        }

        const profileData = {
            login: userData.login,
            name: userData.name || null,
            type: ownerType,
            bio: userData.bio || null, 
            company: userData.company || null,
            location: userData.location || null,
            readmeContent: readmeContent 
        };

        res.json(profileData);

    } catch (err) {
        console.error(`[Spark-Finder] Error fetching profile for ${repo}:`, err.message);
        res.status(500).json({ message: err.message });
    }
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(` Spark-Finder server running at http://localhost:${PORT}`);
        console.log(` Using GitHub PAT: ${process.env.GITHUB_PAT ? 'Yes' : 'No (set GITHUB_PAT in .env)'}`);
        
        import('open').then(openModule => {
            openModule.default(`http://localhost:${PORT}`);
        }).catch(() => {
            // Silent fail if 'open' package not installed
        });
    });
}

module.exports = app;