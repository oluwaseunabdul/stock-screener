const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const app = express();

app.use(express.static('public'));

app.get('/api/stocks', (req, res) => {
  console.log('🔄 Running stock screener...');
  
  const pythonProcess = spawn('python3', ['screener.py']);
  
  let output = '';
  let errorOutput = '';
  
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.log('Python log:', data.toString());
  });
  
  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      console.error('Python error:', errorOutput);
      return res.json({ error: 'Screener failed', details: errorOutput });
    }
    
    try {
      const stocks = JSON.parse(output);
      res.json(stocks);
    } catch (e) {
      console.error('JSON parse error:', e);
      res.json({ error: 'Failed to parse data' });
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Open http://localhost:${PORT} to see the screener`);
});