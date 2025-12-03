require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { fetchAllBuzz, generateSummaryFromText } = require('./api_logic/buzz-logic.js');

const app = express();

// --- Middleware ---
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. INITIALIZE EXTERNAL SERVICES ---

// A. Supabase (The Memory)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase = null;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("[Spark-Finder] Supabase initialized.");
} else {
    console.warn("[Spark-Finder] WARNING: Supabase keys missing. Database features will fail.");
}

// B. Resend (The Courier)
const resendKey = process.env.RESEND_API_KEY;
let resend = null;

if (resendKey) {
    resend = new Resend(resendKey);
    console.log("[Spark-Finder] Resend initialized.");
} else {
    console.warn("[Spark-Finder] WARNING: RESEND_API_KEY missing. Sentry emails will not send.");
}

// --- Helper: GitHub Rate Limit Logger ---
function logRateLimit(response) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining) {
        const remainingNum = parseInt(remaining, 10);
        if (remainingNum % 100 === 0 || remainingNum < 100) {
            console.log(`[GitHub API] Tokens Remaining: ${remainingNum.toLocaleString()}`);
        }
    }
}

// ==========================================
//               CORE ENDPOINTS
// ==========================================

// --- Endpoint 1: The Velocity Search ---
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
        if (text.match(/agent|autonomous|agentic|swarm|multi-agent|robotics|copilot|assistant/)) return 'agents';
        if (text.match(/ai|gpt|llm|machine learning|neural|diffusion|transformer|rag|openai|llama|anthropic/)) return 'ai';
        if (text.match(/react|nextjs|vue|svelte|tailwind|css|html|web|frontend|backend|api|http/)) return 'web';
        if (text.match(/cli|tool|library|sdk|compiler|parser|utility|automation|devops|docker/)) return 'tools';
        return 'other';
    }

    const createdDate = getPastDate(days);
    const query = `created:>=${createdDate}`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=50&page=${pageNum}`;
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
            return { ...repo, daysOld: diffDays, velocityScore: velocityScore, category: detectCategory(repo) };
        });

        const sortedRepos = reposWithVelocity.sort((a, b) => b.velocityScore - a.velocityScore);
        res.json(sortedRepos.slice(0, 25));

    } catch (err) {
        console.error('[Spark-Finder] Search Error:', err);
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 2: Social Buzz ---
app.get('/api/social-buzz', async (req, res) => {
    const { repo, days } = req.query;
    if (!repo) return res.status(400).json({ message: 'Missing repo' });
    const daysAgo = parseInt(days) || 30;
    try {
        const buzzData = await fetchAllBuzz(repo, daysAgo);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ repo: repo, ...buzzData });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// --- Endpoint 3: AI Summary ---
app.post('/api/buzz-summary', async (req, res) => {
    const { repoName, titles } = req.body;
    if (!repoName || !titles) return res.status(400).json({ message: 'Invalid body' });
    try {
        const summary = await generateSummaryFromText(repoName, titles);
        res.json({ summary });
    } catch (err) {
        res.status(500).json({ message: 'Summary failed' });
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
    const headers = { 'Accept': 'application/vnd.github.v3.star+json', 'Authorization': `token ${pat}` };

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
        const userRes = await fetch(`https://api.github.com/users/${repoData.owner.login}`, { headers });
        const userData = await userRes.json();
        let readmeContent = null;
        try {
            const readmeRes = await fetch(`https://api.github.com/repos/${repoData.owner.login}/${repoData.owner.login}/readme`, { headers });
            if (readmeRes.ok) {
                const readmeData = await readmeRes.json();
                readmeContent = Buffer.from(readmeData.content, 'base64').toString('utf8');
            }
        } catch (e) {}
        res.json({
            login: userData.login,
            name: userData.name,
            type: repoData.owner.type,
            bio: userData.bio,
            company: userData.company,
            location: userData.location,
            readmeContent: readmeContent
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==========================================
//           BLINKING RED (SENTRY)
// ==========================================

// --- Endpoint 6: Subscribe ---
app.post('/api/subscribe', async (req, res) => {
    const { email } = req.body;
    if (!supabase) return res.status(500).json({ message: 'Database disconnected.' });
    if (!email || !email.includes('@')) return res.status(400).json({ message: 'Invalid email.' });

    try {
        const { data, error } = await supabase
            .from('subscribers')
            .insert([{ email: email, status: 'active' }])
            .select();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ message: 'Email already subscribed.' });
            throw error;
        }
        console.log(`[Sentry] Armed for: ${email}`);
        res.json({ message: 'Sentry armed successfully.', user: data });
    } catch (err) {
        console.error('[Sentry] DB Error:', err);
        res.status(500).json({ message: 'Database error.' });
    }
});

// --- Endpoint 7: Unsubscribe ---
app.post('/api/unsubscribe', async (req, res) => {
    const { email } = req.body;
    if (!supabase) return res.status(500).json({ message: 'Database disconnected.' });

    try {
        const { error } = await supabase.from('subscribers').delete().eq('email', email);
        if (error) throw error;
        console.log(`[Sentry] Disarmed for: ${email}`);
        res.json({ message: 'Sentry disarmed.' });
    } catch (err) {
        console.error('[Sentry] Unsubscribe Error:', err);
        res.status(500).json({ message: 'Failed to disarm.' });
    }
});

