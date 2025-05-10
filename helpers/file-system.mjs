// Node.js utils
import stream from "stream"; // Stream handling
import { promisify } from "util"; // Promisify
import fs from "fs"; // File system
import got from "got"; // HTTP requests
import { exec } from "child_process"; // Shell commands

const execAsync = promisify(exec);

export default {
    methods: {
        async cleanTmp(cleanChunks = true) {
			console.log(`Attempting to clean up the /tmp/ directory...`);

			if (this.filePath && fs.existsSync(this.filePath)) {
				await fs.promises.unlink(this.filePath);
			} else {
				console.log(`File ${this.filePath} does not exist.`);
			}

			if (
				cleanChunks &&
				this.chunkDir.length > 0 &&
				fs.existsSync(this.chunkDir)
			) {
				console.log(`Cleaning up ${this.chunkDir}...`);
				await execAsync(`rm -rf "${this.chunkDir}"`);
			} else {
				console.log(`Directory ${this.chunkDir} does not exist.`);
			}
		},
        async downloadToTmp(fileLink, filePath, fileName) {
			try {
				// Define the mimetype
				const mime = filePath.match(/\.\w+$/)[0];

				// Check if the mime type is supported (mp3 or m4a)
				if (this.supportedMimes.includes(mime) === false) {
					throw new Error(
						`Unsupported file type. Supported file types include ${this.supportedMimes.join(
							", "
						)}.`
					);
				}

				// Define the tmp file path
				const tmpPath = `/tmp/${filePath
					.match(/[^\/]*\.\w+$/)[0]
					.replace(/[\?$#&\{\}\[\]<>\*!@:\+\\\/]/g, "")}`;

				// Download the audio recording from Dropbox to tmp file path
				const pipeline = promisify(stream.pipeline);
				await pipeline(got.stream(fileLink), fs.createWriteStream(tmpPath));

				// Create a results object
				const results = {
					file_name: fileName,
					path: tmpPath,
					mime: mime,
				};

				console.log("Downloaded file to tmp storage:");
				console.log(results);
				return results;
			} catch (error) {
				throw new Error(`Failed to download file: ${error.message}`);
			}
		}
    }
}