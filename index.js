const express = require('express');
const fs = require('fs');
const app = express();
const port = 6900;

// Middleware to set CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  next();
});

let startTime;
getStartOffset = () => {
  if (!startTime) startTime = new Date();
  let offset = (new Date() - startTime) / 1000;
  return offset;
};

app.get('/stream', (req, res) => {
  fs.readFile(`${__dirname}/hls-manifest/blue.m3u8`, 'utf8', (err, data) => {
    if (err) {
      console.log(err);
      res.status(500).send("Error reading playlist file");
      return;
    }

    let lines = data.split('\n');
    let playlist = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '#EXT-X-VERSION:3') {
        playlist += lines[i] + '\n';
        playlist += `#EXT-X-START:TIME-OFFSET=${getStartOffset()},PRECISE=YES\n`;
      } else {
        playlist += lines[i] + '\n';
      }
    }

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlist);
  });
});

app.use(express.static('hls-data'));

// app.get('/', (req, res) => {
//     res.send('Hello World!');
// });

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
