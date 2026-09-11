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

// Function to fetch download links for a single show via Proxy
async function fetchShowDetails(postUrl, proxyUrl) {
    try {
        const response = await axios.get(proxyUrl + encodeURIComponent(postUrl), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);
        
        // Yahan hum show page se download links nikalenge
        // Mkvdrama.net par download links 'a.ts-wpop-link' ya '.dl-link' mein hote hain
        const downloads = [];
        $('.listnya a, .dl-link, a.ts-wpop-link').each((i, el) => {
            const quality = $(el).text().trim(); // e.g., 540p, 720p
            const link = $(el).attr('href');
            if (link && quality) {
                downloads.push({ quality, link });
            }
        });

        return downloads.length > 0 ? downloads : "No download links found in HTML";

    } catch (error) {
        console.error(`Error fetching details for ${postUrl}:`, error.message);
        return [];
    }
}

export default async function handler(req, res) {
    try {
        // Apni Cloudflare Worker ka URL yahan daal
        const proxyUrl = 'https://mk-ke-liye.aakigopro1470.workers.dev/?url=';
        const targetUrl = 'https://mkvdrama.net/';
        
        // Request CF Worker ke through bhejna
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

        // MongoDB Connection
        const db = await connectToDatabase();
        const collection = db.collection('episodes');
        const newUpdates = [];

        for (let item of scrapedItems) {
            const existing = await collection.findOne({ postLink: item.postLink });
            
            // Agar DB mein nahi hai, ya purana episode alag hai, toh naya maano
            if (!existing || existing.episode !== item.episode) {
                
                // Naye episode ke liye download links bypass karke nikal lo
                console.log(`Fetching download links for: ${item.title}`);
                const downloadLinks = await fetchShowDetails(item.postLink, proxyUrl);
                
                // Final object mein download links add kar do
                const finalItem = {
                    ...item,
                    downloads: downloadLinks
                };

                newUpdates.push(finalItem);
                
                // MongoDB mein update/insert karo
                await collection.updateOne(
                    { postLink: item.postLink },
                    { $set: { ...finalItem, lastUpdated: new Date() } },
                    { upsert: true }
                );
            }
        }

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
