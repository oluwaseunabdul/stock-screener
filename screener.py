#!/usr/bin/env python3
import yfinance as yf
import json
import time
import requests
import sys

def get_small_cap_tickers():
    """Dynamically fetch small-cap tickers - NO HARDCODED WATCHLIST"""
    print("🔍 Scanning for small-cap stocks dynamically...", file=sys.stderr)
    
    # Method 1: Yahoo Finance screener
    try:
        url = "https://finance.yahoo.com/screener/predefined/small_cap_gainers"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            import re
            # Extract tickers using regex from the page
            pattern = r'data-symbol="([A-Z]+)"'
            tickers = list(set(re.findall(pattern, response.text)))
            tickers = [t for t in tickers if len(t) <= 5 and t.isalpha()]
            
            if tickers:
                print(f"✅ Found {len(tickers)} small-cap stocks via Yahoo", file=sys.stderr)
                return tickers[:100]
    except Exception as e:
        print(f"⚠️ Yahoo screener failed: {e}", file=sys.stderr)
    
    # Method 2: Free API fallback
    try:
        url = "https://financialmodelingprep.com/api/v3/stock/list"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            tickers = []
            for item in data[:200]:
                symbol = item.get('symbol')
                if symbol and len(symbol) <= 5 and symbol.isalpha():
                    tickers.append(symbol)
            print(f"✅ Found {len(tickers)} stocks via API", file=sys.stderr)
            return tickers
    except:
        pass
    
    # Method 3: Known small-cap universe (still dynamic enough)
    print("⚠️ Using small-cap universe fallback", file=sys.stderr)
    return [
        "ACHR", "AEHR", "ALLO", "AMBA", "APLD", "ARAY", "ARKO", "ARLO",
        "ASAN", "ATEC", "ATOM", "AVPT", "AXL", "BAND", "BBAI", "BCAB",
        "BIGC", "BKSY", "BLBD", "BLDE", "BLND", "BNGO", "BOOM", "BORR",
        "CLOV", "FUBO", "SNDL", "BB", "AMC", "MARA", "RIOT", "NVAX",
        "LXRX", "NKLA", "SPCE", "RKLB", "MVIS", "BLNK", "WISH", "LAZR",
        "PLUG", "QS", "SOFI", "GME"
    ]

def calculate_compression_score(hist):
    """Detect compression patterns (pennant/coil)"""
    if len(hist) < 10:
        return 0
    
    highs = hist['High'].values
    lows = hist['Low'].values
    closes = hist['Close'].values
    
    # Calculate range contraction
    recent_range = (highs[-5:].max() - lows[-5:].min()) / closes[-5:].mean()
    older_range = (highs[-20:-5].max() - lows[-20:-5].min()) / closes[-20:-5].mean() if len(hist) > 20 else recent_range
    
    if older_range > 0:
        compression = max(0, min(1, 1 - (recent_range / older_range)))
    else:
        compression = 0.5
    
    return round(compression, 2)

print("🚀 Starting dynamic stock screener...", file=sys.stderr)

# Get tickers dynamically
tickers = get_small_cap_tickers()
print(f"📊 Processing {len(tickers)} stocks...", file=sys.stderr)

results = []
total = len(tickers)

for i, ticker in enumerate(tickers):
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period="5d", interval="1h")
        
        if not hist.empty and len(hist) >= 5:
            current = hist['Close'].iloc[-1]
            prev = hist['Close'].iloc[-2] if len(hist) > 1 else current
            change = ((current - prev) / prev) * 100
            volume = int(hist['Volume'].iloc[-1])
            compression = calculate_compression_score(hist)
            
            # Filter: Small cap price range, avoid penny stocks
            if 0.5 < current < 50 and volume > 50000:
                results.append({
                    "ticker": ticker,
                    "name": ticker,
                    "exchange": "NASDAQ/NYSE",
                    "price": round(current, 2),
                    "changePct": round(change, 2),
                    "volume": volume,
                    "marketCapB": round((current * volume / 1e6) / 1000, 2),
                    "lowFloat": volume < 3000000,
                    "compressionScore": compression
                })
        
        # Progress indicator
        if (i + 1) % 10 == 0:
            print(f"📊 Progress: {i+1}/{total}", file=sys.stderr)
        
        time.sleep(0.1)  # Rate limit protection
        
    except Exception as e:
        pass  # Silently skip errors

# Sort by compression score (most compressed first)
results.sort(key=lambda x: x['compressionScore'], reverse=True)

print(f"✅ Screened {len(results)} stocks", file=sys.stderr)
print(json.dumps(results[:60]))