// --- Endpoint 8: The Automatic Scanner (CRON Job) ---
app.get('/api/sentry-scan', async (req, res) => {
    console.log("[Sentry] Starting scan...");
    if (!supabase || !resend) {
        console.error("[Sentry] Abort: Missing DB or Email service.");
        return res.status(500).json({ message: "Services not ready." });
    }

    try {
        // 1. Fetch Fresh High-Velocity Repos (Last 3 days)
        const daysAgo = 3;
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        const dateStr = date.toISOString().split('T')[0];
        
        const pat = process.env.GITHUB_PAT;
        const query = `created:>=${dateStr}`;
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`;
        
        const githubRes = await fetch(url, { headers: { 'Authorization': `token ${pat}` } });
        const data = await githubRes.json();
        const repos = data.items || [];

        // 2. Filter: "Traction Threshold" (>150 stars in 3 days)
        // TIP: Change 150 to 1 if you want to test receiving an email right now
        const highValueRepos = repos.filter(repo => repo.stargazers_count > 150);

        if (highValueRepos.length === 0) {
            console.log("[Sentry] No new high-velocity repos.");
            return res.json({ message: "No sparks found." });
        }

        // 3. Dedup: Check History Log
        const { data: sentLogs } = await supabase.from('sent_logs').select('repo_name');
        const sentNames = new Set((sentLogs || []).map(l => l.repo_name));
        const newSparks = highValueRepos.filter(repo => !sentNames.has(repo.full_name));

        if (newSparks.length === 0) {
            console.log("[Sentry] Sparks found, but already emailed.");
            return res.json({ message: "All sparks already sent." });
        }

        // 4. Select Winner (Top 1 only)
        const winner = newSparks[0];
        console.log(`[Sentry] ALERT TRIGGERED: ${winner.full_name}`);

        // 5. Fetch Subscribers
        const { data: subscribers } = await supabase.from('subscribers').select('email');
        if (!subscribers || subscribers.length === 0) return res.json({ message: "No subscribers." });

        // 6. Send Emails (Professional "Spark Detected" Template)
        for (const sub of subscribers) {
            await resend.emails.send({
                from: 'Spark-Finder Sentry <system@sentry.livelaughlau.de>', // Keep default for Free Tier
                to: sub.email,
                subject: `Spark Detected: ${winner.full_name} is trending`, 
                html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <style>
                    body { background-color: #0f1117; margin: 0; padding: 0; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
                    .container { max-width: 600px; margin: 40px auto; background: #1f2937; border: 1px solid #374151; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
                    .header { background: #111827; padding: 30px 20px; text-align: center; border-bottom: 1px solid #374151; }
                    .logo { color: #7592fd; font-weight: 800; font-size: 20px; letter-spacing: -0.5px; text-transform: uppercase; margin: 0; }
                    .badge { display: inline-block; background: rgba(233, 222, 151, 0.15); color: #e9de97; font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 4px; margin-top: 10px; border: 1px solid rgba(233, 222, 151, 0.3); }
                    .content { padding: 30px 40px; }
                    .repo-name { color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 10px; }
                    .description { color: #9ca3af; font-size: 15px; line-height: 1.6; margin-bottom: 25px; }
                    .stats-grid { display: table; width: 100%; margin-bottom: 30px; background: #111827; border-radius: 8px; border: 1px solid #374151; }
                    .stat-cell { display: table-cell; width: 50%; padding: 15px; border-right: 1px solid #374151; text-align: center; }
                    .stat-cell:last-child { border-right: none; }
                    .stat-label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 4px; }
                    .stat-value { color: #e9de97; font-size: 20px; font-weight: 700; }
                    .btn-container { text-align: center; margin-top: 10px; }
                    .btn { background: #7592fd; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 15px; transition: background 0.2s; }
                    .footer { text-align: center; padding: 30px 20px; color: #6b7280; font-size: 12px; line-height: 1.5; }
                    .footer a { color: #6b7280; text-decoration: underline; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header">
                      <p class="logo">⚡ Spark-Finder</p>
                      <div class="badge">TRACTION THRESHOLD MET</div>
                    </div>
                    <div class="content">
                      <h2 class="repo-name">${winner.full_name}</h2>
                      <p class="description">${winner.description || 'No description provided.'}</p>
                      <div class="stats-grid">
                        <div class="stat-cell">
                          <div class="stat-label">Total Stars</div>
                          <div class="stat-value">${winner.stargazers_count.toLocaleString()}</div>
                        </div>
                        <div class="stat-cell">
                          <div class="stat-label">Traction</div>
                          <div class="stat-value">High</div>
                        </div>
                      </div>
                      <div class="btn-container">
                        <a href="${winner.html_url}" class="btn">View Repository</a>
                      </div>
                    </div>
                    <div class="footer">
                      You received this because you subscribed to Spark-Finder alerts.<br/>
                      <a href="#">Unsubscribe</a>
                    </div>
                  </div>
                </body>
                </html>
                `
            });
        }

        // 7. Log to History
        await supabase.from('sent_logs').insert([{ repo_name: winner.full_name }]);

        res.json({ message: `Sent alert for ${winner.full_name} to ${subscribers.length} users.` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- Start Server ---
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Spark-Finder running on http://localhost:${PORT}`));
}

module.exports = app;