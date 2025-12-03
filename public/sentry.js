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
        // Keywords for Schools, Labs, and Research Institutes
        const academicKeywords = [
            'lab', 'research', 'institute', 'university', 'college', 'school', 'academy',
            'phd', 'candidate', 'student', 'professor', 'fellow', 'scientist',
            'berkeley', 'mit', 'stanford', 'cmu', 'harvard', 'oxford', 'cambridge',
            '.edu', 'alumni'
        ];
        return academicKeywords.some(keyword => text.includes(keyword));
    }

    try {
        // 1. SEARCH PHASE: Fetch Fresh Repos (Strictly <= 3 days old)
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

        // 2. FILTER PHASE: The Gauntlet
        // We process candidates one by one to save API tokens. First match wins.
        let winner = null;

        for (const repo of repos) {
            console.log(`[Sentry] Inspecting candidate: ${repo.full_name}...`);

            // CHECK A: Age & Velocity (At least 70 stars/day)
            // Since max age is 3 days, we can just check total stars >= (70 * daysOld)
            // But simplified: If it has > 210 stars in 3 days, it definitely meets the bar.
            // Let's stick to the user's explicit math:
            const createdDate = new Date(repo.created_at);
            const today = new Date();
            const daysOld = Math.max(1, Math.ceil(Math.abs(today - createdDate) / (1000 * 60 * 60 * 24)));
            const velocity = repo.stargazers_count / daysOld;

            if (velocity < 70) {
                console.log(`   -> Failed Velocity: ${velocity.toFixed(1)}/day`);
                continue;
            }

            // CHECK B: Individual User (Not Organization)
            if (repo.owner.type !== 'User') {
                console.log(`   -> Failed Type: Is Organization`);
                continue;
            }

            // CHECK C: Check History Log (Dedup)
            const { data: sentLogs } = await supabase.from('sent_logs').select('repo_name').eq('repo_name', repo.full_name);
            if (sentLogs && sentLogs.length > 0) {
                console.log(`   -> Failed: Already sent`);
                continue;
            }

            // --- API HEAVY CHECKS START HERE ---

            // CHECK D: Researcher Affiliation
            // Fetch User Profile
            const userRes = await fetch(repo.owner.url, { headers: { 'Authorization': `token ${pat}` } });
            const userProfile = await userRes.json();
            
            if (!isResearcher(userProfile)) {
                console.log(`   -> Failed Identity: Not clearly a researcher`);
                continue; 
            }

            // CHECK E: Commit Activity (> 5 commits)
            // We fetch the last 6 commits to be safe
            const commitsRes = await fetch(`https://api.github.com/repos/${repo.full_name}/commits?per_page=6`, { headers: { 'Authorization': `token ${pat}` } });
            const commits = await commitsRes.json();
            
            // Note: If repo is empty, commits might be message object or empty array
            if (!Array.isArray(commits) || commits.length < 5) {
                console.log(`   -> Failed Activity: Only ${commits.length || 0} commits`);
                continue;
            }

            // CHECK F: Social Buzz (Must have ANY mentions)
            // We reuse your existing logic.
            const buzz = await fetchAllBuzz(repo.full_name, 30); // Check last 30 days of buzz
            const totalBuzz = buzz.hackerNewsPosts.length + buzz.redditPosts.length + buzz.twitterPosts.length;

            if (totalBuzz === 0) {
                console.log(`   -> Failed Buzz: Silence on social media`);
                continue;
            }

            // IF WE MADE IT HERE: WE HAVE A WINNER
            winner = repo;
            console.log(`[Sentry] WINNER FOUND: ${repo.full_name}`);
            break; // Stop looking, we only send 1 alert per scan
        }

        if (!winner) {
            console.log("[Sentry] No candidates passed the gauntlet.");
            return res.json({ message: "No sparks passed validation." });
        }

        // 3. ALERT PHASE: Send Emails
        const { data: subscribers } = await supabase.from('subscribers').select('email');
        if (!subscribers || subscribers.length === 0) return res.json({ message: "No subscribers." });

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

        // 4. Log to History
        await supabase.from('sent_logs').insert([{ repo_name: winner.full_name }]);

        res.json({ message: `Sent academic alert for ${winner.full_name}.` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});