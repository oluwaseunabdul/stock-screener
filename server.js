const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Axios instance with a 10-second timeout so a slow/hung Yahoo Finance
// request never blocks the event loop indefinitely.
const http = axios.create({
  timeout: 10_000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; stock-screener/1.0)' },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Health check — Railway (and any upstream proxy) can poll this to confirm
// the process is alive without triggering the expensive stock-fetch logic.
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a single ticker's quote + 1-hour chart from Yahoo Finance.
 * Returns null on any network or parse error so the caller can skip it
 * rather than letting one bad ticker abort the whole scan.
 */
async function fetchTicker(symbol) {
  try {
    const [quoteRes, chartRes] = await Promise.all([
      http.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
      ),
      http.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1h&range=1d`
      ),
    ]);

    const quote = quoteRes.data?.chart?.result?.[0];
    const chart = chartRes.data?.chart?.result?.[0];

    if (!quote || !chart) return null;

    const meta = quote.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    const volume = meta.regularMarketVolume || 0;

    // Compression score: ratio of 1-hour high-low range to daily range.
    // A tight hourly range relative to the day's range signals a coil/pennant.
    const hourlyCloses = chart.indicators?.quote?.[0]?.close?.filter(Boolean) ?? [];
    const dailyHigh = meta.regularMarketDayHigh || price;
    const dailyLow = meta.regularMarketDayLow || price;
    const dailyRange = dailyHigh - dailyLow || 1;

    let compressionScore = 0;
    if (hourlyCloses.length >= 2) {
      const hourlyHigh = Math.max(...hourlyCloses);
      const hourlyLow = Math.min(...hourlyCloses);
      const hourlyRange = hourlyHigh - hourlyLow;
      compressionScore = Math.max(0, Math.min(1, 1 - hourlyRange / dailyRange));
    }

    // Rough low-float heuristic: market cap < $300 M and price < $20.
    const marketCap = meta.marketCap || 0;
    const lowFloat = marketCap > 0 && marketCap < 300_000_000 && price < 20;

    return {
      ticker: symbol,
      exchange: meta.exchangeName || 'N/A',
      price: Math.round(price * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      volume,
      compressionScore: Math.round(compressionScore * 100) / 100,
      lowFloat,
    };
  } catch (err) {
    // Log the specific ticker and reason so it's easy to diagnose in Railway
    // logs without crashing the whole request.
    console.error(`[fetchTicker] ${symbol} failed: ${err.message}`);
    return null;
  }
}

// A representative set of small-cap tickers to seed the screener.
const TICKERS = [
  'SOUN', 'BBAI', 'KULR', 'MARA', 'RIOT', 'CLSK', 'CIFR', 'BTBT',
  'HIMS', 'OPEN', 'SPCE', 'NKLA', 'WKHS', 'GOEV', 'RIDE', 'SOLO',
  'IDEX', 'ILUS', 'CENN', 'MULN', 'FFIE', 'XELA', 'ATER', 'PROG',
  'BBBY', 'EXPR', 'KOSS', 'NAKD', 'SNDL', 'TLRY', 'ACB', 'CGC',
  'AMC', 'GME', 'WISH', 'CLOV', 'WOOF', 'BARK', 'MAPS', 'BODY',
];

// ---------------------------------------------------------------------------
// /api/stocks — main screener endpoint
// ---------------------------------------------------------------------------
app.get('/api/stocks', async (_req, res) => {
  console.log('[/api/stocks] Scan started');

  try {
    // Fetch all tickers concurrently; individual failures return null and are
    // filtered out rather than rejecting the whole Promise.allSettled batch.
    const results = await Promise.allSettled(TICKERS.map(fetchTicker));

    const stocks = results
      .filter((r) => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value)
      .filter((s) => s.price > 0 && s.volume > 0)
      .sort((a, b) => b.compressionScore - a.compressionScore);

    console.log(`[/api/stocks] Scan complete — ${stocks.length}/${TICKERS.length} tickers returned data`);
    res.json(stocks);
  } catch (err) {
    // This catch handles unexpected synchronous errors; individual network
    // failures are already swallowed inside fetchTicker.
    console.error('[/api/stocks] Unexpected error:', err);
    res.status(500).json({ error: 'Failed to fetch stock data', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown — handle SIGTERM (Railway stop/deploy) and SIGINT
// (Ctrl-C in local dev) without an unclean crash.
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });

  // Force-exit after 10 s if in-flight requests haven't drained.
  setTimeout(() => {
    console.error('[server] Forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch any unhandled promise rejections so they surface in logs instead of
// silently crashing the process on Node 15+.
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
});
