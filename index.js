const express = require('express');
const fs = require('fs').promises;
const app = express();
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 9876;
const RED = 'red';
const GREEN = 'green';
const BLUE = 'blue';
const YELLOW = 'yellow';
const STATIC = 'STATIC';
const LIVESTREAM = 'LIVESTREAM';
const ERROR_DELIMITER = ':::';

// Middleware to set CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, ngrok-skip-browser-warning');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.url.endsWith('.ts')) {
    // Set the file to be cached for 1 day (86400 seconds)
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }

  next();
});

// let broadcasts = {
//   [ RED ]: {
//     source: null,
//     playbackTimer: null,
//     duration: null,
//     // TODO livestream: false
//   },
//   [ GREEN ]: {
//     source: null,
//     playbackTimer: null,
//     duration: null,
//     // TODO livestream: false
//   },
//   [ BLUE ]: {
//     source: null,
//     playbackTimer: null,
//     duration: null,
//     // TODO livestream: false
//   }
// }; // TODO this should probably be a class, with instantiated broadcasts, with types that can be checked. refreshCHannel is really initialize, and initializes the instance variables

// TODO: Eventually we will send color information to the client, when there are multiple channels available at once again
const COLOR_MAP = {
	[ YELLOW ]: {
		colorOpaque:'#ffb100ba',
		colorTransparent:'#ffb10042'
	},
	[ RED ]: {
		colorOpaque:'#dc322fba',
		colorTransparent:'#dc322f42'
	},
	[ GREEN ]: {
		colorOpaque:'#429900ba',
		colorTransparent:'#45ff0042'
	},
	[ BLUE ]: {
		colorOpaque:'#268bd2ba',
		colorTransparent:'#268bd242'
	}
};

// id: UUID. Represents what the current channel is to the client, and whether it has changed
// type: STATIC | LIVESTREAM
// source: relative path to hls-source/
// ibeaconMinor: the minor value expected on an ibeacon for MULTICHANNEL-SPATIAL client mode
// color: COLOR_MAP keys (YELLOW | RED | GREEN | BLUE)
const createBroadcast = async ({
	type,
	source,
	ibeaconMinor = null,
	color
}) => {
	let duration = null;
	let playbackTimer = null;

	const setBroadcastDuration = async () => {
		const sourceManifestPath = `hls-manifest/source/${source}`;
		const sourceManifestData = await fs.readFile(`${__dirname}/${sourceManifestPath}`, 'utf8');
		const sourceManifestLines = sourceManifestData.split('\n');
		const broadcastDuration = sourceManifestLines
			.filter(line => line.startsWith('#EXTINF:'))
			.map(line => parseFloat(line.split(':')[1]))
			.reduce((a, b) => a + b, 0);
		duration = broadcastDuration;
	};

	const refresh = async (newSource = null) => {
	  if (newSource) {
		  if (newSource === source) {
			  throw new Error("Cannot refresh; 'newSource' parameter is the same as the existing 'source'.");
		  }

		  source = newSource;
	  }

	  playbackTimer = null;
	  await setBroadcastDuration();
	};

	const initialize = async () => {
		if (!type) throw new Error("Cannot createBroadcast without 'type' parameter.");
		if (![STATIC, LIVESTREAM].includes(type)) throw new Error(`Cannot createBroadcast; 'type' must be one of [${STATIC}, ${LIVESTREAM}]`);
		if (!source) throw new Error("Cannot createBroadcast without 'source' parameter.");
		if (!color) throw new Error("Cannot createBroadcast without 'color' parameter.");
		if (!Object.keys(COLOR_MAP).includes(color)) {
			throw new Error(`Cannot createBroadcast; 'color' parameter must be one of ${Object.keys(COLOR_MAP).join(', ')}`);
		}

		// Set broadcast duration if type STATIC
		if (type === STATIC) {
			await setBroadcastDuration();
		}

		return {
			id: uuidv4(),
			type,
			source,
			ibeaconMinor,
			color,
			duration,
			playbackTimer,
			refresh
		};
	};

	return await initialize();
};

const getSourceManifestLines = async (channel) => {
  const sourceManifestPath = `hls-manifest/source/${channel}/${broadcasts[channel].source}`;
  const sourceManifestData = await fs.readFile(`${__dirname}/${sourceManifestPath}`, 'utf8');
  const sourceManifestLines = sourceManifestData.split('\n');
  return sourceManifestLines;
};

const getPlaybackOffset = (channel) => {
  const playbackTimer = broadcasts[channel].playbackTimer;
  let playbackOffset = (new Date() - playbackTimer) / 1000;
  return playbackOffset;
};

