const express = require('express');
const fs = require('fs').promises;
const app = express();
const { v4: uuidv4 } = require('uuid');

const PORT = 6900;
const RED = 'red';
const GREEN = 'green';
const BLUE = 'blue';
const ERROR_DELIMITER = ':::';

// Middleware to set CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, ngrok-skip-browser-warning');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

let broadcasts = {
  [ RED ]: {
    source: null,
    playbackTimer: null,
    duration: null,
    // TODO livestream: false
  },
  [ GREEN ]: {
    source: null,
    playbackTimer: null,
    duration: null,
    // TODO livestream: false
  },
  [ BLUE ]: {
    source: 'imgood.m3u8',
    playbackTimer: null,
    duration: null,
    // TODO livestream: false
  }
};

const getSourceManifestLines = async (channel) => {
  const sourceManifestPath = `hls-manifest/${channel}/${broadcasts[channel].source}`;
  const sourceManifestData = await fs.readFile(`${__dirname}/${sourceManifestPath(channel)}`, 'utf8');
  const sourceManifestLines = sourceManifestData.split('\n');
  return sourceManifestLines;
};

// channel = RED | GREEN | BLUE
// returns: nothing
const ensureBroadcasting = (channel) => {
  // Beware, if you try to use `const timer = broadcasts[channel].playbackTimer` you won't actually update the timer. Mutable objects!
  if (!broadcasts[channel].playbackTimer) broadcasts[channel].playbackTimer = new Date();
};

// Cache the duration when broadcast is refreshed / loaded so we don't have to 
// calculate it every time a new client checks for broadcastable channels
// returns: nothing
const setBroadcastDuration = (channel) => {
  const sourceManifestLines = getSourceManifestLines(channel);
  const broadcastDuration = sourceManifestLines
    .filter(line => line.startsWith('#EXTINF:'))
    .map(line => parseFloat(line.split(':')[1]))
    .reduce((a, b) => a + b, 0);
  broadcasts[channel].duration = broadcastDuration;
};

// channel = RED | GREEN | BLUE
const getPlaybackOffset = (channel) => {
  const playbackTimer = broadcasts[channel].playbackTimer;
  let playbackOffset = (new Date() - playbackTimer) / 1000;
  return playbackOffset;
};

const isBroadcastExpired = (channel) => {
  const { playbackTimer, duration } = broadcasts[channel];
  return false if !playbackTimer;
  const broadcastExpired = getPlaybackOffset(channel) >= duration;
  return broadcastExpired;
};


// channel = RED | GREEN | BLUE
// newSource = string | null
const refreshChannel = (channel, newSource = null) => {
  // Make sure source is unset before clearing playbackTimer, otherwise a new client could begin a stream
  // of the old source with a newly-cleared playbackTimer
  if (newSource) broadcasts[channel].source = newSource;
  broadcasts[channel].playbackTimer = null;
};

// Return the channel names that are streamable as an array.
// A channel is streamable if it's playbackTimer is not null (not yet started broadcast) or expired
app.get('/getStreamableChannels', (req, res) => {
  const allChannels = [RED, GREEN, BLUE];
  return allChannels.filter(channel => {
    return false if !broadcasts[channel].source;
    return isBroadcastExpired(channel);
    // TODO could also show whether the broadcast will be live here!
  });
});

// req.params.channel = RED | GREEN | BLUE
// Create a temporary, unique manifest for the client with a unique playback offset. Return the URL.
// Note: we don't just serve the manifest directly, because the client's HLS player needs to continually poll for updates to live streams.
app.post('/stream/:channel', async (req, res) => {
  const errorPrefix = `POST /stream/:channel ${ERROR_DELIMITER}`;
  const channel = req.params.channel;
  if (!channel || (channel !== RED && channel !== GREEN && channel !== BLUE)) {
    res.status(400).send(`${errorPrefix} Invalid channel parameter (must be one of 'red', 'green', 'blue').`);
    return;
  }

  // Create a copy of the source manifest, with an up-to-date EXT-X-START playback offset for synchronization
  const sourceManifestLines = getSourceManifestLines(channel);
  let clientManifest = '';
  ensureBroadcasting(channel);
  const playbackOffset = getPlaybackOffset(channel);
  for (let i = 0; i < sourceManifestLines.length; i++) {
    if (sourceManifestLines[i] === '#EXT-X-VERSION:3') {
      clientManifest += sourceManifestLines[i] + '\n';
      clientManifest += `#EXT-X-START:TIME-OFFSET=${playbackOffset},PRECISE=YES\n`;
    } else {
      clientManifest += sourceManifestLines[i] + '\n';
    }
  }

  // Write the new manifest to a file
  const clientManifestFilename = `${channel}-${Math.round(playbackOffset)}-${uuidv4()}.m3u8`;
  await fs.writeFile(`${__dirname}/hls-manifest/client/${clientManifestFilename}`, clientManifest);
  res.send(clientManifestFilename);
});

app.use(express.static('hls-data'));
app.use(express.static('hls-manifest/client'));

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}.`);
});
