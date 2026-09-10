const axios = require('axios');
const cheerio = require('cheerio');

export default async function handler(req, res) {
    try {
        // Direct latest page scrape karna (Page 1)
        const response = await axios.get('https://mkvdrama.net/titles?status=&type=&order=latest&page=1', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);
        
        const allShows = [];
        
        // All shows list parse karna
        $('article.bs').each((i, el) => {
            const a = $(el).find('a.tip');
            const link = a.attr('href');
            const title = a.attr('title');
            const episodeText = $(el).find('.epx').text().trim();
            
            if (link && title) {
                allShows.push({
                    postLink: `https://mkvdrama.net${link}`,
                    title: title,
                    episode: episodeText
                });
            }
        });

        res.status(200).json({
            success: true,
            count: allShows.length,
            shows: allShows
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Scraping failed", details: error.message });
    }
}
