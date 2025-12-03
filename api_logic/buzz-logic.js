//
// === api_logic/buzz-logic.js ===
//
const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Google Gemini Client
// using 'gemini-2.5-flash' which is the current stable version for v1beta
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); 

// --- Helper 1: Get Reddit Time Filter ---
function getRedditTimeFilter(days) {
    if (days <= 1) return 'day';
    if (days <= 7) return 'week';
    if (days <= 30) return 'month';
    if (days <= 365) return 'year';
    return 'all'; 
}

// --- Helper 2: Hacker News ---
const fetchHackerNews = async (repoName, hnTimestamp) => {
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

// --- Helper 3: Reddit ---
const fetchReddit = async (repoName, daysAgo) => {
    const query = `"${repoName}"`;
    const redditTimeFilter = getRedditTimeFilter(daysAgo);
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&t=${redditTimeFilter}`;
    
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'web:spark-finder:v1.0 (by /u/Key-Memory2999)' } }); 
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

// --- Helper 4: X/Twitter ---
const fetchTwitter = async (repoName, daysAgo) => {
    const BEARER_TOKEN = process.env.X_BEARER_TOKEN;
    if (!BEARER_TOKEN) return [];

    // Cap at 7 days for Basic Tier
    const effectiveDays = Math.min(daysAgo, 7); 
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - effectiveDays);
    const isoDate = startTime.toISOString();

    const query = `"${repoName}" lang:en -is:retweet -from:nileshb4u`;
    const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&tweet.fields=public_metrics&max_results=50&start_time=${isoDate}`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${BEARER_TOKEN}` }
        });

        if (!response.ok) return [];
        
        const data = await response.json();
        if (!data.data) return [];
        
        console.log(`[Social Buzz] Found ${data.data.length} Twitter posts.`);
        
        return data.data.map(tweet => ({
            title: tweet.text, 
            url: `https://x.com/any/status/${tweet.id}`,
            score: tweet.public_metrics.like_count 
        }));

    } catch (err) {
        console.error('[Social Buzz] X/Twitter Fetch Error:', err.message);
        return [];
    }
}; 

// --- Helper 5: AI Summarizer (Updated for Insight) ---
async function generateSummary(repoName, hn, reddit, twitter) {
    const allTexts = [
        ...hn.slice(0, 8).map(p => `HN: ${p.title}`),
        ...reddit.slice(0, 8).map(p => `Reddit: ${p.title}`),
        ...twitter.slice(0, 8).map(p => `Tweet: ${p.title}`)
    ];

    if (allTexts.length === 0) return null;

    // --- THE NEW "SPIKE HUNTER" PROMPT ---
    const prompt = `
    Analyze these social media discussions about the project "${repoName}".
    
    Your Goal: Identify the specific reason for the recent spike in attention.
    
    Do NOT just describe what the project does.
    Do NOT use filler words like "Users are discussing" or "The sentiment is".
    
    Instead, answer:
    1. Did they release a new feature? (e.g., "Released v2 with vision support")
    2. Is there a controversy? (e.g., "Users debating the license change")
    3. Is it a comparison? (e.g., "Seen as a faster alternative to Pandas")
    
    Output ONE concise sentence (max 25 words) that explains the *reason* for the buzz.
    
    Posts:
    ${allTexts.join('\n')}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        return text.replace(/^"|"$/g, '').trim();

    } catch (err) {
        console.error("[Social Buzz] AI Summary Failed:", err.message);
        return null;
    }
}

// --- Main Exported Function ---
async function fetchAllBuzz(repo, daysAgo) {
    
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - daysAgo);
    const hnTimestamp = Math.floor(dateLimit.getTime() / 1000);

    const [hnPosts, redditPosts, twitterPosts] = await Promise.all([
        fetchHackerNews(repo, hnTimestamp),
        fetchReddit(repo, daysAgo),
        fetchTwitter(repo, daysAgo)
    ]);

    let aiSummary = null;
    if (hnPosts.length > 0 || redditPosts.length > 0 || twitterPosts.length > 0) {
        aiSummary = await generateSummary(repo, hnPosts, redditPosts, twitterPosts);
    }

    return {
        summary: aiSummary,
        hackerNewsPosts: hnPosts,
        redditPosts: redditPosts,
        twitterPosts: twitterPosts
    };
}

module.exports = { fetchAllBuzz };