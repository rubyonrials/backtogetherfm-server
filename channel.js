const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const RED = 'red';
const GREEN = 'green';
const BLUE = 'blue';
const YELLOW = 'yellow';

// TODO playbackTimer should be long-lived, even if the server process dies. probably a light database

// TODO: Eventually we will send color information to the client, when there are multiple channels available at once again
// TODO: Why would server be responsible for setting the actual hex color values? So that client(s) does not have to be updated when a party wants to add a new/different color. Server is the easiest to update and control, esp in SDB land. Dumb client, even though it's strange setting hex values here
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

// NOTE: ID is how channels are distinguished from one another. A channel can continue with multiple source manifests and still be the same channel to a user ("green channel" that plays multiple groovy sets)
// source: manifest filename in hls-data/
// livestreaming: Boolean
// ibeaconMinor: the minor value expected on an ibeacon for MULTICHANNEL-SPATIAL client mode
// color: COLOR_MAP keys (YELLOW | RED | GREEN | BLUE)
const createChannel = async ({
	source,
	livestreaming,
	ibeaconMinor = null,
	colorGroup
}) => {
	let playbackTimer = null;
	let duration = null;

	const getManifestLines = async () => {
		const manifestPath = `hls-data/${source}`;
		const manifestData = await fs.readFile(`${__dirname}/${manifestPath}`, 'utf8');
		const manifestLines = manifestData.split('\n');
		return manifestLines;
	};

	const setDuration = async () => {
		if (livestreaming) throw new Error("Did not expect setDuration to be called on a currently livestreaming channel.");

		duration = (await getManifestLines())
			.filter(line => line.startsWith('#EXTINF:'))
			.map(line => parseFloat(line.split(':')[1]))
			.reduce((a, b) => a + b, 0);
	};

	const terminateLivestreaming = async () => {
		livestreaming = false;
		await setDuration();
		cleanupBroadcast();
	}

	const getPlaybackOffset = () => {
		if (!playbackTimer) throw new Error("Did not expect getPlaybackOffset to be called on a channel that is not broadcasting.");

		let playbackOffset = (new Date() - playbackTimer) / 1000;
		return playbackOffset;
	};

	const isExpired = () => {
		if(!playbackTimer) return false;
		if(livestreaming) return false; //TODO we need to eventually set this to false for livestreams

		const isExpired = getPlaybackOffset() >= duration;
		return isExpired;
	}

	const cleanupBroadcast = () => {
		if (livestreaming) return;
		if (!duration) throw new Error("cleanupBroadcast did not expect null duration on non-livestreaming broadcast");

		setTimeout(() => {
			if(!isExpired()) {
				throw new Error("cleanupBroadcast expected expired broadcast."); // TODO why do we need this? is there a better way?
				return;
			}

			reset();
		}, duration * 1000);
	}

	const ensureBroadcasting = () => {
		if ( playbackTimer !== null ) return;
		playbackTimer = new Date();
		cleanupBroadcast();
	};

	const reset = (newSource = null) => {
	  if (newSource) {
		  if (newSource === source) {
			  throw new Error("Cannot reset; 'newSource' parameter is the same as the existing 'source'.");
		  }

		  source = newSource;
	  }

	  playbackTimer = null;
	};

	const initialize = async () => {
		if (!source) throw new Error("Cannot createChannel without 'source' parameter.");
		if (livestreaming === undefined) throw new Error("Cannot createChannel without 'livestreaming' parameter.");
		if (!colorGroup) throw new Error("Cannot createChannel without 'colorGroup' parameter.");
		if (!Object.keys(COLOR_MAP).includes(colorGroup)) {
			throw new Error(`Cannot createChannel; 'colorGroup' parameter must be one of ${Object.keys(COLOR_MAP).join(', ')}`);
		}

		if (!livestreaming) {
			await setDuration();
		}

		return {
			id: uuidv4(),
			source,
			livestreaming,
			ibeaconMinor,
			colorGroup,
			colorOpaque: COLOR_MAP[colorGroup].colorOpaque,
			colorTransparent: COLOR_MAP[colorGroup].colorTransparent,
			getManifestLines,
			getPlaybackOffset,
			isExpired,
			ensureBroadcasting,
			reset
		};
	};

	return await initialize();
};

module.exports = { createChannel };
