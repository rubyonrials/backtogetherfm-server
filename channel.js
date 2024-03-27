const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const RED = 'red';
const GREEN = 'green';
const BLUE = 'blue';
const YELLOW = 'yellow';

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
	color
}) => {
	let playbackTimer = null;

	const getManifestLines = async () => {
		const manifestPath = `hls-data/${source}`;
		const manifestData = await fs.readFile(`${__dirname}/${manifestPath}`, 'utf8');
		const manifestLines = manifestData.split('\n');
		return manifestLines;
	};

	// TODO: Could cache this for non-livestreaming files? So that when isExpired gets called (for every client calling /getStreamableChannels, and every time ensureBroadcasting starts a stream) we don't have to do a file read
	const getDuration = async () => {
		if (livestreaming) throw new Error("Did not expect getDuration to be called on a currently livestreaming channel.");

		const duration = await getManifestLines()
			.filter(line => line.startsWith('#EXTINF:'))
			.map(line => parseFloat(line.split(':')[1]))
			.reduce((a, b) => a + b, 0);
		return duration;
	};

	const getPlaybackOffset = () => {
		if (!playbackTimer) throw new Error("Did not expect getPlaybackOffset to be called on a channel that is not broadcasting.");

		let playbackOffset = (new Date() - playbackTimer) / 1000;
		return playbackOffset;
	};

	const isExpired = async () => {
		if(!playbackTimer) return false;
		if(livestreaming) return false; //TODO we need to eventually set this to false for livestreams

		const duration = await getDuration();
		const isExpired = getPlaybackOffset() >= duration;
		return isExpired;
	}

	const ensureBroadcasting = async () => {
		if ( playbackTimer !== null ) return;

		playbackTimer = new Date();

		setTimeout(() => {
			if(!(await isExpired())) {
				console.error("ensureBroadcasting cleanup expected expired broadcast."); // TODO why do we need this? is there a better way?
				return;
			}

			reset();
		}, (await getDuration()) * 1000);
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
		if (!color) throw new Error("Cannot createChannel without 'color' parameter.");
		if (!Object.keys(COLOR_MAP).includes(color)) {
			throw new Error(`Cannot createChannel; 'color' parameter must be one of ${Object.keys(COLOR_MAP).join(', ')}`);
		}

		return {
			id: uuidv4(),
			source,
			livestreaming,
			ibeaconMinor,
			color,
			colorOpaque: COLOR_MAP[color].colorOpaque,
			colorTransparent: COLOR_MAP[color].colorTransparent,
			getManifestLines,
			getPlaybackOffset,
			isExpired,
			reset
		};
	};

	return await initialize();
};