const isBroadcastExpired = (channel) => {
  const { playbackTimer, duration } = broadcasts[channel];
  if(!playbackTimer) return false;
  if(!duration) {
    console.error("isBroadcastExpired expected duration to be set."); // TODO
    return false;
  }
  const broadcastExpired = getPlaybackOffset(channel) >= duration;
  return broadcastExpired;
};

// channel = RED | GREEN | BLUE
// newSource = string | null
const refreshChannel = async (channel, newSource = null) => {
  // Cache the duration when broadcast is refreshed / loaded so we don't have to
  // calculate it every time a new client checks for broadcastable channels
  // returns: nothing
  const setBroadcastDuration = async (channel) => {
    const sourceManifestLines = await getSourceManifestLines(channel);
    const broadcastDuration = sourceManifestLines
      .filter(line => line.startsWith('#EXTINF:'))
      .map(line => parseFloat(line.split(':')[1]))
      .reduce((a, b) => a + b, 0);
    broadcasts[channel].duration = broadcastDuration;
  };

  // returns: nothing
  const clearOldClientManifests = async (channel) => {
    try {
      const clientManifestPath = `${__dirname}/hls-manifest/client`;
      const clientManifestFiles = await fs.readdir(clientManifestPath);
      for (const filename of clientManifestFiles) {
        if (!filename.startsWith(channel)) continue;
        fs.unlink(`${clientManifestPath}/${filename}`); // async
      }
    } catch (err) {
      console.error(`Error removing client manifests for channel ${channel}`);
    }
  };

  // Make sure source is changed before clearing playbackTimer, otherwise a new client could begin a stream
  // of the old source with a newly-cleared playbackTimer.
  // This will NOT stop streaming for old clients, who are loading chunks directly from hls-data now. That is handled by getStreamableChannels
  if (newSource) broadcasts[channel].source = newSource;
  broadcasts[channel].playbackTimer = null;
  setBroadcastDuration(channel); // async
  clearOldClientManifests(channel); // async
};

// NEW METHOD: every 10 seconds, check current streams. if any are expired, refresh them.

// Return the channel names that are streamable as an array.
// A channel is streamable if it's playbackTimer is not null (not yet started broadcast) or expired
app.get('/getStreamableChannels', (req, res) => {
  // could check if broadcast is expired; if so, refresh it. let's let the timeout handle this for now
  // plus a regular check for livestreams, or odd jobs
  // for example, if the server shuts down when it's supposed to refresh a stream, it will go zombie mode
  const allChannels = [RED, GREEN, BLUE];
  const streamableChannels = allChannels.filter(channel => {
    if(!broadcasts[channel].source) return false;
    return !isBroadcastExpired(channel);
    // TODO could also show whether the broadcast will be live here!
    // TODO probably need to show source. if source is different we need to redo things client-side.... emit event when channel source changes
  });

  // TODO filter out playbackTimer; figure out a way to do this with a deep clone rather than rewriting it myself
  let obj = {};
  streamableChannels.map(channel => {
    obj[channel] = broadcasts[channel];
  });
  res.send(obj);
});

// req.params.channel = RED | GREEN | BLUE
// Create a temporary, unique manifest for the client with a unique playback offset. Return the URL.
// Note: we don't just serve the manifest directly, because the client's HLS player needs to continually poll for updates to live streams.
app.post('/stream/:channel', async (req, res) => {
  const ensureBroadcasting = (channel) => {
    if (broadcasts[channel].playbackTimer) return;

    // Beware, if you try to use `const timer = broadcasts[channel].playbackTimer` you won't actually update the timer. Mutable objects!
    broadcasts[channel].playbackTimer = new Date();
    broadcastDuration = broadcasts[channel].duration;
    if (!broadcastDuration) console.error("ensureBroadcasting expected duration to be set."); // TODO
    setTimeout(() => {
      if(!isBroadcastExpired(channel)) {
        console.error("ensureBroadcasting cleanup expected expired broadcast."); // TODO
        return;
      }
      refreshChannel(channel); // async
    }, broadcastDuration * 1000);
  };

  const errorPrefix = `POST /stream/:channel ${ERROR_DELIMITER}`;
  const channel = req.params.channel;
  if (!channel || (channel !== RED && channel !== GREEN && channel !== BLUE)) {
    res.status(400).send(`${errorPrefix} Invalid channel parameter (must be one of 'red', 'green', 'blue').`);
    return;
  }

  // Create a copy of the source manifest, with an up-to-date EXT-X-START playback offset for synchronization
  const sourceManifestLines = await getSourceManifestLines(channel);
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
  refreshChannel(RED, 'bassinfusion.m3u8'); // can move source-chooser to method
  // refreshChannel(GREEN, 'set1.m3u8'); // can move source-chooser to method
  // refreshChannel(BLUE, 'set1.m3u8'); // can move source-chooser to method
  console.log(`Server is listening on port ${PORT}.`);
});
