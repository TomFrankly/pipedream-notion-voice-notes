// To use any npm package, just import it
// import axios from "axios"

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

export default defineComponent({
    async run({ steps, $ }) {
        console.log("Starting comprehensive cleanup...");
        
        try {
            // 1. Kill any running FFmpeg processes
            console.log("Killing any running FFmpeg processes...");
            try {
                await execAsync("pkill -f ffmpeg");
                console.log("FFmpeg processes terminated");
            } catch (error) {
                console.log("No FFmpeg processes found or error killing them:", error.message);
            }

            // 2. Clear the /tmp directory
            console.log("Clearing /tmp directory...");
            try {
                // List all files in /tmp
                const files = await fs.promises.readdir("/tmp");
                
                // Delete each file except __pdg__ directory
                for (const file of files) {
                    try {
                        const filePath = `/tmp/${file}`;
                        // Skip the __pdg__ directory
                        if (file === "__pdg__") {
                            console.log("Preserving Pipedream directory: __pdg__");
                            continue;
                        }
                        
                        const stats = await fs.promises.stat(filePath);
                        
                        if (stats.isDirectory()) {
                            await execAsync(`rm -rf "${filePath}"`);
                        } else {
                            await fs.promises.unlink(filePath);
                        }
                    } catch (error) {
                        console.log(`Error deleting ${file}:`, error.message);
                    }
                }
                console.log("Temporary files cleared (preserving Pipedream files)");
            } catch (error) {
                console.log("Error clearing /tmp:", error.message);
            }

            // 3. Clear Node.js process memory
            console.log("Clearing Node.js process memory...");
            if (global.gc) {
                global.gc();
                console.log("Garbage collection completed");
            } else {
                console.log("Garbage collection not available");
            }

            // 4. Clear any remaining child processes
            console.log("Clearing any remaining child processes...");
            try {
                await execAsync("pkill -P $$");
                console.log("Child processes cleared");
            } catch (error) {
                console.log("No child processes found or error clearing them:", error.message);
            }

            console.log("Cleanup completed successfully");
            return {
                status: "success",
                message: "Execution environment has been reset",
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error("Error during cleanup:", error);
            return {
                status: "error",
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
});