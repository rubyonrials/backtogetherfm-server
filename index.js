const express = require('express');
const app = express();
const { createChannel } = require('./channel.js');

const PORT = process.env.PORT || 9876;

let channels = [];

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

// NEW METHOD: every 10 seconds, check current streams. if any are expired, refresh them.

// Return the channel names that are streamable as an array of channel objects.
app.get('/getStreamableChannels', (req, res) => {
	try {
		const streamableChannels = channels.filter(channel => {
			return !(channel.isExpired());
		});
		res.send(streamableChannels);
	} catch (err) {
		// TODO DRY up 500 handling for api endpoints
		console.error('Internal server error: ', err);
		res.status(500).send('Internal Server Error');
	}
});

app.get('/:channelSourceName.m3u8', async (req, res) => {
	const { sync } = req.query;
	const { channelSourceName } = req.params;
	if (sync === undefined)
		return res.sendFile(`hls-data/${channelSourceName}.m3u8`, { root: __dirname });

	try {
		const channel = channels.find(channel => channel.source == `${channelSourceName}.m3u8`);

		const sourceManifestLines = await channel.getManifestLines();
		let syncedManifest = '';
		channel.ensureBroadcasting();
		const playbackOffset = channel.getPlaybackOffset();

		for (let i = 0; i < sourceManifestLines.length; i++) {
			if (sourceManifestLines[i] === '#EXT-X-VERSION:3') {
				syncedManifest += sourceManifestLines[i] + '\n';
				syncedManifest += `#EXT-X-START:TIME-OFFSET=${playbackOffset},PRECISE=YES\n`;
			} else {
				syncedManifest += sourceManifestLines[i] + '\n';
			}
		}

		res.type('application/vnd.apple.mpegurl');
		res.send(syncedManifest);
	} catch (err) {
		console.error('Internal server error: ', err);
		res.status(500).send('Internal Server Error');
	}
});

// app.use(express.static('hls-data'));

app.listen(PORT, () => {
	// TODO this should be callable from CLI for on-demand channel management
	(async () => {
		try {
			const channel = await createChannel({
				source: 'bassinfusion.m3u8',
				livestreaming: false,
				colorGroup: 'red'
			});
			channels.push(channel);
		} catch (error) {
			console.error('Failed to create channel', error);
		}
	})();
	console.log(`Server is listening on port ${PORT}.`);
});
