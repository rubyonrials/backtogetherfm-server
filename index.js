const express = require('express');
const fs = require('fs').promises;
const app = express();
const { v4: uuidv4 } = require('uuid');

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
app.get('/getStreamableChannels', async (req, res) => {
	try {
		const streamableChannels = channels.filter(channel => {
			return !(await channel.isExpired());
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
	if (sync === undefined)
		return res.sendFile(`hls-data/${req.params.channelSourceName}.m3u8`, { root: __dirname });

	try {
		const channel = channels.filter(channel => {
			channel.source === `${req.params.channelSourceName}.m3u8`;
		});

		const sourceManifestLines = await channel.getManifestLines();
		let syncedManifest = '';
		await channel.ensureBroadcasting();
		const playbackOffset = await channel.getPlaybackOffset();

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

// TODO delete this
// app.post('/stream/:channel', async (req, res) => {
//   // const channel = req.params.channel;
//   // if (!channel || (channel !== RED && channel !== GREEN && channel !== BLUE)) {
//   //   res.status(400).send(`${errorPrefix} Invalid channel parameter (must be one of 'red', 'green', 'blue').`);
//   //   return;
//   // }

//   // Create a copy of the source manifest, with an up-to-date EXT-X-START playback offset for synchronization
//   const sourceManifestLines = await getSourceManifestLines(channel);
//   let clientManifest = '';
//   ensureBroadcasting(channel);
//   const playbackOffset = getPlaybackOffset(channel);
//   for (let i = 0; i < sourceManifestLines.length; i++) {
//     if (sourceManifestLines[i] === '#EXT-X-VERSION:3') {
//       clientManifest += sourceManifestLines[i] + '\n';
//       clientManifest += `#EXT-X-START:TIME-OFFSET=${playbackOffset},PRECISE=YES\n`;
//     } else {
//       clientManifest += sourceManifestLines[i] + '\n';
//     }
//   }

//   // Write the new manifest to a file
//   const clientManifestFilename = `${channel}-${Math.round(playbackOffset)}-${uuidv4()}.m3u8`;
//   await fs.writeFile(`${__dirname}/hls-manifest/client/${clientManifestFilename}`, clientManifest);
//   res.send(clientManifestFilename);
// });

// app.use(express.static('hls-data'));

app.listen(PORT, () => {
  // refreshChannel(RED, 'bassinfusion.m3u8');
	// TODO redo this
  console.log(`Server is listening on port ${PORT}.`);
});
