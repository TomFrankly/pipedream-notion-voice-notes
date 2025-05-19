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
                try {
                    console.log(`Attempting to get duration with music-metadata for: ${filePath}`);
                    const dataPack = await parseFile(filePath, {
                        duration: true,
                        skipCovers: true
                    });
                    
                    if (dataPack && dataPack.format && typeof dataPack.format.duration === 'number') {
                        const duration = Math.round(dataPack.format.duration);
                        if (duration > 0) {
                            console.log(`Successfully got duration with music-metadata: ${duration} seconds`);
                            return duration;
                        } else {
                            console.warn(`music-metadata returned duration 0 or negative (${duration}s) for ${filePath}. Will attempt ffmpeg.`);
                            throw new Error(`music-metadata returned invalid duration: ${duration}`);
                        }
                    } else {
                        console.warn(`music-metadata did not return a valid duration object for ${filePath}. Will attempt ffmpeg.`);
                        throw new Error("music-metadata failed to provide a valid duration object.");
                    }

                } catch (musicMetadataError) {
                    console.warn(`music-metadata failed: ${musicMetadataError.message}. Falling back to ffmpeg...`);
                    
                    const ffmpegBinaryPath = ffmpegInstaller.path;

                    const command = `"${ffmpegBinaryPath}" -v error -nostdin -i "${filePath}" -f null - 2>&1`;
                    console.log(`Attempting to get duration with ffmpeg command: ${command}`);
                    
                    const { stdout, stderr } = await execAsync(command);

                    const outputToParse = stdout || stderr || "";

                    const durationMatch = outputToParse.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                    
                    if (!durationMatch) {
                        console.error(`Could not find or parse duration in ffmpeg output. Full output received: ${outputToParse.substring(0,1500)}`);
                        throw new Error('Could not find DURATION in ffmpeg output. Ensure ffmpeg is working and file is valid.');
                    }
                    
                    const hours = parseInt(durationMatch[1], 10);
                    const minutes = parseInt(durationMatch[2], 10);
                    const seconds = parseInt(durationMatch[3], 10);
                    const centiseconds = parseInt(durationMatch[4], 10);

                    const totalSeconds = (hours * 3600) + (minutes * 60) + seconds + (centiseconds / 100);
                    
                    if (totalSeconds > 0) {
                        const roundedDuration = Math.round(totalSeconds);
                        console.log(`Successfully got duration with ffmpeg: ${roundedDuration} seconds (from ${totalSeconds.toFixed(2)}s)`);
                        return roundedDuration;
                    } else {
                        console.error(`ffmpeg parsed duration as 0 or negative (${totalSeconds.toFixed(2)}s). File might be empty or invalid.`);
                        throw new Error(`ffmpeg returned invalid duration: ${totalSeconds.toFixed(2)}s`);
                    }
                }
            } catch (error) {
                console.error(`Ultimately failed to get duration for ${filePath}. Last error: ${error.message}`);

                throw new Error(`Failed to get the duration of the audio file, which is required for this workflow. Both music-metadata and ffmpeg attempts failed. Last error: ${error.message}. File: ${filePath}. Please check file integrity, format, and ensure it's accessible.`);
            }
        },
        
        formatDuration(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const remainingSeconds = seconds % 60;
            
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        },

        calculateSegmentTime(fileSize, duration) {
            if (!duration || duration <= 0) {
                console.warn('Invalid duration detected (0 or negative). Returning duration to create single chunk.');
                return duration || 0;
            }

            const fileSizeInBytes = typeof fileSize === 'number' ? fileSize : parseInt(fileSize);
            
            const bitrate = (fileSizeInBytes * 8) / duration;
            
            if (!this.chunk_size) {
                this.chunk_size = 24;
            }
            
            const targetChunkSizeBytes = this.chunk_size * 1024 * 1024;
            
            let segmentTime = Math.ceil((targetChunkSizeBytes * 8) / bitrate);
            
            const MAX_SEGMENT_TIME = 600;
            if (segmentTime > MAX_SEGMENT_TIME) {
                const numChunksWithMax = Math.ceil(duration / MAX_SEGMENT_TIME);
                const lastChunkWithMax = duration - (Math.floor(duration / MAX_SEGMENT_TIME) * MAX_SEGMENT_TIME);
                
                if (lastChunkWithMax < 30 && numChunksWithMax > 1) {
                    segmentTime = Math.ceil(duration / (numChunksWithMax - 1));
                } else {
                    segmentTime = MAX_SEGMENT_TIME;
                }
            }
            
            const numFullChunks = Math.floor(duration / segmentTime);
            const lastChunkDuration = duration - (numFullChunks * segmentTime);
            
            if (lastChunkDuration < 30 && numFullChunks > 0) {
                segmentTime = Math.ceil(duration / numFullChunks);
                
                const estimatedChunkSize = (segmentTime * bitrate) / 8;
                if (estimatedChunkSize > 25 * 1024 * 1024) {
                    segmentTime = Math.ceil(duration / (numFullChunks + 1));
                }
            }
            
            if (segmentTime >= duration) {
                console.log(`File will not be split (segment time ${this.formatDuration(segmentTime)} >= duration ${this.formatDuration(duration)})`);
                return duration;
            }
            
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

                const chunkSize = this.chunk_size || 24;
                
                let fileSizeInMB = this.file_size / (1024 * 1024);
                console.log(`Full file size: ${fileSizeInMB.toFixed(2)}MB. Target chunk size: ${chunkSize}MB. Commencing chunking...`);

                const segmentTime = this.calculateSegmentTime(this.file_size, this.duration);

                if (segmentTime === this.duration) {
                    try {
                        await execAsync(`cp "${file}" "${outputDir}/chunk-000${extname(file)}"`);
                        console.log(`Created 1 chunk: ${outputDir}/chunk-000${extname(file)}`);
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
                
                const chunkFile = () => {
                    return new Promise((resolve, reject) => {
                        this.logMemoryUsage('Start of chunking operation');
                        
                        const startTime = Date.now();
                        let lastChunkTime = startTime;
                        let chunkCount = 0;

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
                        
                        const checkInterval = setInterval(async () => {
                            this.logMemoryUsage('During chunking');
                            
                            if (await this.earlyTermination()) {
                                clearInterval(checkInterval);
                                cleanup();
                                reject(new Error('Chunking process terminated due to timeout'));
                                return;
                            }
                        }, 2000);
                        
                        let errorOutput = '';
                        let stdoutOutput = '';
                        
                        ffmpeg.stderr.on('data', (data) => {
                            const chunk = data.toString();
                            errorOutput += chunk;
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
                
                const downsampledDir = join("/tmp", "downsampled-" + this.steps.trigger.context.id);
                try {
                    await execAsync(`mkdir -p "${downsampledDir}"`);
                } catch (error) {
                    throw new Error(`Failed to create downsampled directory: ${error.message}`);
                }
                
                const outputPath = join(downsampledDir, "downsampled.m4a");
                
                try {
                    const downsampleFile = () => {
                        return new Promise((resolve, reject) => {
                            const args = [
                                '-i', file,
                                '-ar', '16000',
                                '-ac', '1',
                                '-c:a', 'aac',
                                '-b:a', '32k',
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