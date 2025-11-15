//
// === PASTE THIS into api_logic/buzz-logic.js ===
//
const fetch = require('node-fetch');

// --- Helper 1: Get Reddit Time Filter ---
// (Moved from server.js)
function getRedditTimeFilter(days) {
    if (days <= 1) return 'day';
    if (days <= 7) return 'week';
    if (days <= 30) return 'month';
    if (days <= 365) return 'year';
    return 'all'; // For 'All Time' or > 365 days
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
        // !! Remember to put your own Reddit username here
        const response = await fetch(url, { headers: { 'User-Agent': 'web:spark-finder:v1.0 (by /u/Key-Memory2999)' } }); 
        if (!response.ok) return [];
        const data = await response.json();
        console.log(`[Social Buzz] Found ${data.data.children.length} Reddit posts.`);
        
        return data.data.children.map(child => ({
            title: child.data.title,
            url: `https.reddit.com${child.data.permalink}`,
            score: child.data.score
        }));

    } catch (err) {
        console.error('[Social Buzz] Reddit Error:', err.message);
        return [];
    }
};

// --- Helper 4: X/Twitter ---
const fetchTwitter = async (repoName) => {
    const BEARER_TOKEN = process.env.X_BEARER_TOKEN;
    if (!BEARER_TOKEN) {
        console.error('[Social Buzz] X_BEARER_TOKEN not set.');
        return [];
    }

    const query = `"${repoName}" lang:en -is:retweet -from:nileshb4u`;

    // --- THIS IS THE CORRECTED LINE ---
    const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&tweet.fields=public_metrics&max_results=50`;
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${BEARER_TOKEN}`
            }
        });

        if (!response.ok) {
            const err = await response.json();
            console.error('[Social Buzz] X/Twitter Error:', err);
            return [];
        }
        
        const data = await response.json();
        
        if (!data.data) {
            console.log(`[Social Buzz] Found 0 Twitter posts.`);
            return [];
        }
        
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

// --- Main Exported Function ---
// This is the only function that server.js will call
async function fetchAllBuzz(repo, daysAgo) {
    
    // Calculate timestamp for HN
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - daysAgo);
    const hnTimestamp = Math.floor(dateLimit.getTime() / 1000);

    // Run all three searches in parallel
    const [hnPosts, redditPosts, twitterPosts] = await Promise.all([
        fetchHackerNews(repo, hnTimestamp),
        fetchReddit(repo, daysAgo),
        fetchTwitter(repo)
    ]);

    // Return the clean data object
    return {
        hackerNewsPosts: hnPosts,
        redditPosts: redditPosts,
        twitterPosts: twitterPosts
    };
}

// Export just that one function
module.exports = { fetchAllBuzz };