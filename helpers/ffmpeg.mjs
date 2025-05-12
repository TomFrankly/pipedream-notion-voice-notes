import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"; // ffmpeg
import { parseFile } from "music-metadata"; // Audio duration parser

// Node.js utils
import { promisify } from "util"; // Promisify
import fs from "fs"; // File system
import { inspect } from "util"; // Object inspection
import { join, extname } from "path"; // Path handling
import { exec, spawn } from "child_process"; // Shell commands

const execAsync = promisify(exec);

export default {
    methods: {
        // Uses music-metadata to get the duration of the audio file, instead of ffmpeg, to avoid spawning a resource-intensive process.
        async getDuration(filePath) {
			try {
				let dataPack;
				try {
					dataPack = await parseFile(filePath);
				} catch (error) {
					console.warn(
						"Failed to read audio file metadata while getting the duration of the audio file with music-metadata. The file format might be unsupported or corrupted, or the file might no longer exist at the specified file path (which is in temp storage). If you are using the Google Drive or OneDrive versions of this workflow and are currently setting it up, please try testing your 'download' step again in order to re-download the file into temp storage. Then test this step again. Learn more here: https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/#error-failed-to-read-audio-file-metadata"
					);
					return 0;
				}

				const duration = Math.round(
					await inspect(dataPack.format.duration, {
						showHidden: false,
						depth: null,
					})
				);
				console.log(`Successfully got duration: ${duration} seconds`);
				return duration;
			} catch (error) {
				console.warn(
					`An error occurred while getting the duration of the audio file with music-metadata: ${error.message}. Continuing with duration set to 0.`
				);
				return 0;
			}
		},
        formatDuration(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const remainingSeconds = seconds % 60;
            
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        },
        async chunkFile({ file }) {
			const chunkDirName = "chunks-" + this.steps.trigger.context.id;
			const outputDir = join("/tmp", chunkDirName);
			this.chunkDir = outputDir;
			await execAsync(`mkdir -p "${outputDir}"`);
			await execAsync(`rm -f "${outputDir}/*"`);

            console.log(`Chunking file: ${file}`);
            
            const ffmpegPath = ffmpegInstaller.path;
			const ext = extname(file);

			const fileSizeInMB = fs.statSync(file).size / (1024 * 1024);
			const maxChunkSize = 24; // Maximum chunk size in MB
			const minChunkSize = 2;  // Minimum chunk size in MB
			const targetChunkSize = this.chunk_size ?? maxChunkSize;
			
			// Calculate number of chunks needed to ensure minimum chunk size
			let numberOfChunks = Math.ceil(fileSizeInMB / targetChunkSize);
			let adjustedChunkSize = targetChunkSize;
			
			// If the last chunk would be too small, adjust the chunk size
			const lastChunkSize = fileSizeInMB - (Math.floor(fileSizeInMB / targetChunkSize) * targetChunkSize);
			if (lastChunkSize < minChunkSize && numberOfChunks > 1) {
				numberOfChunks = Math.floor(fileSizeInMB / minChunkSize);
				adjustedChunkSize = Math.ceil(fileSizeInMB / numberOfChunks);
			}

			console.log(
				`Full file size: ${fileSizeInMB.toFixed(2)}MB. Target chunk size: ${targetChunkSize}MB. Adjusted chunk size: ${adjustedChunkSize}MB. Number of chunks: ${numberOfChunks}. Commencing chunking...`
			);

			if (numberOfChunks === 1) {
				await execAsync(`cp "${file}" "${outputDir}/chunk-000${ext}"`);
				console.log(`Created 1 chunk: ${outputDir}/chunk-000${ext}`);
                const files = await fs.promises.readdir(outputDir);
				return {
                    files: files,
                    outputDir: outputDir,
                }
			}

			// Get duration using spawn instead of exec
			const getDuration = () => {
				return new Promise((resolve, reject) => {
					let durationOutput = '';
					const ffprobe = spawn(ffmpegPath, ['-i', file]);
					
					const cleanup = () => {
						if (ffprobe && !ffprobe.killed) {
							ffprobe.kill();
						}
					};
					
					ffprobe.stderr.on('data', (data) => {
						durationOutput += data.toString();
					});
					
					ffprobe.on('close', (code) => {
						cleanup();
						try {
							const durationMatch = durationOutput.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
							if (durationMatch && durationMatch[1]) {
								resolve(durationMatch[1]);
							} else {
								reject(new Error('Could not determine file duration'));
							}
						} catch (error) {
							reject(error);
						}
					});
					
					ffprobe.on('error', (err) => {
						cleanup();
						reject(err);
					});
				});
			};

			try {
				const duration = await getDuration();
				const [hours, minutes, seconds] = duration.split(":").map(parseFloat);

				const totalSeconds = hours * 60 * 60 + minutes * 60 + seconds;
				
				// Calculate segment time based on adjusted chunk size
				// Convert adjustedChunkSize (MB) to bytes, then to seconds based on file's bitrate
				const fileSizeInBytes = fs.statSync(file).size;
				const bitrate = (fileSizeInBytes * 8) / totalSeconds; // bits per second
				const segmentTime = Math.ceil((adjustedChunkSize * 1024 * 1024 * 8) / bitrate);

				console.log(`File duration: ${duration}, segment time: ${segmentTime} seconds (based on ${adjustedChunkSize}MB chunks)`);
				
				// Use spawn for the chunking operation
				const chunkFile = () => {
					return new Promise((resolve, reject) => {
						const args = [
							'-i', file,
							'-f', 'segment',
							'-segment_time', segmentTime.toString(),
							'-c', 'copy',
							'-loglevel', 'verbose',
							`${outputDir}/chunk-%03d${ext}`
						];
						
						console.log(`Splitting file into chunks with ffmpeg command: ${ffmpegPath} ${args.join(' ')}`);
						
						const ffmpeg = spawn(ffmpegPath, args);
						
						const cleanup = () => {
							if (ffmpeg && !ffmpeg.killed) {
								ffmpeg.kill();
							}
						};
						
						let stdoutData = '';
						let stderrData = '';
						
						ffmpeg.stdout.on('data', (data) => {
							const chunk = data.toString();
							stdoutData += chunk;
							console.log(`ffmpeg stdout: ${chunk}`);
						});
						
						ffmpeg.stderr.on('data', (data) => {
							const chunk = data.toString();
							stderrData += chunk;
							// Only log important messages to avoid excessive output
							if (chunk.includes('Opening') || chunk.includes('Output') || chunk.includes('Error')) {
								console.log(`ffmpeg stderr: ${chunk}`);
							}
						});
						
						ffmpeg.on('close', (code) => {
							cleanup();
							if (code === 0) {
								resolve({ stdout: stdoutData, stderr: stderrData });
							} else {
								reject(new Error(`ffmpeg process exited with code ${code}: ${stderrData}`));
							}
						});
						
						ffmpeg.on('error', (err) => {
							cleanup();
							reject(err);
						});
					});
				};
				
				await chunkFile();

				const chunkFiles = await fs.promises.readdir(outputDir);
				const chunkCount = chunkFiles.filter((file) =>
					file.includes("chunk-")
				).length;
				console.log(`Created ${chunkCount} chunks.`);

                return {
                    files: chunkFiles,
                    outputDir: outputDir,
                }
			} catch (error) {
				console.error(
					`An error occurred while splitting the file into chunks: ${error}`
				);
				throw error;
			}
		},
        async downsampleAudio({ file }) {
            console.log(`Starting audio downsampling process for file: ${file}`);
            
            const ffmpegPath = ffmpegInstaller.path;
            const originalSize = fs.statSync(file).size / (1024 * 1024);
            console.log(`Original file size: ${originalSize.toFixed(2)}MB`);
            
            // Create a temporary directory for the downsampled file
            const downsampledDir = join("/tmp", "downsampled-" + this.steps.trigger.context.id);
            await execAsync(`mkdir -p "${downsampledDir}"`);
            
            // Generate output path with MP3 extension (better compression than FLAC for speech)
            const outputPath = join(downsampledDir, "downsampled.mp3");
            
            try {
                // Use spawn for the downsampling operation
                const downsampleFile = () => {
                    return new Promise((resolve, reject) => {
                        const args = [
                            '-i', file,
                            '-ar', '16000',     // Set sample rate to 16kHz
                            '-ac', '1',         // Convert to mono
                            '-c:a', 'libmp3lame', // Use MP3 codec
                            '-b:a', '32k',      // Set bitrate to 32kbps (very low, but sufficient for speech)
                            '-q:a', '9',        // Highest compression (0-9, 9 being highest)
                            '-loglevel', 'verbose',
                            outputPath
                        ];
                        
                        console.log(`Downsampling file with ffmpeg command: ${ffmpegPath} ${args.join(' ')}`);
                        
                        const ffmpeg = spawn(ffmpegPath, args);
                        
                        const cleanup = () => {
                            if (ffmpeg && !ffmpeg.killed) {
                                ffmpeg.kill();
                            }
                        };
                        
                        let stdoutData = '';
                        let stderrData = '';
                        
                        ffmpeg.stdout.on('data', (data) => {
                            const chunk = data.toString();
                            stdoutData += chunk;
                            console.log(`ffmpeg stdout: ${chunk}`);
                        });
                        
                        ffmpeg.stderr.on('data', (data) => {
                            const chunk = data.toString();
                            stderrData += chunk;
                            // Only log important messages to avoid excessive output
                            if (chunk.includes('Opening') || chunk.includes('Output') || chunk.includes('Error')) {
                                console.log(`ffmpeg stderr: ${chunk}`);
                            }
                        });
                        
                        ffmpeg.on('close', (code) => {
                            cleanup();
                            if (code === 0) {
                                resolve({ stdout: stdoutData, stderr: stderrData });
                            } else {
                                reject(new Error(`ffmpeg process exited with code ${code}: ${stderrData}`));
                            }
                        });
                        
                        ffmpeg.on('error', (err) => {
                            cleanup();
                            reject(err);
                        });
                    });
                };
                
                await downsampleFile();
                
                const downsampledSize = fs.statSync(outputPath).size / (1024 * 1024);
                const sizeReduction = ((originalSize - downsampledSize) / originalSize * 100).toFixed(2);
                
                console.log(`Downsampling complete:`);
                console.log(`- Original size: ${originalSize.toFixed(2)}MB`);
                console.log(`- New size: ${downsampledSize.toFixed(2)}MB`);
                console.log(`- Size reduction: ${sizeReduction}%`);
                
                return {
                    path: outputPath,
                    originalSize,
                    downsampledSize,
                    sizeReduction
                };
            } catch (error) {
                console.error(`An error occurred while downsampling the audio file: ${error}`);
                throw error;
            }
        },
    }
}