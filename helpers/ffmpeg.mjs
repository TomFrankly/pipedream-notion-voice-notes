import ffmpegInstaller from "@ffmpeg-installer/ffmpeg"; // ffmpeg
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { parseFile } from "music-metadata"; // Audio duration parser

// Node.js utils
import { promisify } from "util"; // Promisify
import fs from "fs"; // File system
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

        async getDuration(filePath) {
            try {
                const dataPack = await parseFile(filePath, {
                    duration: true,
                    skipCovers: true
                });
                
                const duration = Math.round(dataPack.format.duration);
                console.log(`Successfully got duration with music-metadata: ${duration} seconds`);
                return duration;
                
            } catch (error) {
                throw new Error(`Failed to get the duration of the audio file, which is required for this workflow. The file format might be unsupported or corrupted, or the file might no longer exist at the specified file path (which is in temp storage). Before re-testing this step, please re-test your 'download' step again in order to re-download the file into temp storage. Then test this step again. Learn more here: https://thomasjfrank.com/how-to-transcribe-audio-to-text-with-chatgpt-and-notion/#error-failed-to-read-audio-file-metadata`);
            }
        },
        
        formatDuration(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const remainingSeconds = seconds % 60;
            
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        },

        calculateSegmentTime(fileSize, duration) {
            // Check for invalid duration
            if (!duration || duration <= 0) {
                console.warn('Invalid duration detected (0 or negative). Returning duration to create single chunk.');
                return duration || 0;
            }

            // Convert file size to bytes if it's not already
            const fileSizeInBytes = typeof fileSize === 'number' ? fileSize : parseInt(fileSize);
            
            // Calculate average bitrate in bits per second
            const bitrate = (fileSizeInBytes * 8) / duration;
            
            if (!this.chunk_size) {
                this.chunk_size = 24;
            }
            
            const targetChunkSizeBytes = this.chunk_size * 1024 * 1024;
            
            // Calculate initial segment time based on target chunk size
            let segmentTime = Math.ceil((targetChunkSizeBytes * 8) / bitrate);
            
            // Calculate number of full chunks and duration of last chunk
            const numFullChunks = Math.floor(duration / segmentTime);
            const lastChunkDuration = duration - (numFullChunks * segmentTime);
            
            // If last chunk would be too small (less than 30 seconds) and we have more than one chunk
            if (lastChunkDuration < 30 && numFullChunks > 0) {
                // Option A: Increase segment time to merge the last chunk
                // This will make all chunks slightly larger but avoid a tiny last chunk
                segmentTime = Math.ceil(duration / numFullChunks);
                
                // Verify that the new segment time won't result in chunks that are too large
                const estimatedChunkSize = (segmentTime * bitrate) / 8;
                if (estimatedChunkSize > 25 * 1024 * 1024) { // If chunks would be over 25MB
                    // Option B: Reduce segment time to create more chunks
                    segmentTime = Math.ceil(duration / (numFullChunks + 1));
                }
            }
            
            // If segment time is equal to or greater than duration, return duration
            // This indicates we should not split the file
            if (segmentTime >= duration) {
                console.log(`File will not be split (segment time ${this.formatDuration(segmentTime)} >= duration ${this.formatDuration(duration)})`);
                return duration;
            }
            
            // Calculate final number of chunks
            const totalChunks = Math.ceil(duration / segmentTime);
            console.log(`File will be split into ${totalChunks} chunks with segment time ${this.formatDuration(segmentTime)}`);
            
            return segmentTime;
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

                // Get chunk size from this.chunk_size or use default
                const chunkSize = this.chunk_size || 24; // Default to 24MB if not set
                
                let fileSizeInMB = this.file_size / (1024 * 1024);
                console.log(`Full file size: ${fileSizeInMB.toFixed(2)}MB. Target chunk size: ${chunkSize}MB. Commencing chunking...`);

                // Calculate segment time using our new function
                const segmentTime = this.calculateSegmentTime(this.file_size, this.duration);

                // If segment time equals duration, we don't need to split the file
                if (segmentTime === this.duration) {
                    try {
                        await execAsync(`cp "${file}" "${outputDir}/chunk-000${extname(file)}"`);
                        console.log(`Created 1 chunk: ${outputDir}/chunk-000${extname(file)}`);
                        // Clean up original file immediately after copying
                        try {
                            await fs.promises.unlink(file);
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
                
                // Use spawn for the chunking operation with optimized memory settings
                const chunkFile = () => {
                    return new Promise((resolve, reject) => {
                        this.logMemoryUsage('Start of chunking operation');
                        
                        const startTime = Date.now();
                        let lastChunkTime = startTime;
                        let chunkCount = 0;

                        // Modified args
                        const args = [
                            '-hide_banner', '-loglevel', 'info', '-y',
                            '-analyzeduration', '0',
                            '-probesize', `32k`,
                            '-thread_queue_size', '64',
                            '-i', file,
                            '-c:a', 'copy',
                            '-f', 'segment',
                            '-segment_time', `${segmentTime}`,
                            '-reset_timestamps', '1',
                            '-map', '0:a:0',
                            '-max_muxing_queue_size', '64',
                            `${outputDir}/chunk-%03d${extname(file)}`
                        ]
                        
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
                            // if (heapUsedMB > 150 || rssMB > 500) {  // Adjust these thresholds based on your needs
                            //     console.warn(`High memory usage detected: Heap=${heapUsedMB}MB, RSS=${rssMB}MB. Forcing cleanup...`);
                            //     clearInterval(checkInterval);
                            //     cleanup();
                            //     reject(new Error('Chunking process terminated due to high memory usage'));
                            //     return;
                            // }
                            
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
                    await fs.promises.unlink(file);
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