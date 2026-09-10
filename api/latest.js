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
            
            if (!existing || existing.episode !== item.episode) {
                newUpdates.push(item);
                
                await collection.updateOne(
                    { postLink: item.postLink },
                    { $set: { ...item, lastUpdated: new Date() } },
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
