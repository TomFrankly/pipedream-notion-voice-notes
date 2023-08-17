const { Deepgram } = require("@deepgram/sdk");
const fs = require("fs");

async function testDeepgram() {
	const deepgram = new Deepgram("2df140a224289a6c9ba37e65408e7d5ce5100fc2");

	const audio = {
		url: "https://res.cloudinary.com/deepgram/video/upload/v1684784416/dg-audio/bueller-life-moves-pretty-fast_uud9ip.wav",
	};

	const audioSource = {
		stream: fs.createReadStream("./long-monologue9.mp3"),
		mimetype: "mp3",
	};

	const options = {
		model: "whisper",
		smart_format: true,
		summarize: "v2",
	};

	const response = await deepgram.transcription.preRecorded(audioSource, options);

	fs.writeFile("response-whisper.json", JSON.stringify(response, null, 2), (err) => {
		if (err) {
			console.error("An error occurred while writing the file:", err);
		} else {
			console.log("File written successfully.");
		}
	});
}

testDeepgram();
