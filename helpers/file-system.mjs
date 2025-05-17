// Node.js utils
import stream from "stream"; // Stream handling
import { promisify } from "util"; // Promisify
import fs from "fs"; // File system
import got from "got"; // HTTP requests
import { exec } from "child_process"; // Shell commands

const execAsync = promisify(exec);

export default {
    methods: {
        cleanupLargeObjects({object, objectName = 'unnamed', debug = false}) {
            if (!debug) {
                const beforeMemory = process.memoryUsage().heapUsed;
                console.log(`Clearing out large object '${objectName}' from memory...`);
                
                // Instead of reassigning the parameter, we'll clear the object's properties
                if (Array.isArray(object)) {
                    object.length = 0;
                } else if (typeof object === 'object' && object !== null) {
                    Object.keys(object).forEach(key => {
                        object[key] = null;
                    });
                }

                const afterMemory = process.memoryUsage().heapUsed;
                const memorySaved = (beforeMemory - afterMemory) / 1024; // Convert to KB
                
                console.log(`Cleared out large object '${objectName}' from memory. Memory saved: ${memorySaved.toFixed(2)} KB`);
            }
        },

        async earlyTermination() {
            const TIMEOUT_SECONDS = this.timeout_seconds;
            const EARLY_TERMINATION_SECONDS = 3; // 3 seconds before timeout
            const elapsedSeconds = (Date.now() - this.start_time) / 1000;
            
            if (elapsedSeconds >= TIMEOUT_SECONDS) {
                console.log(`Timeout limit reached (${TIMEOUT_SECONDS}s). Stopping workflow to preserve logs.`);
                await this.cleanTmp(true);
                return true;
            }
            
            if (elapsedSeconds >= (TIMEOUT_SECONDS - EARLY_TERMINATION_SECONDS)) {
                console.log(`Early termination triggered at ${elapsedSeconds.toFixed(2)}s (${EARLY_TERMINATION_SECONDS}s before timeout)`);
                await this.cleanTmp(true);
                return true;
            }
            
            return false;
        },
        async checkSize(fileSize, sizeCheckOnly = false) {
            
            // Check if file is too large based on multiple criteria
            if (fileSize > 700000000) {
                throw new Error(
                    `File is too large. Files must be under 700MB and one of the following file types: ${config.supportedMimes.join(
                        ", "
                    )}. Note that 700MB may be too high of a limit, due to Pipedream's 2GB temp storage maximum.`
                );
            }

            if (sizeCheckOnly) {
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
            const totalTempStorageNeeded = (
                (fileSize / (1024 * 1024)) + // Convert original file size to MB
                (estimatedWavSize / (1024 * 1024)) + // Convert WAV size to MB
                ((estimatedWavSize * 1.1) / (1024 * 1024)) // Convert chunk size to MB
            );
            
            console.log('File size analysis:', {
                originalSize: `${(fileSize / (1024 * 1024)).toFixed(1)}MB`,
                duration: `${durationInHours.toFixed(1)} hours`,
                estimatedWavSize: `${estimatedWavSizeMB.toFixed(1)}MB`,
                totalTempStorageNeeded: `${totalTempStorageNeeded.toFixed(1)}MB`
            });

            if (totalTempStorageNeeded > 1800) { // 1.8GB
                throw new Error(
                    `Total storage requirements too high. Since WAV conversion and chunking are required, the process would need approximately ${totalTempStorageNeeded.toFixed(1)}MB of temporary storage ` +
                    `(original file: ${(fileSize / (1024 * 1024)).toFixed(1)}MB, ` +
                    `WAV conversion: ${estimatedWavSizeMB.toFixed(1)}MB, ` +
                    `chunks: ${(estimatedWavSize * 1.1 / (1024 * 1024)).toFixed(1)}MB). ` +
                    `This would likely exceed Pipedream's 2GB temp storage limit (accounting for overhead). Please use a shorter file or compress the audio to a lower bitrate.`
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

			// Only clean chunks if not using direct upload and cleanChunks is true
			if (
				!this.direct_upload &&
				cleanChunks &&
				this.chunkDir.length > 0 &&
				fs.existsSync(this.chunkDir)
			) {
				console.log(`Cleaning up ${this.chunkDir}...`);
				await execAsync(`rm -rf "${this.chunkDir}"`);
			} else if (!this.direct_upload) {
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