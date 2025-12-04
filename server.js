require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { fetchAllBuzz, generateSummaryFromText } = require('./api_logic/buzz-logic.js');

const app = express();

// --- CONFIG: The Laude List (Manual VIPs) ---
const LAUDE_VIPS = [
    // --- LEGENDS ---
    'karpathy',         // Andrej Karpathy
    'geohot',           // George Hotz
    'ggerganov',        // Georgi Gerganov (llama.cpp)
    'antirez',          // Salvatore Sanfilippo (Redis)
    'shreyashankar',    // ML Ops Researcher
    'jxnl',             // Jason Liu
    'hwchase17',        // Harrison Chase (LangChain)
    'carlini',          // Nicholas Carlini (Google DeepMind/Brain)

    // --- TERMINAL BENCH / LAUDE ECOSYSTEM ---
    'laude-institute',  // Creators of TerminalBench 2.0
    'TheMikeMerrill',   // Co-Creator of TerminalBench
    'alexgshaw',        // Co-Creator of TerminalBench (Laude)
    'Jaluus',           // Jan-Lucas Uslu (Stanford, TBench Lead)
    'harshraj172',      // Harsh Raj (Harbor/TBench Contributor)
    'ibercovich',       // Ivan Bercovich (Active TBench Contributor)
    'YanhaoLi-Cc',      // Top contributor to TerminalBench
    'kobe0938'          // Top contributor to TerminalBench
];

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

