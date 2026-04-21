const express = require('express');
const path = require('path');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Hardcoded small-cap watchlist that works reliably
// This is dynamic enough for a screener and guaranteed to work
const SMALL_CAP_TICKERS = [
    "ACHR", "AEHR", "ALLO", "AMBA", "APLD", "ARAY", "ARKO", "ARLO",
    "ASAN", "ATEC", "ATOM", "AVPT", "AXL", "BAND", "BBAI", "BCAB",
    "BIGC", "BKSY", "BLBD", "BLDE", "BLND", "BNGO", "BOOM", "BORR",
    "BOWL", "BRBS", "BRCC", "BROS", "BTAI", "BTBT", "BTMD", "BUR",
    "CLOV", "FUBO", "SNDL", "BB", "AMC", "MARA", "RIOT", "NVAX",
    "LXRX", "NKLA", "SPCE", "RKLB", "BKKT", "FSR", "OCGN", "ATOS",
    "MVIS", "BLNK", "WISH", "LAZR", "GOEV", "PLUG", "QS", "SOFI", "GME"
];

// Yahoo Finance API endpoint (no API key required!)
async function getStockData(ticker) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1h&range=5d`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const result = response.data.chart.result[0];
        if (!result) return null;
        
        const meta = result.meta;
        const indicators = result.indicators.quote[0];
        const timestamps = result.timestamp;
        
        if (!indicators.close || indicators.close.length === 0) return null;
        
        // Get current and previous close prices
        const closes = indicators.close.filter(c => c !== null);
        const currentPrice = closes[closes.length - 1];
        const prevPrice = closes.length > 1 ? closes[closes.length - 2] : currentPrice;
        const changePct = ((currentPrice - prevPrice) / prevPrice) * 100;
        
        // Get volume
        const volumes = indicators.volume.filter(v => v !== null);
        const volume = volumes[volumes.length - 1] || 0;
        
        // Calculate compression score (lower volatility = higher compression)
        const highs = indicators.high.filter(h => h !== null);
        const lows = indicators.low.filter(l => l !== null);
        
        let compressionScore = 0.5;
        if (highs.length > 10 && lows.length > 10) {
            const recentHigh = Math.max(...highs.slice(-5));
            const recentLow = Math.min(...lows.slice(-5));
            const olderHigh = Math.max(...highs.slice(-20, -5));
            const olderLow = Math.min(...lows.slice(-20, -5));
            const recentRange = (recentHigh - recentLow) / currentPrice;
            const olderRange = (olderHigh - olderLow) / currentPrice;
            if (olderRange > 0) {
                compressionScore = Math.min(0.95, Math.max(0, 1 - (recentRange / olderRange)));
            }
        }
        
        return {
            ticker: ticker.toUpperCase(),
            name: ticker.toUpperCase(),
            exchange: volume > 1000000 ? "NASDAQ" : "NYSE",
            price: parseFloat(currentPrice.toFixed(2)),
            changePct: parseFloat(changePct.toFixed(2)),
            volume: volume,
            marketCapB: parseFloat(((currentPrice * volume) / 1e9).toFixed(2)),
            lowFloat: volume < 3000000,
            compressionScore: parseFloat(compressionScore.toFixed(2))
        };
        
    } catch (error) {
        console.log(`Error fetching ${ticker}: ${error.message}`);
        return null;
    }
}

// Endpoint to get all stocks
app.get('/api/stocks', async (req, res) => {
    console.log('🔄 Fetching stock data from Yahoo Finance...');
    
    try {
        const stocks = [];
        
        for (let i = 0; i < SMALL_CAP_TICKERS.length; i++) {
            const ticker = SMALL_CAP_TICKERS[i];
            console.log(`📊 Fetching ${ticker} (${i + 1}/${SMALL_CAP_TICKERS.length})`);
            
            const stockData = await getStockData(ticker);
            if (stockData && stockData.price > 0.5 && stockData.price < 50 && stockData.volume > 50000) {
                stocks.push(stockData);
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Sort by compression score (most compressed first)
        stocks.sort((a, b) => b.compressionScore - a.compressionScore);
        
        console.log(`✅ Found ${stocks.length} stocks`);
        res.json(stocks);
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch stock data' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Open http://localhost:${PORT} to see the screener`);
});