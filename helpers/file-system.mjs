// Node.js utils
import stream from "stream"; // Stream handling
import { promisify } from "util"; // Promisify
import fs from "fs"; // File system
import got from "got"; // HTTP requests
import { exec } from "child_process"; // Shell commands

const execAsync = promisify(exec);

export default {
    methods: {
        async checkSize(fileSize) {
            // Services that support direct file upload without chunking
            const directUploadServices = ['deepgram', 'assemblyai', 'google_gemini', 'elevenlabs'];
            
            // For direct upload services, only check the original file size
            if (directUploadServices.includes(this.transcription_service)) {
                if (fileSize > 700000000) {
                    throw new Error(
                        `File is too large. Files must be under 700MB and one of the following file types: ${config.supportedMimes.join(
                            ", "
                        )}.`
                    );
                }
                // Log file size in mb to nearest hundredth
                const readableFileSize = fileSize / 1000000;
                console.log(
                    `File size is approximately ${readableFileSize.toFixed(1)}MB. Using direct upload to ${this.transcription_service}.`
                );
                return;
            }

            // For services that require chunking, perform detailed size checks
            // Get duration first
            const duration = await this.getDuration(this.filePath);
            const durationInHours = duration / 3600;
            
            // Calculate estimated WAV size based on duration
            // Using 16-bit, 16kHz, mono as baseline (optimal for speech)
            const bytesPerSecond = 16000 * 1 * 2; // sample rate * channels * bytes per sample
            const estimatedWavSize = duration * bytesPerSecond;
            const estimatedWavSizeMB = estimatedWavSize / (1024 * 1024);
            
            // Calculate total temp storage needed
            // Original file + WAV + Chunks (with 10% overhead for chunking)
            const totalTempStorageNeeded = (fileSize + estimatedWavSize + (estimatedWavSize * 1.1)) / (1024 * 1024);
            
            console.log('File size analysis (chunking required):', {
                originalSize: `${(fileSize / (1024 * 1024)).toFixed(1)}MB`,
                duration: `${durationInHours.toFixed(1)} hours`,
                estimatedWavSize: `${estimatedWavSizeMB.toFixed(1)}MB`,
                totalTempStorageNeeded: `${totalTempStorageNeeded.toFixed(1)}MB`
            });

            // Check if file is too large based on multiple criteria
            if (fileSize > 700000000) {
                throw new Error(
                    `File is too large. Files must be under 700MB and one of the following file types: ${config.supportedMimes.join(
                        ", "
                    )}. Note that 700MB may be too high of a limit, due to Pipedream's 2GB temp storage maximum.`
                );
            }

            if (estimatedWavSize > 1800000000) { // 1.8GB
                throw new Error(
                    `File duration is too long. Based on the file's duration (${durationInHours.toFixed(1)} hours), ` +
                    `the converted WAV file would be approximately ${estimatedWavSizeMB.toFixed(1)}MB. ` +
                    `This exceeds our processing limits. Please use a shorter file or compress the audio to a lower bitrate.`
                );
            }

            if (totalTempStorageNeeded > 1800) { // 1.8GB
                throw new Error(
                    `Total storage requirements too high. The process would need approximately ${totalTempStorageNeeded.toFixed(1)}MB of temporary storage ` +
                    `(original file: ${(fileSize / (1024 * 1024)).toFixed(1)}MB, ` +
                    `WAV conversion: ${estimatedWavSizeMB.toFixed(1)}MB, ` +
                    `chunks: ${(estimatedWavSize * 1.1 / (1024 * 1024)).toFixed(1)}MB). ` +
                    `This exceeds Pipedream's 2GB temp storage limit. Please use a shorter file or compress the audio to a lower bitrate.`
                );
            }

            // Log file size in mb to nearest hundredth
            const readableFileSize = fileSize / 1000000;
            console.log(
                `File size is approximately ${readableFileSize.toFixed(1)}MB. ` +
                `Duration: ${durationInHours.toFixed(1)} hours. ` +
                `Estimated WAV size: ${estimatedWavSizeMB.toFixed(1)}MB. `
            );
        },
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