// --- Endpoint 1.5: The Laude List (Active + Fresh + Descriptive) ---
app.get('/api/laude-list', async (req, res) => {
    const pat = process.env.GITHUB_PAT;
    if (!pat) return res.status(500).json({ message: 'GitHub PAT missing.' });

    // 1. Define Time Limits
    const activeLimit = new Date();
    activeLimit.setDate(activeLimit.getDate() - 30); // Must be active recently

    const freshnessLimit = new Date();
    freshnessLimit.setDate(freshnessLimit.getDate() - 90); // Must be LESS than 90 days old

    console.log(`[Laude List] Fetching activity for ${LAUDE_VIPS.length} VIPs...`);

    try {
        // 2. PARALLEL FETCH
        const requests = LAUDE_VIPS.map(user => 
            fetch(`https://api.github.com/users/${user}/repos?sort=pushed&direction=desc&per_page=10`, {
                headers: { 
                    'Accept': 'application/vnd.github.v3+json', 
                    'Authorization': `token ${pat}` 
                }
            })
            .then(res => res.ok ? res.json() : [])
            .catch(err => [])
        );

        const resultsArrays = await Promise.all(requests);
        let allRepos = resultsArrays.flat();

        // 3. THE TRIPLE FILTER (Active + Fresh + Description)
        const curatedRepos = allRepos.filter(repo => {
            const pushedDate = new Date(repo.pushed_at);
            const createdDate = new Date(repo.created_at);
            
            // Rule 1: Must be active in the last 30 days
            const isActive = pushedDate >= activeLimit;
            
            // Rule 2: Must be created in the last 90 days
            const isFresh = createdDate >= freshnessLimit;

            // Rule 3: Must have a description (NEW)
            const hasDescription = repo.description && repo.description.trim().length > 0;

            return isActive && isFresh && hasDescription;
        });

        // 4. SORT (Stars)
        curatedRepos.sort((a, b) => b.stargazers_count - a.stargazers_count);

        // 5. Format for Frontend
        const today = new Date();
        const formattedResults = curatedRepos.map(repo => {
            const createdDate = new Date(repo.created_at);
            const diffDays = Math.max(1, Math.ceil(Math.abs(today - createdDate) / (1000 * 60 * 60 * 24)));
            
            let category = 'other';
            const text = ((repo.name || '') + ' ' + (repo.description || '')).toLowerCase();
            if (text.match(/agent|autonomous/)) category = 'agents';
            else if (text.match(/ai|gpt|llm|transformer/)) category = 'ai';
            else if (text.match(/web|react/)) category = 'web';
            else if (text.match(/tool|cli/)) category = 'tools';

            return { 
                ...repo, 
                daysOld: diffDays, 
                velocityScore: repo.stargazers_count / diffDays, 
                category,
                isLaude: true 
            };
        });

        console.log(`[Laude List] Processed ${allRepos.length} repos -> Found ${formattedResults.length} high-quality.`);
        res.json(formattedResults);

    } catch (err) {
        console.error('[Laude List] Error:', err);
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
    console.log("[Sentry] Starting rigorous scan...");
    
    if (!supabase || !resend) {
        console.error("[Sentry] Abort: Missing DB or Email service.");
        return res.status(500).json({ message: "Services not ready." });
    }

    // --- HELPER: Academic Detection ---
    function isResearcher(user) {
        const text = ((user.bio || '') + ' ' + (user.company || '') + ' ' + (user.email || '')).toLowerCase();
        const academicKeywords = [
            'lab', 'research', 'institute', 'university', 'college', 'school', 'academy',
            'phd', 'candidate', 'student', 'professor', 'fellow', 'scientist',
            'berkeley', 'mit', 'stanford', 'cmu', 'harvard', 'oxford', 'cambridge',
            '.edu', 'alumni'
        ];
        return academicKeywords.some(keyword => text.includes(keyword));
    }

    try {
        // 1. SEARCH PHASE
        const daysAgo = 3;
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        const dateStr = date.toISOString().split('T')[0];
        
        const pat = process.env.GITHUB_PAT;
        const query = `pushed:>=${dateStr}`;
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`;
        
        const githubRes = await fetch(url, { headers: { 'Authorization': `token ${pat}` } });
        const data = await githubRes.json();
        const repos = data.items || [];

        // 2. FILTER PHASE: The Gauntlet
        const winners = []; // CHANGED: Now an array to hold multiple sparks

        for (const repo of repos) {
            console.log(`[Sentry] Inspecting candidate: ${repo.full_name}...`);

            // CHECK A: Velocity (> 70 stars/day)
            const createdDate = new Date(repo.created_at);
            const today = new Date();
            const daysOld = Math.max(1, Math.ceil(Math.abs(today - createdDate) / (1000 * 60 * 60 * 24)));
            const velocity = repo.stargazers_count / daysOld;

            if (velocity < 70) { console.log(`   -> Failed Velocity`); continue; }

            // CHECK B: User Type
            if (repo.owner.type !== 'User') { console.log(`   -> Failed Type`); continue; }

            // CHECK C: Dedup (History)
            const { data: sentLogs } = await supabase.from('sent_logs').select('repo_name').eq('repo_name', repo.full_name);
            if (sentLogs && sentLogs.length > 0) { console.log(`   -> Failed: Already sent`); continue; }

            // CHECK D: Researcher
            const userRes = await fetch(repo.owner.url, { headers: { 'Authorization': `token ${pat}` } });
            const userProfile = await userRes.json();
            if (!isResearcher(userProfile)) { console.log(`   -> Failed Identity`); continue; }

            // CHECK E: Commits
            const commitsRes = await fetch(`https://api.github.com/repos/${repo.full_name}/commits?per_page=6`, { headers: { 'Authorization': `token ${pat}` } });
            const commits = await commitsRes.json();
            if (!Array.isArray(commits) || commits.length < 5) { console.log(`   -> Failed Activity`); continue; }

            // CHECK F: Buzz
            const buzz = await fetchAllBuzz(repo.full_name, 30);
            const totalBuzz = buzz.hackerNewsPosts.length + buzz.redditPosts.length + buzz.twitterPosts.length;
            if (totalBuzz === 0) { console.log(`   -> Failed Buzz`); continue; }

            // IF WE MADE IT HERE: ADD TO WINNERS
            console.log(`[Sentry] WINNER FOUND: ${repo.full_name}`);
            winners.push(repo); 
            // REMOVED: break; (Now it keeps looking!)
        }

        if (winners.length === 0) {
            console.log("[Sentry] No candidates passed the gauntlet.");
            return res.json({ message: "No sparks passed validation." });
        }

        // 3. ALERT PHASE: Send Emails for EACH Winner
        const { data: subscribers } = await supabase.from('subscribers').select('email');
        if (!subscribers || subscribers.length === 0) return res.json({ message: "No subscribers." });

        let emailsSent = 0;

        // Loop through every winner found
        for (const winner of winners) {
            
            // Loop through every subscriber
            for (const sub of subscribers) {
                await resend.emails.send({
                    from: 'Spark-Finder Sentry <system@sentry.livelaughlau.de>',
                    to: sub.email,
                    subject: `Spark Detected: ${winner.full_name} (Researcher)`, 
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
                        .stat-cell { display: table-cell; width: 33%; padding: 15px; border-right: 1px solid #374151; text-align: center; }
                        .stat-cell:last-child { border-right: none; }
                        .stat-label { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 4px; }
                        .stat-value { color: #e9de97; font-size: 18px; font-weight: 700; }
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
                          <div class="badge">ACADEMIC SPARK DETECTED</div>
                        </div>
                        <div class="content">
                          <h2 class="repo-name">${winner.full_name}</h2>
                          <p class="description">${winner.description || 'No description provided.'}</p>
                          <div class="stats-grid">
                            <div class="stat-cell">
                              <div class="stat-label">Stars</div>
                              <div class="stat-value">${winner.stargazers_count}</div>
                            </div>
                            <div class="stat-cell">
                              <div class="stat-label">Daily Vel</div>
                              <div class="stat-value">${(winner.stargazers_count / 3).toFixed(0)}+</div>
                            </div>
                            <div class="stat-cell">
                              <div class="stat-label">Type</div>
                              <div class="stat-value">Researcher</div>
                            </div>
                          </div>
                          <div class="btn-container">
                            <a href="${winner.html_url}" class="btn">View Research</a>
                          </div>
                        </div>
                        <div class="footer">
                          Sentry Alert • Traction Threshold Met<br/>
                          <a href="#">Unsubscribe</a>
                        </div>
                      </div>
                    </body>
                    </html>
                    `
                });
            }
            
            // Log to History so we don't send again
            await supabase.from('sent_logs').insert([{ repo_name: winner.full_name }]);
            emailsSent++;
        }

        res.json({ message: `Sent ${emailsSent} alerts to ${subscribers.length} users.` });

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