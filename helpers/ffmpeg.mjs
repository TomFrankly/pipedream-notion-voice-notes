import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"; // ffmpeg
import { parseFile } from "music-metadata"; // Audio duration parser

// Node.js utils
import { promisify } from "util"; // Promisify
import fs from "fs"; // File system
import { inspect } from "util"; // Object inspection
import { join, extname } from "path"; // Path handling
import { exec, spawn } from "child_process"; // Shell commands

const execAsync = promisify(exec);

// Global process tracking
const activeProcesses = new Set();

// Cleanup function that will be called on process exit
const cleanup = () => {
    console.log('Running global cleanup...');
    for (const process of activeProcesses) {
        try {
            if (!process.killed) {
                process.kill();
                console.log('Killed leftover process');
            }
        } catch (error) {
            console.warn('Error during process cleanup:', error);
        }
    }
    activeProcesses.clear();
};

// Register cleanup handlers
process.on('exit', cleanup);
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    cleanup();
    process.exit(1);
});

// Helper to track spawned processes
const spawnWithTracking = (command, args, options) => {
    const process = spawn(command, args, options);
    activeProcesses.add(process);
    process.on('close', () => activeProcesses.delete(process));
    return process;
};

export default {
    methods: {
        logMemoryUsage(context) {
            const usage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            console.log(`Resource Usage (${context}):`, {
                Memory: {
                    RSS: `${Math.round(usage.rss / 1024 / 1024)}MB`,
                    HeapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
                    HeapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
                    External: `${Math.round(usage.external / 1024 / 1024)}MB`
                },
                CPU: {
                    User: `${Math.round(cpuUsage.user / 1000)}ms`,
                    System: `${Math.round(cpuUsage.system / 1000)}ms`,
                    Total: `${Math.round((cpuUsage.user + cpuUsage.system) / 1000)}ms`
                }
            });
        },

        getSafeMemoryLimit() {
            // Pipedream's default memory limit is 256MB, but lets' assume only 180mb for this step
            // We'll use 90% of this to leave some buffer for Node.js
            return 180 * 0.9; // ~162MB safe limit
        },

        estimateWavSize(mp3Size, duration) {
            // WAV is uncompressed, so we need to estimate based on duration
            // Using 16-bit, 16kHz, mono as baseline (optimal for speech)
            const bytesPerSecond = 16000 * 1 * 2; // sample rate * channels * bytes per sample
            return duration * bytesPerSecond;
        },

        async checkFileViability(file, ffmpegPath, chunkSize) {
            // Calculate safe memory limit
            const safeMemoryLimit = this.getSafeMemoryLimit();
            console.log(`Memory settings:`, {
                safeMemoryLimit: `${safeMemoryLimit}MB`,
                currentUsage: this.logMemoryUsage('Start of file viability check')
            });

            const sizeInMB = this.file_size / (1024 * 1024);
            const ext = extname(file).toLowerCase();
            
            // Get duration and calculate total seconds
            const durationSeconds = this.duration;
            const totalSeconds = durationSeconds;
            
            // For non-WAV files, estimate WAV size and total temp storage needed
            if (ext !== '.wav') {
                const estimatedWavSize = this.estimateWavSize(this.file_size, totalSeconds);
                const estimatedWavSizeMB = estimatedWavSize / (1024 * 1024);
                
                // Calculate number of chunks needed
                const maxChunkSize = 24; // Maximum chunk size in MB
                const minChunkSize = 2;  // Minimum chunk size in MB
                const targetChunkSize = chunkSize ?? maxChunkSize;
                
                let numberOfChunks = Math.ceil(estimatedWavSizeMB / targetChunkSize);
                let adjustedChunkSize = targetChunkSize;
                
                // Calculate the size of the last chunk if we use target chunk size
                const lastChunkSize = estimatedWavSizeMB - (Math.floor(estimatedWavSizeMB / targetChunkSize) * targetChunkSize);
                
                // If the last chunk would be too small, redistribute the excess across all chunks
                if (lastChunkSize < minChunkSize && numberOfChunks > 1) {
                    // Calculate how much we need to add to the last chunk to meet minimum size
                    const deficit = minChunkSize - lastChunkSize;
                    
                    // Reduce number of chunks by 1 since we're eliminating the last chunk
                    numberOfChunks--;
                    
                    // Redistribute this deficit across the remaining chunks
                    // This will make all chunks slightly larger, but keep them closer to target size
                    adjustedChunkSize = targetChunkSize + (deficit / numberOfChunks);
                    
                    // If the adjusted chunk size would exceed 25MB, set it to 20MB
                    // This only happens in the edge case where we have a file just over 24MB
                    if (adjustedChunkSize > 25) {
                        adjustedChunkSize = 20;
                    }
                }
                
                // Calculate total temp storage needed for WAV conversion
                const totalTempStorageNeeded = sizeInMB + estimatedWavSizeMB + (estimatedWavSizeMB * 1.1); // 1.1 factor for chunk overhead
                
                console.log('File size analysis:', {
                    originalSize: `${Math.round(sizeInMB)}MB`,
                    estimatedWavSize: `${Math.round(estimatedWavSizeMB)}MB`,
                    numberOfChunks,
                    targetChunkSize: `${targetChunkSize}MB`,
                    adjustedChunkSize: `${adjustedChunkSize}MB`,
                    totalTempStorageNeeded: `${Math.round(totalTempStorageNeeded)}MB`,
                    safeMemoryLimit: `${safeMemoryLimit}MB`,
                    duration: `${totalSeconds} seconds`
                });
                
                // If WAV conversion would exceed temp storage, return false to indicate we should use direct MP3 chunking
                if (totalTempStorageNeeded > 1800) { // 1.8GB to leave buffer
                    console.log(
                        `File too large for WAV conversion. Will use direct MP3 chunking instead.\n` +
                        `Estimated storage needed for WAV: ${Math.round(totalTempStorageNeeded)}MB\n` +
                        `- Original MP3: ${Math.round(sizeInMB)}MB\n` +
                        `- Converted WAV: ${Math.round(estimatedWavSizeMB)}MB\n` +
                        `- Chunks (with overhead): ${Math.round(estimatedWavSizeMB * 1.1)}MB\n` +
                        `Note: Direct MP3 chunking will use more memory. Consider increasing your workflow's memory allocation if processing fails.`
                    );
                    this.logMemoryUsage('End of file viability check (falling back to original file format)');
                    return false;
                }
            } else if (sizeInMB > 1800) {
                throw new Error('File too large for processing within temp storage constraints');
            }
            
            // Estimate memory needs based on bitrate
            const bitrate = (this.file_size * 8) / totalSeconds; // bits per second
            const estimatedChunkMemory = (bitrate * 30) / (8 * 1024 * 1024); // MB for 30-sec chunk
            
            if (estimatedChunkMemory > safeMemoryLimit) {
                console.warn(
                    `Warning: Estimated chunk memory (${Math.round(estimatedChunkMemory)}MB) exceeds safe limit (${safeMemoryLimit}MB).\n` +
                    `Consider increasing your workflow's memory allocation or using a smaller chunk size.`
                );
            }
            
            this.logMemoryUsage('End of file viability check');
            return true;
        },

        async convertToWav(file, ffmpegPath) {
            const wavFile = file.replace('.mp3', '.wav');
            return new Promise((resolve, reject) => {
                this.logMemoryUsage('Start of MP3 to WAV conversion');
                
                const startTime = Date.now();
                
                const ffmpeg = spawnWithTracking(ffmpegPath, [
                    '-i', file,
                    '-acodec', 'pcm_s16le',
                    '-ar', '16000',     // 16kHz - optimal for speech recognition
                    '-ac', '1',         // Mono
                    '-bufsize', '512k', // Smaller buffer size
                    '-max_muxing_queue_size', '512',
                    wavFile
                ]);
                
                let errorOutput = '';
                
                ffmpeg.stderr.on('data', async (data) => {
                    const chunk = data.toString();
                    if (chunk.includes('Error')) {
                        errorOutput += chunk;
                        console.log(`ffmpeg error: ${chunk}`);
                    }
                    
                    if (await this.earlyTermination()) {
                        ffmpeg.kill();
                        reject(new Error('WAV conversion terminated due to timeout'));
                        return;
                    }
                });
                
                ffmpeg.on('close', (code) => {
                    const duration = (Date.now() - startTime) / 1000;
                    this.logMemoryUsage('End of MP3 to WAV conversion');
                    console.log(`WAV conversion completed in ${duration.toFixed(2)} seconds`);
                    if (code === 0) {
                        resolve(wavFile);
                    } else {
                        reject(new Error(`ffmpeg process failed with code ${code}: ${errorOutput}`));
                    }
                });
                
                ffmpeg.on('error', (err) => {
                    const duration = (Date.now() - startTime) / 1000;
                    this.logMemoryUsage('Error during MP3 to WAV conversion');
                    console.log(`WAV conversion failed after ${duration.toFixed(2)} seconds`);
                    reject(new Error(`ffmpeg process error: ${err.message}`));
                });
            });
        },

        // Existing methods
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
            try {
                if (!file) {
                    throw new Error('No file provided to chunkFile function');
                }

                if (!fs.existsSync(file)) {
                    throw new Error(`File does not exist at path: ${file}. If you're testing this step, you'll likely need to re-test the previous step (e.g. 'Download file') to ensure the file is downloaded and saved to temp storage before testing this step. After testing it successfully, click 'Continue' on it to proceed to this step, then test this step again.This needs to be done each time this step is tested because this step clears the temp storage directory in your Pipedream account after it finishes processing your file (it does not delete or modify the file in your cloud storage app).`);
                }

                console.log('Initial memory usage:', this.logMemoryUsage('Start of chunkFile function'));
                
                const ffmpegPath = ffmpegInstaller.path;
                const ext = extname(file).toLowerCase();
                
                // Get chunk size from this.chunk_size or use default
                const chunkSize = this.chunk_size || 24; // Default to 24MB if not set
                
                // Check file viability and determine if we should use WAV conversion
                const shouldUseWavConversion = await this.checkFileViability(file, ffmpegPath, chunkSize);
                
                const chunkDirName = "chunks-" + this.steps.trigger.context.id;
                const outputDir = join("/tmp", chunkDirName);
                this.chunkDir = outputDir;

                try {
                    await execAsync(`mkdir -p "${outputDir}"`);
                    await execAsync(`rm -f "${outputDir}/*"`);
                } catch (error) {
                    throw new Error(`Failed to create or clean chunk directory: ${error.message}`);
                }

                console.log(`Chunking file: ${file}`);
                
                // For large MP3 files, convert to WAV first to reduce memory usage if possible
                let processingFile = file;
                let fileSizeInMB = this.file_size / (1024 * 1024);
                const conversionThreshold = 24; // 24MB
                const maxChunkSize = 24; // Maximum chunk size in MB
                const minChunkSize = 2;  // Minimum chunk size in MB
                const targetChunkSize = chunkSize;

                if (ext !== '.wav' && shouldUseWavConversion && fileSizeInMB > conversionThreshold) {
                    console.log(`Converting large MP3 file to WAV to reduce memory usage...`);
                    processingFile = await this.convertToWav(file, ffmpegPath);
                    fileSizeInMB = fs.statSync(processingFile).size / (1024 * 1024);
                    console.log(`File size after conversion: ${fileSizeInMB}MB`);
                } else {
                    console.log(`File size is ${fileSizeInMB}MB, which is less than the conversion threshold of ${conversionThreshold}MB, so we will not convert the file to WAV.`);
                }

                try {
                    
                    // Calculate number of chunks needed to ensure minimum chunk size
                    let numberOfChunks = Math.ceil(fileSizeInMB / targetChunkSize);
                    let adjustedChunkSize = targetChunkSize;
                    
                    // Calculate the size of the last chunk if we use target chunk size
                    const lastChunkSize = fileSizeInMB - (Math.floor(fileSizeInMB / targetChunkSize) * targetChunkSize);
                    
                    // If the last chunk would be too small, redistribute the excess across all chunks
                    if (lastChunkSize < minChunkSize && numberOfChunks > 1) {
                        // Calculate how much we need to add to the last chunk to meet minimum size
                        const deficit = minChunkSize - lastChunkSize;
                        
                        // Reduce number of chunks by 1 since we're eliminating the last chunk
                        numberOfChunks--;
                        
                        // Redistribute this deficit across the remaining chunks
                        // This will make all chunks slightly larger, but keep them closer to target size
                        adjustedChunkSize = targetChunkSize + (deficit / numberOfChunks);
                        
                        // If the adjusted chunk size would exceed 25MB, set it to 20MB
                        // This only happens in the edge case where we have a file just over 24MB
                        if (adjustedChunkSize > 25) {
                            adjustedChunkSize = 20;
                        }
                    }

                    console.log(
                        `Full file size: ${fileSizeInMB.toFixed(2)}MB. Target chunk size: ${targetChunkSize}MB. Adjusted chunk size: ${adjustedChunkSize}MB. Number of chunks: ${numberOfChunks}. Commencing chunking...`
                    );

                    if (numberOfChunks === 1) {
                        try {
                            await execAsync(`cp "${processingFile}" "${outputDir}/chunk-000${extname(processingFile)}"`);
                            console.log(`Created 1 chunk: ${outputDir}/chunk-000${extname(processingFile)}`);
                            // Clean up original file immediately after copying
                            try {
                                await fs.promises.unlink(processingFile);
                                console.log('Original file cleaned up after copying');
                            } catch (error) {
                                console.warn('Failed to cleanup original file:', error);
                            }
                            const files = await fs.promises.readdir(outputDir);
                            return {
                                files: files,
                                outputDir: outputDir,
                            }
                        } catch (error) {
                            throw new Error(`Failed to copy single chunk file: ${error.message}`);
                        }
                    }
                    
                    // Calculate segment time based on adjusted chunk size
                    const fileSizeInBytes = fs.statSync(processingFile).size;
                    const bitrate = (fileSizeInBytes * 8) / this.duration; // bits per second
                    const segmentTime = Math.ceil((adjustedChunkSize * 1024 * 1024 * 8) / bitrate);

                    console.log(`File duration: ${this.formatDuration(this.duration)}, segment time: ${segmentTime} seconds (based on ${adjustedChunkSize}MB chunks)`);
                    
                    // Use spawn for the chunking operation with optimized memory settings
                    const chunkFile = () => {
                        return new Promise((resolve, reject) => {
                            this.logMemoryUsage('Start of chunking operation');
                            
                            const startTime = Date.now();
                            let lastChunkTime = startTime;
                            let chunkCount = 0;
                            
                            // Set buffer sizes based on file format
                            let bufferSize, probeSize;
                            switch (extname(processingFile).toLowerCase()) {
                                case '.wav':
                                    // WAV is uncompressed, can use very small buffers
                                    bufferSize = 64;  // Reduced from 128
                                    probeSize = 8;   // Reduced from 16
                                    break;
                                case '.mp3':
                                    // MP3 needs moderate buffers for decoding
                                    bufferSize = 128; // Reduced from 256
                                    probeSize = 32;  // Reduced from 64
                                    break;
                                case '.m4a':
                                case '.aac':
                                    // AAC-based formats need moderate buffers
                                    bufferSize = 96;  // Reduced from 192
                                    probeSize = 16;  // Reduced from 32
                                    break;
                                case '.ogg':
                                case '.opus':
                                    // Ogg/Opus formats are efficient
                                    bufferSize = 64;  // Reduced from 128
                                    probeSize = 8;   // Reduced from 16
                                    break;
                                case '.flac':
                                    // FLAC is compressed but efficient
                                    bufferSize = 96;  // Reduced from 192
                                    probeSize = 16;  // Reduced from 32
                                    break;
                                default:
                                    // For unknown formats, use conservative but smaller settings
                                    bufferSize = 128; // Reduced from 256
                                    probeSize = 32;  // Reduced from 64
                                    console.log(`Using default buffer sizes for unknown format: ${ext}`);
                            }
                            
                            console.log(`Buffer settings for ${extname(processingFile)}:`, {
                                bufferSize: `${bufferSize}k`,
                                probeSize: `${probeSize}k`
                            });
                            
                            // Input options (must come before input file)
                            const inputArgs = [
                                '-thread_queue_size', '256',  // Reduced from 512
                                '-probesize', `${probeSize}k`,
                                '-i', processingFile
                            ];
                            
                            // Output options (must come before output file)
                            const outputArgs = [
                                '-f', 'segment',
                                '-segment_time', segmentTime.toString(),
                                '-c', 'copy',  // Use copy for both WAV and MP3 to maintain efficiency
                                '-max_muxing_queue_size', '256',  // Reduced from 512
                                '-fflags', '+genpts',
                                '-reset_timestamps', '1',
                                '-map', '0',
                                '-bufsize', `${bufferSize}k`,
                                '-loglevel', 'info',
                                `${outputDir}/chunk-%03d${extname(processingFile)}`
                            ];
                            
                            // Combine all arguments
                            const args = [...inputArgs, ...outputArgs];
                            
                            console.log(`Splitting file into chunks with ffmpeg command: ${ffmpegPath} ${args.join(' ')}`);
                            
                            const ffmpeg = spawnWithTracking(ffmpegPath, args);
                            
                            const cleanup = () => {
                                if (ffmpeg && !ffmpeg.killed) {
                                    ffmpeg.kill();
                                }
                            };
                            
                            // Monitor memory usage and timeout
                            const checkInterval = setInterval(async () => {
                                this.logMemoryUsage('During chunking');
                                
                                // Add memory pressure check
                                const usage = process.memoryUsage();
                                const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
                                const rssMB = Math.round(usage.rss / 1024 / 1024);
                                
                                // If memory usage is too high, force cleanup
                                if (heapUsedMB > 150 || rssMB > 500) {  // Adjust these thresholds based on your needs
                                    console.warn(`High memory usage detected: Heap=${heapUsedMB}MB, RSS=${rssMB}MB. Forcing cleanup...`);
                                    clearInterval(checkInterval);
                                    cleanup();
                                    reject(new Error('Chunking process terminated due to high memory usage'));
                                    return;
                                }
                                
                                if (await this.earlyTermination()) {
                                    clearInterval(checkInterval);
                                    cleanup();
                                    reject(new Error('Chunking process terminated due to timeout'));
                                    return;
                                }
                            }, 2000); // Check every 2 seconds instead of 5
                            
                            let errorOutput = '';
                            let stdoutOutput = '';
                            
                            ffmpeg.stderr.on('data', (data) => {
                                const chunk = data.toString();
                                errorOutput += chunk;
                                // Check for chunk creation messages
                                if (chunk.includes('Opening') && chunk.includes('chunk-')) {
                                    const currentTime = Date.now();
                                    const chunkDuration = (currentTime - lastChunkTime) / 1000;
                                    chunkCount++;
                                    console.log(`Created chunk ${chunkCount} in ${chunkDuration.toFixed(2)} seconds`);
                                    lastChunkTime = currentTime;
                                }
                                console.log(`ffmpeg stderr: ${chunk}`);
                            });
                            
                            ffmpeg.stdout.on('data', (data) => {
                                const chunk = data.toString();
                                stdoutOutput += chunk;
                                console.log(`ffmpeg stdout: ${chunk}`);
                            });
                            
                            ffmpeg.on('close', (code) => {
                                const totalDuration = (Date.now() - startTime) / 1000;
                                clearInterval(checkInterval);
                                cleanup();
                                this.logMemoryUsage('End of chunking operation');
                                console.log(`Chunking completed in ${totalDuration.toFixed(2)} seconds (${chunkCount} chunks)`);
                                if (code === 0) {
                                    resolve();
                                } else {
                                    reject(new Error(`ffmpeg process failed with code ${code}:\nstdout: ${stdoutOutput}\nstderr: ${errorOutput}`));
                                }
                            });
                            
                            ffmpeg.on('error', (err) => {
                                const totalDuration = (Date.now() - startTime) / 1000;
                                clearInterval(checkInterval);
                                cleanup();
                                this.logMemoryUsage('Error during chunking operation');
                                console.log(`Chunking failed after ${totalDuration.toFixed(2)} seconds (${chunkCount} chunks completed)`);
                                reject(new Error(`ffmpeg process error: ${err.message}\nstdout: ${stdoutOutput}\nstderr: ${errorOutput}`));
                            });
                        });
                    };
                    
                    await chunkFile();

                    // Clean up original file immediately after chunking
                    try {
                        await fs.promises.unlink(processingFile);
                        console.log('Original file cleaned up after chunking');
                    } catch (error) {
                        console.warn('Failed to cleanup original file:', error);
                    }

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
                    // Ensure cleanup on error
                    try {
                        await fs.promises.unlink(processingFile);
                        console.log('Original file cleaned up after error');
                    } catch (cleanupError) {
                        console.warn('Failed to cleanup original file after error:', cleanupError);
                    }
                    throw new Error(`Failed during file chunking process: ${error.message}`);
                }
            } catch (error) {
                console.error(`Chunking process failed: ${error.message}`);
                throw new Error(`Failed to chunk audio file: ${error.message}`);
            }
        },
        async downsampleAudio({ file }) {
            try {
                if (!file) {
                    throw new Error('No file provided to downsampleAudio function');
                }

                if (!fs.existsSync(file)) {
                    throw new Error(`File does not exist at path: ${file}. If you're testing this step, you'll likely need to re-test the previous step (e.g. 'Download file') to ensure the file is downloaded and saved to temp storage before testing this step. After testing it successfully, click 'Continue' on it to proceed to this step, then test this step again. This needs to be done each time this step is tested because this step clears the temp storage directory in your Pipedream account after it finishes processing your file (it does not delete or modify the file in your cloud storage app).`);
                }

                console.log(`Starting audio downsampling process for file: ${file}`);
                
                const ffmpegPath = ffmpegInstaller.path;
                const originalSize = fs.statSync(file).size / (1024 * 1024);
                console.log(`Original file size: ${originalSize.toFixed(2)}MB`);
                
                // Create a temporary directory for the downsampled file
                const downsampledDir = join("/tmp", "downsampled-" + this.steps.trigger.context.id);
                try {
                    await execAsync(`mkdir -p "${downsampledDir}"`);
                } catch (error) {
                    throw new Error(`Failed to create downsampled directory: ${error.message}`);
                }
                
                // Generate output path with M4A extension (better compression than FLAC for speech)
                const outputPath = join(downsampledDir, "downsampled.m4a");
                
                try {
                    // Use spawn for the downsampling operation
                    const downsampleFile = () => {
                        return new Promise((resolve, reject) => {
                            const args = [
                                '-i', file,
                                '-ar', '16000',     // Set sample rate to 16kHz
                                '-ac', '1',         // Convert to mono
                                '-c:a', 'aac',      // Use AAC codec
                                '-b:a', '32k',      // Set bitrate to 32kbps (very low, but sufficient for speech)
                                '-loglevel', 'verbose',
                                outputPath
                            ];
                            
                            console.log(`Downsampling file with ffmpeg command: ${ffmpegPath} ${args.join(' ')}`);
                            
                            const ffmpeg = spawnWithTracking(ffmpegPath, args);
                            
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
                            
                            ffmpeg.stderr.on('data', async (data) => {
                                const chunk = data.toString();
                                stderrData += chunk;
                                // Only log important messages to avoid excessive output
                                if (chunk.includes('Opening') || chunk.includes('Output') || chunk.includes('Error')) {
                                    console.log(`ffmpeg stderr: ${chunk}`);
                                }
                                
                                if (await this.earlyTermination()) {
                                    cleanup();
                                    reject(new Error('Downsampling terminated due to timeout'));
                                    return;
                                }
                            });
                            
                            ffmpeg.on('close', (code) => {
                                cleanup();
                                if (code === 0) {
                                    resolve({ stdout: stdoutData, stderr: stderrData });
                                } else {
                                    reject(new Error(`ffmpeg process failed with code ${code}: ${stderrData}`));
                                }
                            });
                            
                            ffmpeg.on('error', (err) => {
                                cleanup();
                                reject(new Error(`ffmpeg process error: ${err.message}`));
                            });
                        });
                    };
                    
                    await downsampleFile();
                    
                    if (!fs.existsSync(outputPath)) {
                        throw new Error(`Downsampled file was not created at path: ${outputPath}. This might indicate that the ffmpeg process failed to create the output file.`);
                    }
                    
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
                    throw new Error(`Failed during audio downsampling process: ${error.message}`);
                }
            } catch (error) {
                console.error(`An error occurred while downsampling the audio file: ${error.message}`);
                throw error;
            }
        },
    }
}