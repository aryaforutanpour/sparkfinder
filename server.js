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
            
            // Note: repo.forks_count is already here!
            return { ...repo, daysOld: diffDays, velocityScore: velocityScore };
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
        res.json({
            repo: repo,
            ...buzzData 
        });

    } catch (err) {
        console.error(`[Social Buzz] Final error for ${repo}:`, err);
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 3: Get Star History (Paginated) ---
// (This is the one for Trajectory - untouched)
app.get('/api/star-history', async (req, res) => {
    const { repo, days } = req.query;
    const pat = process.env.GITHUB_PAT;

    if (!repo || !days) {
        return res.status(400).json({ message: 'Repo and days are required.' });
    }
    if (!pat) {
        return res.status(500).json({ message: 'Server error: GitHub PAT not configured.' });
    }

    const daysAgo = parseInt(days, 10);
    if (isNaN(daysAgo) || daysAgo < 1) {
        return res.status(400).json({ message: 'Invalid day range.' });
    }
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    console.log(`[Spark-Finder] Fetching paginated star history for ${repo} since ${startDate.toISOString()}`);

    let allTimestamps = [];
    let page = 1;
    let keepFetching = true;

    try {
        while (keepFetching) {
            const url = `https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}&direction=desc`;
            
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/vnd.github.v3.star+json',
                    'Authorization': `token ${pat}`,
                    'User-Agent': 'Spark-Finder-App'
                }
            });

            logRateLimit(response); 

            if (!response.ok) {
                if (response.status === 404) {
                    keepFetching = false;
                    break;
                }
                throw new Error(`GitHub API error: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.length === 0) {
                keepFetching = false;
                break;
            }

            let lastStarDateInPage = null;
            for (const star of data) {
                const starDate = new Date(star.starred_at);
                
                if (starDate >= startDate) {
                    allTimestamps.push(star.starred_at);
                }
                lastStarDateInPage = starDate;
            }

            if (lastStarDateInPage === null || lastStarDateInPage < startDate || data.length < 100) {
                keepFetching = false;
            } else {
                page++;
            }
        } // end while loop

        console.log(`[Spark-Finder] Found ${allTimestamps.length} stars for ${repo} in the last ${days} days.`);
        
        res.json({ timestamps: allTimestamps });

    } catch (err) {
        console.error(`[Spark-Finder] Error fetching paginated star history:`, err.message);
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 4: Get Profile Info (NOW INCLUDES README) ---
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