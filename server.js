require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { fetchAllBuzz, generateSummaryFromText } = require('./api_logic/buzz-logic.js');

const app = express();

// --- NEW: Allow server to parse JSON bodies (Required for the summary feature) ---
app.use(express.json());

function logRateLimit(response) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const total = 5000; 
    if (remaining) {
        const remainingNum = parseInt(remaining, 10);
        const percentage = ((remainingNum / total) * 100).toFixed(0);
        console.log(`[Spark-Finder] API Tokens: ${remainingNum.toLocaleString()} / 5,000 (${percentage}%)`);
    }
}

app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoint 1: The fast search ---
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

    function detectCategory(repo) {
        const text = ((repo.name || '') + ' ' + (repo.description || '') + ' ' + (repo.topics || []).join(' ')).toLowerCase();
        if (text.match(/ai|gpt|llm|machine learning|neural|diffusion|transformer|rag|openai|llama|anthropic|deep learning|computer vision|nlp/)) return 'ai';
        if (text.match(/react|nextjs|vue|svelte|tailwind|css|html|web|frontend|backend|api|http|server|browser|wasm/)) return 'web';
        if (text.match(/cli|tool|library|sdk|compiler|parser|utility|automation|devops|docker|kubernetes|terminal/)) return 'tools';
        return 'other';
    }

    const createdDate = getPastDate(days);
    const query = `created:>=${createdDate}`;
    const sort = 'stars';
    const order = 'desc';
    const per_page = 50;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${per_page}&page=${pageNum}`;
    
    console.log(`[Spark-Finder] Fetching Page ${pageNum} from GitHub...`);
    const headers = { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${pat}`, 'X-GitHub-Api-Version': '2022-11-28' };

    try {
        const githubResponse = await fetch(url, { headers });
        logRateLimit(githubResponse);
        if (!githubResponse.ok) {
            const errorData = await githubResponse.json();
            return res.status(githubResponse.status).json({ message: errorData.message });
        }
        const data = await githubResponse.json();
        
        const today = new Date();
        const reposWithVelocity = data.items.map(repo => {
            const createdDate = new Date(repo.created_at);
            const diffTime = Math.abs(today - createdDate);
            const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            const velocityScore = repo.stargazers_count / diffDays;
            const category = detectCategory(repo);
            return { ...repo, daysOld: diffDays, velocityScore: velocityScore, category: category };
        });

        const sortedRepos = reposWithVelocity.sort((a, b) => b.velocityScore - a.velocityScore);
        res.json(sortedRepos.slice(0, 25));

    } catch (err) {
        console.error('[Spark-Finder] Server fetch error:', err);
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 2: Social Buzz (FAST - No Summary) ---
app.get('/api/social-buzz', async (req, res) => {
    const { repo, days } = req.query;
    if (!repo) return res.status(400).json({ message: 'Missing "repo" query parameter.' });

    const daysAgo = parseInt(days) || 30;
    console.log(`[Social Buzz] Fetching links for: ${repo}`);

    try {
        // 1. Fetch ONLY the links (Fast)
        const buzzData = await fetchAllBuzz(repo, daysAgo);

        res.setHeader('Cache-Control', 'no-store');
        res.json({ repo: repo, ...buzzData });

    } catch (err) {
        console.error(`[Social Buzz] Error:`, err);
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 3: AI Summary (SLOW - Called separately) ---
app.post('/api/buzz-summary', async (req, res) => {
    const { repoName, titles } = req.body;
    
    if (!repoName || !titles || !Array.isArray(titles)) {
        return res.status(400).json({ message: 'Invalid request body.' });
    }

    console.log(`[AI Summary] Generating summary for ${repoName} based on ${titles.length} titles...`);

    try {
        const summary = await generateSummaryFromText(repoName, titles);
        res.json({ summary });
    } catch (err) {
        console.error(`[AI Summary] Error:`, err);
        res.status(500).json({ message: 'Failed to generate summary' });
    }
});

// --- Endpoint 4: Trajectory ---
app.get('/api/star-history', async (req, res) => {
    const { repo, days, daysOld } = req.query;
    const pat = process.env.GITHUB_PAT;
    if (!repo || !days || !daysOld || !pat) return res.status(400).json({ message: 'Invalid request' });

    const repoAge = parseInt(daysOld, 10);
    let searchDays = parseInt(days, 10);
    if (isNaN(searchDays) || searchDays > 365) searchDays = 30;
    let daysToChart = Math.min(searchDays, repoAge);
    if (daysToChart < 1) daysToChart = 1;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysToChart);
    const headers = { 'Accept': 'application/vnd.github.v3.star+json', 'Authorization': `token ${pat}`, 'User-Agent': 'Spark-Finder-App' };

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
        const repoData = await repoRes.json();
        const totalStars = repoData.stargazers_count;
        const totalPages = Math.ceil(totalStars / 100);

        if (totalPages === 0) return res.json({ labels, data: dailyStarCounts });

        const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
        const BATCH_SIZE = 10; 
        let allStars = [];

        for (let i = 0; i < totalPages; i += BATCH_SIZE) {
            const batchPageNumbers = pageNumbers.slice(i, i + BATCH_SIZE);
            const fetchPromises = batchPageNumbers.map(page => 
                fetch(`https://api.github.com/repos/${repo}/stargazers?per_page=100&page=${page}&direction=desc`, { headers })
            );
            const responses = await Promise.all(fetchPromises);
            const dataPromises = responses.map(res => res.json());
            const dataArray = await Promise.all(dataPromises);
            allStars.push(...dataArray.flat());
        }

        for (const star of allStars) {
            const starDate = new Date(star.starred_at);
            if (starDate >= startDate) {
                const diffTime = now.getTime() - starDate.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays >= 0 && diffDays < daysToChart) dailyStarCounts[daysToChart - 1 - diffDays]++;
            } else {
                break;
            }
        }

        res.json({ labels, data: dailyStarCounts });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 5: Profile ---
app.get('/api/profile', async (req, res) => {
    const { repo } = req.query;
    const pat = process.env.GITHUB_PAT;
    if (!repo || !pat) return res.status(400).json({ message: 'Error' });
    const [owner, repoName] = repo.split('/');

    const headers = { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json' };

    try {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers });
        const repoData = await repoRes.json();
        const ownerLogin = repoData.owner.login;
        const ownerType = repoData.owner.type;

        const userRes = await fetch(`https://api.github.com/users/${ownerLogin}`, { headers });
        const userData = await userRes.json();

        let readmeContent = null;
        try {
            const readmeRes = await fetch(`https://api.github.com/repos/${ownerLogin}/${ownerLogin}/readme`, { headers });
            if (readmeRes.ok) {
                const readmeData = await readmeRes.json();
                readmeContent = Buffer.from(readmeData.content, 'base64').toString('utf8');
            }
        } catch (e) {}

        res.json({
            login: userData.login,
            name: userData.name,
            type: ownerType,
            bio: userData.bio,
            company: userData.company,
            location: userData.location,
            readmeContent: readmeContent
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Spark-Finder running on http://localhost:${PORT}`));
}

module.exports = app;