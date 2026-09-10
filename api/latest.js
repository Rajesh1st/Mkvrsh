const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

// Vercel mein MongoDB URI Environment Variable mein daalna
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
        // Mkvdrama homepage scrape karna
        const response = await axios.get('https://mkvdrama.net/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);
        
        const scrapedItems = [];
        
        // Latest Releases section parse karna
        $('.listupd .bs').each((i, el) => {
            const a = $(el).find('a.tip');
            const link = a.attr('href'); // e.g., /ok-let-s-get-divorced-gei3xjgp
            const title = a.attr('title');
            const episodeText = $(el).find('.epx').text().trim(); // e.g., EP 7 or Completed
            
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

        // MongoDB se check karna ki kya naya episode aaya hai
        const db = await connectToDatabase();
        const collection = db.collection('episodes');
        const newUpdates = [];

        for (let item of scrapedItems) {
            // Database mein is show ka purana record dekho
            const existing = await collection.findOne({ postLink: item.postLink });
            
            // Agar record nahi hai, ya purana episode alag hai, toh yeh "NEW" update hai
            if (!existing || existing.episode !== item.episode) {
                newUpdates.push(item);
                
                // Database update karo taake next time yeh "old" na dikhe
                await collection.updateOne(
                    { postLink: item.postLink },
                    { $set: { ...item, lastUpdated: new Date() } },
                    { upsert: true }
                );
            }
        }

        // Sirf naye updates return karna
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
