const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) return cachedDb;
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    cachedDb = client.db('mkvdrama');
    return cachedDb;
}

// Tere Python script wale API ko call karne ke liye function
async function fetchShowDetails(postUrl) {
    try {
        const response = await axios.get('https://mkv-drama-scraper.vercel.app/get', {
            params: {
                url: postUrl
            },
            headers: {
                'X-API-Key': 'animecall_0131M3V5iT35R4p1ng' // Tera token yahan use ho gaya
            },
            timeout: 12000
        });
        
        // Jo response aayega usme se sirf downloads wala part nikal lo
        if (response.data && response.data.bypassed_url && response.data.bypassed_url.downloads) {
            return response.data.bypassed_url.downloads;
        }
        return "No downloads found";

    } catch (error) {
        console.error(`Error fetching details for ${postUrl}:`, error.message);
        return null;
    }
}

export default async function handler(req, res) {
    try {
        // Homepage scrape karne ke liye apna CF Worker proxy (yeh wahi rahega)
        const proxyUrl = 'https://mk-ke-liye.aakigopro1470.workers.dev/?url=';
        const targetUrl = 'https://mkvdrama.net/';
        
        // 1. Pehle homepage se latest shows ki list lao
        const response = await axios.get(proxyUrl + encodeURIComponent(targetUrl), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        const $ = cheerio.load(response.data);
        const scrapedItems = [];
        
        $('.listupd .bs').each((i, el) => {
            const a = $(el).find('a.tip');
            const link = a.attr('href');
            const title = a.attr('title');
            const episodeText = $(el).find('.epx').text().trim();
            
            if (link && title) {
                scrapedItems.push({
                    postLink: `https://mkvdrama.net${link}`,
                    title: title,
                    episode: episodeText
                });
            }
        });

        if (scrapedItems.length === 0) {
            return res.status(200).json({ success: true, newUpdates: [], message: "No items found" });
        }

        // 2. MongoDB se check karo kya naya aaya hai
        const db = await connectToDatabase();
        const collection = db.collection('episodes');
        const newUpdates = [];

        for (let item of scrapedItems) {
            const existing = await collection.findOne({ postLink: item.postLink });
            
            if (!existing || existing.episode !== item.episode) {
                
                // 3. Agar naya episode hai, toh teri Python wali API se links laao
                console.log(`Fetching download links for: ${item.title}`);
                const downloadLinks = await fetchShowDetails(item.postLink);
                
                const finalItem = {
                    ...item,
                    downloads: downloadLinks
                };

                newUpdates.push(finalItem);
                
                // 4. MongoDB update karo
                await collection.updateOne(
                    { postLink: item.postLink },
                    { $set: { ...finalItem, lastUpdated: new Date() } },
                    { upsert: true }
                );
            }
        }

        // 5. Final response bhejo
        res.status(200).json({
            success: true,
            count: newUpdates.length,
            newUpdates: newUpdates
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Scraping failed", details: error.message });
    }
}
